import {serve} from "bun";

interface DadosCliente {
    id: string;
    id_sala: string;
}

interface MensagemSinalizacao {
    tipo: string;
    de?: string;
    para?: string;
    id_peer?: string;
    id_cliente?: string;
    id_sala?: string;
    [chave: string]: any;
}

interface GerenciadorSalas {
    adicionar_cliente_na_sala(id_sala: string, id_cliente: string): void;
    remover_cliente_da_sala(id_sala: string, id_cliente: string): boolean;
    obter_clientes_na_sala(id_sala: string): Set<string>;
    sala_existe(id_sala: string): boolean;
}

class ServidorSinalizacao implements GerenciadorSalas {
    private salas: Map<string, Set<string>>;
    private mensagensPendentes: Map<string, MensagemSinalizacao[]>;
    private ultimoAcesso: Map<string, number>;
    private readonly TEMPO_LIMITE_INATIVIDADE: number = 30000; // 30 segundos

    constructor() {
        this.salas = new Map<string, Set<string>>();
        this.mensagensPendentes = new Map<string, MensagemSinalizacao[]>();
        this.ultimoAcesso = new Map<string, number>();

        setInterval(this.verificarClientesInativos.bind(this), 10000);
    }

    public iniciar_servidor(porta: number = 50010): void {
        serve({
            port: porta,
            fetch: this.processar_requisicao.bind(this),
        });

        console.log(`Servidor de sinalização WebRTC iniciado na porta ${porta}`);
    }

    private async processar_requisicao(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const caminho = url.pathname;

        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept",
        };

