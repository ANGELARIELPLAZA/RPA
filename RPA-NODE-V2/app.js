const express = require("express");
const { SCREENSHOTS_DIR } = require("./config");
const logger = require("./core/logger");

const healthRoutes = require("./routes/health");
const statusRoutes = require("./routes/status");
const cetelemRoutes = require("./routes/cetelem");
const tasksRoutes = require("./routes/tasks");
const bancoRoutes = require("./routes/banco");

function createApp() {
    const app = express();

    app.disable("x-powered-by");
    app.use(express.json({ limit: "2mb" }));

    // Screenshots públicos
    app.use("/screenshots", express.static(SCREENSHOTS_DIR, { fallthrough: false }));

    app.use(healthRoutes);
    app.use(statusRoutes);
    app.use(tasksRoutes);
    app.use(cetelemRoutes);
    app.use(bancoRoutes);

    app.get("/", (req, res) => {
        res.json({ service: "RPA-NODE-V2", ok: true });
    });

    app.use((err, req, res, next) => {
        logger.error(`[http] ${err?.message || err}`);
        res.status(500).json({ error: "internal_error" });
    });

    return app;
}

module.exports = {
    createApp,
};
