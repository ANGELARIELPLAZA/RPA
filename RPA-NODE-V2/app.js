const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { SCREENSHOTS_DIR, SCREENSHOTS_PUBLIC, CORS_ORIGINS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, TRUST_PROXY } = require("./config");
const logger = require("./core/logger");
const { requireApiKey } = require("./middlewares/apiKeyAuth");

const healthRoutes = require("./routes/health");
const statusRoutes = require("./routes/status");
const cetelemRoutes = require("./routes/cetelem");
const tasksRoutes = require("./routes/tasks");

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

    // Screenshots públicos
    const screenshotsAuth = SCREENSHOTS_PUBLIC ? (req, res, next) => next() : requireApiKey();
    app.use("/screenshots", screenshotsAuth, express.static(SCREENSHOTS_DIR, { fallthrough: false }));

    app.use(healthRoutes);
    app.use(statusRoutes);
    app.use(tasksRoutes);
    app.use(cetelemRoutes);

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
