const crypto = require("crypto");
const { API_KEY } = require("../config/env");

function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
}

function extractApiKey(req) {
    const header = req.headers["x-api-key"];
    if (typeof header === "string" && header.trim()) return header.trim();

    const auth = req.headers.authorization;
    if (typeof auth === "string") {
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (m?.[1]) return m[1].trim();
    }
    return "";
}

function requireApiKey() {
    return (req, res, next) => {
        if (!API_KEY) return next(); // backward compatible: no key configured

        const provided = extractApiKey(req);
        if (!provided || !safeEqual(provided, API_KEY)) {
            return res.status(401).json({ error: "unauthorized" });
        }
        return next();
    };
}

module.exports = {
    requireApiKey,
};

