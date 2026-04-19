const { createApiServer } = require("./src/server");
const BrowserManager = require("./src/core/browser-manager");
const { runCetelemFlowWithRetries } = require("./src/cetelem/flow");
const { DEFAULT_CLIENT_PAYLOAD, SERVER_HOST, SERVER_PORT } = require("./src/config");

async function runCli() {
    try {
        const result = await runCetelemFlowWithRetries(DEFAULT_CLIENT_PAYLOAD);

        console.log(`OK | Tiempo total: ${result.elapsedSeconds}s`);
        console.log(`Flujos ejecutados: ${(result.executedFlows || []).join(", ") || "N/A"}`);
        console.log(`Vehicle total amount: ${result.vehicleTotalAmount?.raw || "N/A"}`);
        console.log(`Screenshot: ${result.screenshotPath}`);
        console.log(`Console log: ${result.consolePath}`);
    } finally {
        await BrowserManager.shutdown();
    }
}

async function runServer() {
    await BrowserManager.init();

    const server = createApiServer();

    server.listen(SERVER_PORT, SERVER_HOST, () => {
        console.log(`Servidor escuchando en http://${SERVER_HOST}:${SERVER_PORT}`);
    });

    async function shutdown(signal) {
        console.log(`Recibido ${signal}. Cerrando servidor...`);
        server.close(async () => {
            await BrowserManager.shutdown();
            process.exit(0);
        });
    }

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

async function main() {
    const command = process.argv[2] || "server";

    if (command === "run") {
        await runCli();
        return;
    }

    if (command === "server") {
        await runServer();
        return;
    }

    throw new Error(`Comando no soportado: ${command}`);
}

main().catch((error) => {
    console.error("Fallo no controlado:", error.message);
    process.exit(1);
});
