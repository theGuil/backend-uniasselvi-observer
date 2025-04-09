import {serve} from "bun";

interface DadosCliente {
    id: string;
    id_sala: string;
}

interface WebSocketComDados extends WebSocket {
    data: DadosCliente;
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

interface GerenciadorConexoes {
    adicionar_conexao(id_cliente: string, ws: WebSocketComDados): void;
    remover_conexao(id_cliente: string): void;
    obter_conexao(id_cliente: string): WebSocketComDados | undefined;
    conexao_existe(id_cliente: string): boolean;
}

class ServidorSinalizacao implements GerenciadorSalas, GerenciadorConexoes {
    private salas: Map<string, Set<string>>;
    private conexoes: Map<string, WebSocketComDados>;
    private readonly ABERTO: number;

    constructor() {
        this.salas = new Map<string, Set<string>>();
        this.conexoes = new Map<string, WebSocketComDados>();
        this.ABERTO = WebSocket.OPEN;
    }

    public iniciar_servidor(porta: number = 3000): void {
        serve({
            port: porta,
            fetch: this.processar_requisicao.bind(this),
        });

        console.log(`Servidor de sinalização iniciado na porta ${porta}`);
    }

    private processar_requisicao(req: Request, servidor: any): Response {
        if (req.headers.get("upgrade") === "websocket") {
            const url = new URL(req.url);
            const id_sala = url.searchParams.get("roomId") || "padrao";

            const upgrade = servidor.upgrade(req, {
                data: {id_sala, id: crypto.randomUUID()},
            });

            const ws = upgrade[0] as WebSocketComDados;
            const resposta = upgrade[1];

            if (!ws) {
                return new Response("Falha no upgrade para WebSocket", {status: 500});
            }

            this.configurar_websocket_para_novo_cliente(ws);
            return resposta;
        }

        return new Response("Servidor de sinalização WebRTC em execução!", {
            headers: {"Content-Type": "text/plain"},
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

    public adicionar_conexao(id_cliente: string, ws: WebSocketComDados): void {
        this.conexoes.set(id_cliente, ws);
    }

    public remover_conexao(id_cliente: string): void {
        this.conexoes.delete(id_cliente);
    }

    public obter_conexao(id_cliente: string): WebSocketComDados | undefined {
        return this.conexoes.get(id_cliente);
    }

    public conexao_existe(id_cliente: string): boolean {
        return this.conexoes.has(id_cliente);
    }

    private configurar_websocket_para_novo_cliente(ws: WebSocketComDados): void {
        const id_cliente = ws.data.id;
        const id_sala = ws.data.id_sala;

        this.adicionar_conexao(id_cliente, ws);
        this.adicionar_cliente_na_sala(id_sala, id_cliente);

        console.log(`Cliente ${id_cliente} conectado à sala ${id_sala}`);

        this.enviar_mensagem_para_cliente(ws, {
            tipo: "conexao-estabelecida",
            id_cliente,
            id_sala,
        });

        const clientes_na_sala = this.obter_clientes_na_sala(id_sala);
        clientes_na_sala.forEach((id_peer) => {
            if (id_peer !== id_cliente) {
                this.enviar_mensagem_para_cliente(ws, {
                    tipo: "usuario-existente",
                    id_peer,
                });

                const ws_peer = this.obter_conexao(id_peer);
                if (ws_peer && ws_peer.readyState === this.ABERTO) {
                    this.enviar_mensagem_para_cliente(ws_peer, {
                        tipo: "novo-usuario",
                        id_peer: id_cliente,
                    });
                }
            }
        });

        this.configurar_manipulador_de_mensagens_recebidas(ws, id_cliente);
        this.configurar_manipulador_para_desconexao_de_cliente(ws, id_cliente, id_sala);
    }

    private configurar_manipulador_de_mensagens_recebidas(ws: WebSocketComDados, id_cliente: string): void {
        ws.onmessage = (evento: MessageEvent) => {
            try {
                const mensagem = JSON.parse(evento.data as string) as MensagemSinalizacao;

                if (mensagem.para && this.conexao_existe(mensagem.para)) {
                    const ws_destino = this.obter_conexao(mensagem.para);
                    if (ws_destino && ws_destino.readyState === this.ABERTO) {
                        mensagem.de = id_cliente;
                        this.enviar_mensagem_para_cliente(ws_destino, mensagem);
                    }
                }
            } catch (erro) {
                console.error("Erro ao processar mensagem recebida:", erro);
            }
        };
    }

    private configurar_manipulador_para_desconexao_de_cliente(ws: WebSocketComDados, id_cliente: string, id_sala: string): void {
        ws.onclose = () => {
            console.log(`Cliente ${id_cliente} desconectado da sala ${id_sala}`);

            const sala_foi_removida = this.remover_cliente_da_sala(id_sala, id_cliente);

            if (sala_foi_removida) {
                console.log(`Sala ${id_sala} removida por estar vazia`);
            } else if (this.sala_existe(id_sala)) {
                this.notificar_sala_sobre_desconexao_de_cliente(id_sala, id_cliente);
            }

            this.remover_conexao(id_cliente);
        };
    }

    private notificar_sala_sobre_desconexao_de_cliente(id_sala: string, id_cliente_desconectado: string): void {
        const sala = this.obter_clientes_na_sala(id_sala);
        sala.forEach((id_peer) => {
            const ws_peer = this.obter_conexao(id_peer);
            if (ws_peer && ws_peer.readyState === this.ABERTO) {
                this.enviar_mensagem_para_cliente(ws_peer, {
                    tipo: "usuario-desconectado",
                    id_peer: id_cliente_desconectado,
                });
            }
        });
    }

    private enviar_mensagem_para_cliente(ws: WebSocketComDados, mensagem: MensagemSinalizacao): void {
        ws.send(JSON.stringify(mensagem));
    }
}

const servidor = new ServidorSinalizacao();
servidor.iniciar_servidor(3000);
