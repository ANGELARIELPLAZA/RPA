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
};

