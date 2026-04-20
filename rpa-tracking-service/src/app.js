const express = require("express");
const logger = require("./utils/logger");

const healthRoutes = require("./routes/health.routes");
const executionsRoutes = require("./routes/executions.routes");
const eventsRoutes = require("./routes/events.routes");
const metricsRoutes = require("./routes/metrics.routes");
const errorHandler = require("./middlewares/errorHandler");

function createApp() {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "2mb" }));

    app.use(healthRoutes);
    app.use(executionsRoutes);
    app.use(eventsRoutes);
    app.use(metricsRoutes);

    app.get("/", (req, res) => res.json({ service: "rpa-tracking-service", ok: true }));

    app.use((req, res) => res.status(404).json({ error: "not_found" }));
    app.use(errorHandler);

    return app;
}

module.exports = {
    createApp,
};

