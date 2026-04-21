const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
    path: process.env.DOTENV_PATH || path.resolve(__dirname, "..", "..", ".env"),
    quiet: true,
});

module.exports = {
    PORT: Number(process.env.PORT || 3100),
    NODE_ENV: process.env.NODE_ENV || "production",
    SERVICE_NAME: process.env.SERVICE_NAME || "rpa-tracking-service",
    MONGO_URI: process.env.MONGO_URI || "mongodb://mongo:27017/rpa_tracking",
    REQUEST_TIMEOUT_MS: Number(process.env.REQUEST_TIMEOUT_MS || 3000),
    TRUST_PROXY: (process.env.TRUST_PROXY || "false").toLowerCase() === "true",

    // Security (optional): if API_KEY is set, endpoints require it.
    API_KEY: process.env.API_KEY || "",
    METRICS_PUBLIC: (process.env.METRICS_PUBLIC || "false").toLowerCase() === "true",
    CORS_ORIGINS: process.env.CORS_ORIGINS || "",
    RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX || 300),
};
