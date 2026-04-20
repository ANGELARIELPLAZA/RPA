const {
    TRACKING_ENABLED,
    TRACKING_SERVICE_URL,
    TRACKING_TIMEOUT_MS,
} = require("../config");
const logger = require("../core/logger");
const http = require("http");
const https = require("https");
const { URL } = require("url");

function isEnabled() {
    return Boolean(TRACKING_ENABLED) && Boolean(TRACKING_SERVICE_URL);
}

async function postJson(url, body, timeoutMs) {
    if (typeof fetch !== "function") {
        return requestJson(url, "POST", body, timeoutMs);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body || {}),
            signal: controller.signal,
        });

        return { ok: res.ok, status: res.status };
    } finally {
        clearTimeout(timer);
    }
}

async function patchJson(url, body, timeoutMs) {
    if (typeof fetch !== "function") {
        return requestJson(url, "PATCH", body, timeoutMs);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body || {}),
            signal: controller.signal,
        });

        return { ok: res.ok, status: res.status };
    } finally {
        clearTimeout(timer);
    }
}

function requestJson(url, method, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === "https:" ? https : http;
        const payload = JSON.stringify(body || {});

        const req = mod.request(
            {
                method,
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port,
                path: `${parsed.pathname}${parsed.search}`,
                headers: {
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(payload),
                },
            },
            (res) => {
                res.resume();
                resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
            }
        );

        req.on("error", reject);
        req.setTimeout(timeoutMs, () => {
            const err = new Error("timeout");
            err.code = "ETIMEDOUT";
            req.destroy(err);
        });

        req.write(payload);
        req.end();
    });
}

function fireAndForget(promise) {
    Promise.resolve(promise).catch((error) => {
        logger.warn(`[tracking] warning: ${error?.message || error}`);
    });
}

function createExecution(payload) {
    if (!isEnabled()) return;
    const url = `${TRACKING_SERVICE_URL.replace(/\/+$/, "")}/executions`;
    fireAndForget(postJson(url, payload, TRACKING_TIMEOUT_MS));
}

function updateExecution(taskId, patch) {
    if (!isEnabled()) return;
    const url = `${TRACKING_SERVICE_URL.replace(/\/+$/, "")}/executions/${encodeURIComponent(taskId)}`;
    fireAndForget(patchJson(url, patch, TRACKING_TIMEOUT_MS));
}

function createEvent(payload) {
    if (!isEnabled()) return;
    const url = `${TRACKING_SERVICE_URL.replace(/\/+$/, "")}/events`;
    fireAndForget(postJson(url, payload, TRACKING_TIMEOUT_MS));
}

module.exports = {
    createEvent,
    createExecution,
    isEnabled,
    updateExecution,
};
