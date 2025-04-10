module.exports = {
    apps: [
        {
            name: "producao-backend-uniasselvi-observer", // Nome do processo
            script: "bun", // Script a ser executado
            args: "run producao", // Argumentos para o script
            autorestart: true, // Reinicia automaticamente em caso de falha
            watch: false, // Desabilita o modo watch (recomendado para produção)
            max_memory_restart: "1G", // Reinicia se o uso de memória exceder 1GB
            autostart: true, // Não inicia automaticamente ao rodar o ecosystem
            env: {
                NODE_ENV: "producao", // Mantém o nome do ambiente consistente
            },
            env_file: ".env.producao", // Carrega automaticamente o arquivo de ambiente correto
        },
    ],
};
