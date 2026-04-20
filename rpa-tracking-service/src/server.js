const { PORT, SERVICE_NAME } = require("./config/env");
const logger = require("./utils/logger");
const { connectDb } = require("./config/db");
const { createApp } = require("./app");

async function main() {
    await connectDb();
    const app = createApp();
    app.listen(PORT, "0.0.0.0", () => {
        logger.info(`[${SERVICE_NAME}] listening :${PORT}`);
    });
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});

