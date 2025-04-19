class ServidorWebSocket {
    constructor(porta = 50010) {
        this.clientes = new Map();
        this.salas = new Map();

        console.log(`Iniciando servidor WebSocket na porta ${porta}`);

        this.server = Bun.serve({
            port: porta,

            websocket: {
                // Chamado quando uma conexão WebSocket é estabelecida
                open: (ws) => {
                    console.log("Nova conexão WebSocket estabelecida");
                    this.handleConnection(ws);
                },

                // Chamado quando uma mensagem é recebida
                message: (ws, message) => {
                    try {
                        console.log("Mensagem recebida:", message);
                        this.handleMessage(ws, message);
                    } catch (error) {
                        console.error("Erro ao processar mensagem:", error);
                    }
                },

                // Chamado quando a conexão é fechada
                close: (ws) => {
                    console.log("WebSocket desconectado");
                    this.handleDisconnect(ws);
                },

                // Opções de compressão e publicação
                perMessageDeflate: false,
                publishToSelf: false,
            },

            // Tratamento de requisições HTTP
            fetch: (req, server) => {
                // Tentar fazer upgrade da conexão para WebSocket
                if (server.upgrade(req)) {
                    return; // Conexão feita com sucesso
                }
            },
        });

        console.log(`Servidor iniciado na porta ${porta}`);

        // Verificar clientes inativos a cada 30 segundos
        setInterval(this.verificarClientesInativos.bind(this), 30000);
    }

    handleConnection(ws) {
        // A identificação será feita através da primeira mensagem
        console.log("Cliente conectado, aguardando mensagem de registro");
    }

    handleMessage(ws, message) {
        console.log("Mensagem enviada", message);

        try {
            const dados = JSON.parse(message);
            const {tipo} = dados;
            console.log(dados, " dados dados");

            switch (tipo) {
                case "registrar":
                    this.registrarCliente(ws, dados);
                    break;

                case "mensagem":
                    this.processarMensagem(dados);
                    break;

                case "movimento":
                    this.processarMovimento(dados);
                    break;

                case "ping":
                    this.atualizarAtividade(dados.clienteId);
                    break;

                default:
                    console.warn("Tipo de mensagem desconhecido:", tipo);
            }
        } catch (error) {
            console.error("Erro ao processar mensagem:", error);
        }
    }

    handleDisconnect(ws) {
        // Encontrar cliente pelo socket
        let clienteId = null;

        for (const [id, cliente] of this.clientes.entries()) {
            if (cliente.ws === ws) {
                clienteId = id;
                break;
            }
        }

        if (clienteId) {
            this.removerCliente(clienteId);
        }
    }

    registrarCliente(ws, dados) {
        const {nome, sala, cor} = dados;
        console.log(nome, sala, cor, "nome, sala, cor");

        if (!nome || !sala) {
            ws.send(
                JSON.stringify({
                    tipo: "erro",
                    mensagem: "Nome e sala são obrigatórios",
                })
            );
            return;
        }

        const clienteId = crypto.randomUUID();

        // Posição aleatória inicial
        const posicao = {
            x: 100 + Math.random() * 500,
            y: 100 + Math.random() * 300,
        };

        // Criar cliente
        const cliente = {
            id: clienteId,
            ws,
            sala,
            nome,
            cor: cor || "#3B82F6",
            posicao,
            ultimoAcesso: Date.now(),
        };

        // Adicionar à coleção de clientes
        this.clientes.set(clienteId, cliente);

        // Adicionar à sala
        if (!this.salas.has(sala)) {
            this.salas.set(sala, new Set());
        }
        this.salas.get(sala).add(clienteId);

        // Enviar resposta com ID
        ws.send(
            JSON.stringify({
                tipo: "registrado",
                clienteId,
                posicao,
            })
        );

        // Enviar lista de jogadores existentes na sala para o novo cliente
        const jogadoresExistentes = Array.from(this.salas.get(sala) || [])
            .filter((id) => id !== clienteId)
            .map((id) => {
                const c = this.clientes.get(id);
                return {
                    id,
                    nome: c?.nome,
                    cor: c?.cor,
                    posicao: c?.posicao,
                };
            });

        ws.send(
            JSON.stringify({
                tipo: "jogadores_existentes",
                jogadores: jogadoresExistentes,
            })
        );

        // Notificar outros na sala sobre o novo jogador
        this.enviarParaSala(
            sala,
            {
                tipo: "novo_jogador",
                jogador: {
                    id: clienteId,
                    nome,
                    cor: cor || "#3B82F6",
                    posicao,
                },
            },
            clienteId
        ); // Excluir o próprio cliente

        // Enviar mensagem de boas-vindas para a sala
        this.enviarParaSala(sala, {
            tipo: "mensagem",
            sender: "Sistema",
            texto: `${nome} entrou na sala`,
            hora: new Date().toLocaleTimeString(),
        });

        console.log(`Cliente ${clienteId} (${nome}) registrado na sala ${sala}`);
    }

    processarMensagem(dados) {
        const {clienteId, texto} = dados;

        if (!clienteId || !texto) return;

        const cliente = this.clientes.get(clienteId);
        if (!cliente) return;

        // Atualizar horário de atividade
        this.atualizarAtividade(clienteId);

        // Enviar mensagem para todos na sala
        this.enviarParaSala(cliente.sala, {
            tipo: "mensagem",
            sender: cliente.nome,
            texto,
            hora: new Date().toLocaleTimeString(),
        });

        // Adicionar balão de fala ao jogador
        this.enviarParaSala(cliente.sala, {
            tipo: "balao_fala",
            jogadorId: clienteId,
            texto,
        });
    }

    processarMovimento(dados) {
        const {clienteId, posicao} = dados;

        if (!clienteId || !posicao) return;

        const cliente = this.clientes.get(clienteId);
        if (!cliente) return;

        // Atualizar posição do cliente
        cliente.posicao = posicao;
        this.atualizarAtividade(clienteId);

        // Enviar atualização para todos na sala
        this.enviarParaSala(
            cliente.sala,
            {
                tipo: "movimento",
                jogadorId: clienteId,
                posicao,
            },
            clienteId
        ); // Não precisa mandar de volta para quem se moveu
    }

    enviarParaSala(sala, mensagem, excluirClienteId) {
        const clientesDaSala = this.salas.get(sala);
        if (!clientesDaSala) return;

        const mensagemJSON = JSON.stringify(mensagem);

        for (const id of clientesDaSala) {
            if (excluirClienteId && id === excluirClienteId) continue;

            const cliente = this.clientes.get(id);
            if (cliente && cliente.ws.readyState === WebSocket.OPEN) {
                cliente.ws.send(mensagemJSON);
            }
        }
    }

    removerCliente(clienteId) {
        const cliente = this.clientes.get(clienteId);
        if (!cliente) return;

        // Remover da sala
        const sala = cliente.sala;
        this.salas.get(sala)?.delete(clienteId);

        // Se a sala ficou vazia, removê-la
        if (this.salas.get(sala)?.size === 0) {
            this.salas.delete(sala);
        }

        // Remover da lista de clientes
        this.clientes.delete(clienteId);

        // Notificar outros na sala
        this.enviarParaSala(sala, {
            tipo: "jogador_desconectado",
            jogadorId: clienteId,
        });

        // Enviar mensagem de saída para o chat
        this.enviarParaSala(sala, {
            tipo: "mensagem",
            sender: "Sistema",
            texto: `${cliente.nome} saiu da sala`,
            hora: new Date().toLocaleTimeString(),
        });

        console.log(`Cliente ${clienteId} (${cliente.nome}) removido da sala ${sala}`);
    }

    atualizarAtividade(clienteId) {
        const cliente = this.clientes.get(clienteId);
        if (cliente) {
            cliente.ultimoAcesso = Date.now();
        }
    }

    verificarClientesInativos() {
        const agora = Date.now();
        const timeout = 2 * 60 * 1000; // 2 minutos

        for (const [id, cliente] of this.clientes.entries()) {
            if (agora - cliente.ultimoAcesso > timeout) {
                console.log(`Cliente ${id} inativo por mais de 2 minutos. Desconectando...`);
                this.removerCliente(id);

                // Fechar conexão WebSocket se ainda estiver aberta
                if (cliente.ws.readyState === WebSocket.OPEN) {
                    cliente.ws.close();
                }
            }
        }
    }
}

// Iniciar o servidor na porta padrão ou especificada
const porta = process.env.PORT ? parseInt(process.env.PORT) : 50010;
new ServidorWebSocket(porta);
