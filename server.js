class ServidorWebSocket {
    constructor(porta = 50010) {
        this.clientes = new Map();
        this.salas = new Map();

        this.server = Bun.serve({
            port: porta,

            websocket: {
                message: (ws, message) => this.handle_message(ws, message),
                close: (ws) => this.handle_disconnect(ws),
                perMessageDeflate: false,
                publishToSelf: false,
            },

            fetch: (req, server) => {
                if (server.upgrade(req)) return;
            },
        });

        setInterval(this.verificar_clientes_inativos.bind(this), 30000);
    }

    handle_message(ws, message) {
        try {
            const dados = JSON.parse(message);
            const {tipo} = dados;

            switch (tipo) {
                case "registrar":
                    this.registrar_cliente(ws, dados);
                    break;
                case "mensagem":
                    this.processar_mensagem(dados);
                    break;
                case "movimento":
                    this.processar_movimento(dados);
                    break;
                case "ping":
                    this.atualizar_atividade(dados.clienteId);
                    break;
                default:
            }
        } catch (error) {}
    }

    handle_disconnect(ws) {
        let clienteId = null;

        for (const [id, cliente] of this.clientes.entries()) {
            if (cliente.ws === ws) {
                clienteId = id;
                break;
            }
        }

        if (clienteId) this.remover_cliente(clienteId);
    }

    registrar_cliente(ws, dados) {
        const {nome, sala, cor} = dados;

        if (!nome || !sala) {
            ws.send(JSON.stringify({tipo: "erro", mensagem: "Nome e sala são obrigatórios"}));
            return;
        }

        const clienteId = crypto.randomUUID();

        const posicao = {x: 100 + Math.random() * 500, y: 100 + Math.random() * 300};

        const cliente = {id: clienteId, ws, sala, nome, cor: cor || "#3B82F6", posicao, ultimoAcesso: Date.now()};

        this.clientes.set(clienteId, cliente);

        if (!this.salas.has(sala)) this.salas.set(sala, new Set());

        this.salas.get(sala).add(clienteId);

        ws.send(JSON.stringify({tipo: "registrado", clienteId, posicao}));

        const jogadoresExistentes = Array.from(this.salas.get(sala) || [])
            .filter((id) => id !== clienteId)
            .map((id) => {
                const c = this.clientes.get(id);
                return {id, nome: c?.nome, cor: c?.cor, posicao: c?.posicao};
            });

        ws.send(JSON.stringify({tipo: "jogadores_existentes", jogadores: jogadoresExistentes}));

        this.enviar_para_sala(sala, {tipo: "novo_jogador", jogador: {id: clienteId, nome, cor: cor || "#3B82F6", posicao}}, clienteId);

        this.enviar_para_sala(sala, {tipo: "mensagem", sender: "Sistema", texto: `${nome} entrou na sala`, hora: new Date().toLocaleTimeString()});
    }

    processar_mensagem(dados) {
        const {clienteId, texto} = dados;

        if (!clienteId || !texto) return;

        const cliente = this.clientes.get(clienteId);
        if (!cliente) return;

        this.atualizar_atividade(clienteId);

        this.enviar_para_sala(cliente.sala, {tipo: "mensagem", sender: cliente.nome, texto, hora: new Date().toLocaleTimeString()});

        this.enviar_para_sala(cliente.sala, {tipo: "balao_fala", jogadorId: clienteId, texto});
    }

    processar_movimento(dados) {
        const {clienteId, posicao} = dados;

        if (!clienteId || !posicao) return;

        const cliente = this.clientes.get(clienteId);
        if (!cliente) return;

        cliente.posicao = posicao;
        this.atualizar_atividade(clienteId);

        this.enviar_para_sala(cliente.sala, {tipo: "movimento", jogadorId: clienteId, posicao}, clienteId);
    }

    enviar_para_sala(sala, mensagem, excluirClienteId) {
        const clientesDaSala = this.salas.get(sala);
        if (!clientesDaSala) return;

        const mensagemJSON = JSON.stringify(mensagem);

        for (const id of clientesDaSala) {
            if (excluirClienteId && id === excluirClienteId) continue;

            const cliente = this.clientes.get(id);
            if (cliente && cliente.ws.readyState === WebSocket.OPEN) cliente.ws.send(mensagemJSON);
        }
    }

    remover_cliente(clienteId) {
        const cliente = this.clientes.get(clienteId);
        if (!cliente) return;

        const sala = cliente.sala;
        this.salas.get(sala)?.delete(clienteId);

        if (this.salas.get(sala)?.size === 0) this.salas.delete(sala);

        this.clientes.delete(clienteId);

        this.enviar_para_sala(sala, {tipo: "jogador_desconectado", jogadorId: clienteId});

        this.enviar_para_sala(sala, {tipo: "mensagem", sender: "Sistema", texto: `${cliente.nome} saiu da sala`, hora: new Date().toLocaleTimeString()});
    }

    atualizar_atividade(clienteId) {
        const cliente = this.clientes.get(clienteId);
        if (cliente) cliente.ultimoAcesso = Date.now();
    }

    verificar_clientes_inativos() {
        const agora = Date.now();
        const timeout = 2 * 60 * 1000;

        for (const [id, cliente] of this.clientes.entries()) {
            if (agora - cliente.ultimoAcesso > timeout) {
                this.remover_cliente(id);

                if (cliente.ws.readyState === WebSocket.OPEN) {
                    cliente.ws.close();
                }
            }
        }
    }
}

const porta = process.env.PORT ? parseInt(process.env.PORT) : 50010;
new ServidorWebSocket(porta);
