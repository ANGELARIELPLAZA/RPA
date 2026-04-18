const { createApiServer } = require("./src/server");
const { runCetelemFlowWithRetries } = require("./src/cetelem/flow");
const { DEFAULT_CLIENT_PAYLOAD, SERVER_HOST, SERVER_PORT } = require("./src/config");

async function runCli() {
    const result = await runCetelemFlowWithRetries(DEFAULT_CLIENT_PAYLOAD);

    console.log(`OK | Tiempo total: ${result.elapsedSeconds}s`);
    console.log(`Screenshot: ${result.screenshotPath}`);
    console.log(`Console log: ${result.consolePath}`);
    console.log(`Video page: ${result.videoPaths.page || "N/A"}`);
    console.log(`Video popup: ${result.videoPaths.popup || "N/A"}`);
}

function runServer() {
    const server = createApiServer();

    server.listen(SERVER_PORT, SERVER_HOST, () => {
        console.log(`Servidor escuchando en http://${SERVER_HOST}:${SERVER_PORT}`);
    });
}

async function main() {
    const command = process.argv[2] || "server";

    if (command === "run") {
        await runCli();
        return;
    }

    if (command === "server") {
        runServer();
        return;
    }

    throw new Error(`Comando no soportado: ${command}`);
}

main().catch((error) => {
    console.error("Fallo no controlado:", error.message);
    process.exit(1);
});
