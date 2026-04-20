const logger = require("../utils/logger");

function errorHandler(err, req, res, next) {
    logger.error(`[http] ${err?.message || err}`);
    res.status(500).json({ error: "internal_error" });
}

module.exports = errorHandler;