        if (req.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders,
            });
        }
        console.log("chegou uma nova requisição", new Date().getMilliseconds());

        try {
            if (req.method === "GET") {
                if (caminho === "/mensagens") {
                    return await this.obterMensagensPendentes(req, corsHeaders);
                } else if (caminho === "/usuarios") {
                    return await this.obterUsuariosNaSala(req, corsHeaders);
                }
            } else if (req.method === "POST") {
                if (caminho === "/registrar") {
                    return await this.registrarCliente(req, corsHeaders);
                } else if (caminho === "/enviar") {
                    return await this.receberMensagem(req, corsHeaders);
                } else if (caminho === "/desconectar") {
                    return await this.desconectarCliente(req, corsHeaders);
                }
            }

            return new Response("Servidor de sinalização WebRTC", {
                headers: {...corsHeaders, "Content-Type": "text/plain"},
            });
        } catch (erro) {
            console.error("Erro ao processar requisição:", erro);
            return new Response(JSON.stringify({erro: "Erro interno do servidor"}), {
                status: 500,
                headers: {...corsHeaders, "Content-Type": "application/json"},
            });
        }
    }

    private async registrarCliente(req: Request, corsHeaders: any): Promise<Response> {
        const dados = await req.json();
        const id_sala = dados.id_sala || "padrao";
        const id_cliente = crypto.randomUUID();

        this.adicionar_cliente_na_sala(id_sala, id_cliente);
        this.mensagensPendentes.set(id_cliente, []);
        this.atualizarUltimoAcesso(id_cliente);

        console.log(`Cliente ${id_cliente} registrado na sala ${id_sala}`);

        this.notificarSalaSobreNovoCliente(id_sala, id_cliente);

        return new Response(
            JSON.stringify({
                id_cliente,
                id_sala,
                mensagem: "Registrado com sucesso",
            }),
            {
                headers: {...corsHeaders, "Content-Type": "application/json"},
            }
        );
    }

    private async obterMensagensPendentes(req: Request, corsHeaders: any): Promise<Response> {
        const url = new URL(req.url);
        const id_cliente = url.searchParams.get("id_cliente");

        if (!id_cliente) {
            return new Response(JSON.stringify({erro: "ID de cliente não fornecido"}), {
                status: 400,
                headers: {...corsHeaders, "Content-Type": "application/json"},
            });
        }

        this.atualizarUltimoAcesso(id_cliente);

        const mensagens = this.mensagensPendentes.get(id_cliente) || [];
        this.mensagensPendentes.set(id_cliente, []);

        return new Response(JSON.stringify({mensagens}), {
            headers: {...corsHeaders, "Content-Type": "application/json"},
        });
    }

    private async obterUsuariosNaSala(req: Request, corsHeaders: any): Promise<Response> {
        const url = new URL(req.url);
        const id_sala = url.searchParams.get("id_sala");

        if (!id_sala) {
            return new Response(JSON.stringify({erro: "ID de sala não fornecido"}), {
                status: 400,
                headers: {...corsHeaders, "Content-Type": "application/json"},
            });
        }

        const usuarios = Array.from(this.obter_clientes_na_sala(id_sala));

        return new Response(JSON.stringify({usuarios}), {
            headers: {...corsHeaders, "Content-Type": "application/json"},
        });
    }

    private async receberMensagem(req: Request, corsHeaders: any): Promise<Response> {
        const dados = await req.json();
        const id_cliente = dados.id_cliente;
        const mensagens = dados.mensagens || [];

        if (!id_cliente) {
            return new Response(JSON.stringify({erro: "ID de cliente não fornecido"}), {
                status: 400,
                headers: {...corsHeaders, "Content-Type": "application/json"},
            });
        }

        this.atualizarUltimoAcesso(id_cliente);

        for (const mensagem of mensagens) {
            if (mensagem.para) {
                this.encaminharMensagemParaCliente(mensagem.para, mensagem);
            }
        }

        return new Response(JSON.stringify({sucesso: true}), {
            headers: {...corsHeaders, "Content-Type": "application/json"},
        });
    }

    private async desconectarCliente(req: Request, corsHeaders: any): Promise<Response> {
        const dados = await req.json();
        const id_cliente = dados.id_cliente;
        const id_sala = dados.id_sala;

        if (!id_cliente || !id_sala) {
            return new Response(JSON.stringify({erro: "Parâmetros incompletos"}), {
                status: 400,
                headers: {...corsHeaders, "Content-Type": "application/json"},
            });
        }

        this.removerCliente(id_sala, id_cliente);

        return new Response(JSON.stringify({sucesso: true}), {
            headers: {...corsHeaders, "Content-Type": "application/json"},
        });
    }

    public adicionar_cliente_na_sala(id_sala: string, id_cliente: string): void {
        if (!this.salas.has(id_sala)) {
            this.salas.set(id_sala, new Set<string>());
        }
        const sala = this.salas.get(id_sala);
        sala?.add(id_cliente);
    }

    public remover_cliente_da_sala(id_sala: string, id_cliente: string): boolean {
        if (!this.salas.has(id_sala)) {
            return false;
        }

        const sala = this.salas.get(id_sala)!;
        sala.delete(id_cliente);

        if (sala.size === 0) {
            this.salas.delete(id_sala);
            return true;
        }

        return false;
    }

    public obter_clientes_na_sala(id_sala: string): Set<string> {
        return this.salas.get(id_sala) || new Set<string>();
    }

    public sala_existe(id_sala: string): boolean {
        return this.salas.has(id_sala);
    }

    private encaminharMensagemParaCliente(id_destino: string, mensagem: MensagemSinalizacao): void {
        if (!this.mensagensPendentes.has(id_destino)) {
            this.mensagensPendentes.set(id_destino, []);
        }

        this.mensagensPendentes.get(id_destino)?.push(mensagem);
    }

    private notificarSalaSobreNovoCliente(id_sala: string, id_novo_cliente: string): void {
        const clientes = this.obter_clientes_na_sala(id_sala);

        for (const id_cliente of clientes) {
            if (id_cliente !== id_novo_cliente) {
                this.encaminharMensagemParaCliente(id_cliente, {
                    tipo: "novo-usuario",
                    id_peer: id_novo_cliente,
                });

                this.encaminharMensagemParaCliente(id_novo_cliente, {
                    tipo: "usuario-existente",
                    id_peer: id_cliente,
                });
            }
        }
    }

    private removerCliente(id_sala: string, id_cliente: string): void {
        const sala_removida = this.remover_cliente_da_sala(id_sala, id_cliente);

        this.mensagensPendentes.delete(id_cliente);
        this.ultimoAcesso.delete(id_cliente);

        if (!sala_removida && this.sala_existe(id_sala)) {
            const clientes = this.obter_clientes_na_sala(id_sala);

            for (const id_outro_cliente of clientes) {
                this.encaminharMensagemParaCliente(id_outro_cliente, {
                    tipo: "usuario-desconectado",
                    id_peer: id_cliente,
                });
            }
        }

        console.log(`Cliente ${id_cliente} removido da sala ${id_sala}`);
    }

    private atualizarUltimoAcesso(id_cliente: string): void {
        this.ultimoAcesso.set(id_cliente, Date.now());
    }

    private verificarClientesInativos(): void {
        // const agora = Date.now();
        // for (const [id_sala, clientes] of this.salas.entries()) {
        //     for (const id_cliente of clientes) {
        //         const ultimoAcesso = this.ultimoAcesso.get(id_cliente) || 0;
        //         if (agora - ultimoAcesso > this.TEMPO_LIMITE_INATIVIDADE) {
        //             console.log(`Cliente ${id_cliente} inativo por mais de ${this.TEMPO_LIMITE_INATIVIDADE}ms. Removendo...`);
        //             this.removerCliente(id_sala, id_cliente);
        //         }
        //     }
        // }
    }
}

const servidor = new ServidorSinalizacao();
servidor.iniciar_servidor(50010);
