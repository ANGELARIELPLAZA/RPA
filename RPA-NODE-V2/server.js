const { SERVER_HOST, SERVER_PORT, MONITOR_ENABLED, MONITOR_REFRESH_MS } = require("./config");
const logger = require("./core/logger");
const { createApp } = require("./app");
const { getHealthSnapshot } = require("./services/health.service");
const { startConsoleMonitor } = require("./services/consoleMonitor.service");
const BrowserManager = require("./core/browser-manager");

async function main() {
    const app = createApp();

    const server = app.listen(SERVER_PORT, SERVER_HOST, () => {
        logger.info(`[server] listening http://${SERVER_HOST}:${SERVER_PORT}`);
    });

    const monitor = startConsoleMonitor(getHealthSnapshot, {
        enabled: MONITOR_ENABLED,
        refreshMs: MONITOR_REFRESH_MS,
        maxTasks: 10,
    });

    async function shutdown(signal) {
        logger.warn(`[server] shutdown (${signal})`);
        monitor.stop();
        server.close(() => { });
        await BrowserManager.shutdown().catch(() => { });
        process.exit(0);
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});

