const { CETELEM_URL, PING_TIMEOUT_MS } = require("../config");
const http = require("http");
const https = require("https");
const { URL } = require("url");

let cache = null;
let cacheAt = 0;
const CACHE_TTL_MS = 10_000;

function isTransientNetworkError(code) {
    return ["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND"].includes(String(code || ""));
}

async function fetchWithTimeout(url, timeoutMs) {
    if (typeof fetch !== "function") {
        throw Object.assign(new Error("fetch no disponible en este runtime"), { code: "NO_FETCH" });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        // Node 18+ (o undici) expone fetch global. Si no existe, esto fallará y lo capturamos.
        const res = await fetch(url, {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
        });
        return res;
    } finally {
        clearTimeout(timer);
    }
}

function requestWithTimeout(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === "https:" ? https : http;

        const req = mod.request(
            {
                method: "GET",
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port,
                path: `${parsed.pathname}${parsed.search}`,
                headers: {
                    "user-agent": "rpa-node-v2/portal-health",
                    accept: "*/*",
                },
            },
            (res) => {
                res.resume();
                resolve({ status: res.statusCode });
            }
        );

        req.on("error", reject);
        req.setTimeout(timeoutMs, () => {
            const err = new Error("timeout");
            err.code = "ETIMEDOUT";
            req.destroy(err);
        });
        req.end();
    });
}

async function pingPortal(options = {}) {
    const url = options.url || CETELEM_URL;
    const timeoutMs = Number(options.timeoutMs || PING_TIMEOUT_MS);

    const started = Date.now();
    try {
        const res = typeof fetch === "function"
            ? await fetchWithTimeout(url, timeoutMs)
            : await requestWithTimeout(url, timeoutMs);
        const responseMs = Date.now() - started;
        const http_code = res.status;

        const available = http_code >= 200 && http_code < 500 && http_code !== 502 && http_code !== 503;

        return {
            ok: available,
            available,
            http_code,
            response_ms: responseMs,
            url,
        };
    } catch (error) {
        const responseMs = Date.now() - started;
        const code = error?.name === "AbortError" ? "ETIMEDOUT" : error?.code;

        return {
            ok: false,
            available: false,
            http_code: null,
            response_ms: responseMs,
            url,
            error: {
                message: error?.message || String(error),
                code: code || null,
                transient: isTransientNetworkError(code) || code === "ETIMEDOUT",
            },
        };
    }
}

async function getPortalStatusCached(options = {}) {
    const now = Date.now();
    if (cache && now - cacheAt < CACHE_TTL_MS) {
        return cache;
    }

    cache = await pingPortal(options);
    cacheAt = now;
    return cache;
}

module.exports = {
    getPortalStatusCached,
    pingPortal,
};
