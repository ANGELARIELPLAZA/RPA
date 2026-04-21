const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { CORS_ORIGINS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, TRUST_PROXY } = require("./config/env");

const healthRoutes = require("./routes/health.routes");
const executionsRoutes = require("./routes/executions.routes");
const eventsRoutes = require("./routes/events.routes");
const metricsRoutes = require("./routes/metrics.routes");
const errorHandler = require("./middlewares/errorHandler");

function createApp() {
    const app = express();
    if (TRUST_PROXY) app.set("trust proxy", 1);
    app.disable("x-powered-by");
    app.use(helmet({ crossOriginResourcePolicy: false }));

    if (CORS_ORIGINS && typeof CORS_ORIGINS === "string") {
        const allow = CORS_ORIGINS.split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        if (allow.length) {
            app.use(cors({ origin: allow, credentials: false }));
        }
    }

    app.use(
        rateLimit({
            windowMs: RATE_LIMIT_WINDOW_MS,
            limit: RATE_LIMIT_MAX,
            standardHeaders: true,
            legacyHeaders: false,
        })
    );
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
