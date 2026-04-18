const fs = require("fs");
const http = require("http");
const path = require("path");
const { runCetelemFlowWithRetries } = require("./cetelem/flow");
const { SCREENSHOTS_DIR } = require("./config");
const { createJob, deleteExpiredJobs, getJob, serializeJob, updateJob } = require("./jobs/store");

function createApiServer() {
    return http.createServer(async (request, response) => {
        try {
            deleteExpiredJobs();

            if (request.method === "POST" && request.url === "/cotizar-cetelem-async") {
                const payload = await readJsonBody(request);
                const job = createJob(payload);

                void executeJob(job.id, payload);

                sendJson(response, 202, {
                    task_id: job.id,
                    status: job.status,
                    statusUrl: `/status/${job.id}`,
                    imageUrl: `/cotizar-cetelem-async/${job.id}/image`,
                    resultUrl: `/cotizar-cetelem-async/${job.id}/result`,
                });
                return;
            }

            if (request.method === "GET" && (request.url === "/health" || request.url === "/healthz")) {
                sendJson(response, 200, { ok: true });
                return;
            }

            const statusMatch = request.method === "GET"
                ? request.url.match(/^\/status\/([a-f0-9-]+)$/)
                : null;

            if (statusMatch) {
                const job = getJob(statusMatch[1]);

                if (!job) {
                    sendJson(response, 404, { error: "Task no encontrada" });
                    return;
                }

                sendJson(response, 200, serializeJob(job));
                return;
            }

            const imageMatch = request.method === "GET"
                ? request.url.match(/^\/cotizar-cetelem-async\/([a-f0-9-]+)\/image$/)
                : null;

            if (imageMatch) {
                const job = getJob(imageMatch[1]);

                if (!job) {
                    sendJson(response, 404, { error: "Task no encontrada" });
                    return;
                }

                if (job.status !== "completed" || !job.result?.screenshotBuffer) {
                    sendJson(response, 409, { error: "La imagen aun no esta lista", status: job.status });
                    return;
                }

                response.writeHead(200, {
                    "Content-Type": "image/png",
                    "Content-Length": Buffer.byteLength(job.result.screenshotBuffer),
                    "X-Screenshot-Path": job.result.screenshotPath,
                    "X-Console-Path": job.result.consolePath,
                    "X-Elapsed-Seconds": String(job.result.elapsedSeconds),
                });
                response.end(job.result.screenshotBuffer);
                return;
            }

            const resultMatch = request.method === "GET"
                ? request.url.match(/^\/cotizar-cetelem-async\/([a-f0-9-]+)\/result$/)
                : null;

            if (resultMatch) {
                const job = getJob(resultMatch[1]);

                if (!job) {
                    sendJson(response, 404, { error: "Task no encontrada" });
                    return;
                }

                if (job.status !== "completed" || !job.result?.screenshotBuffer) {
                    sendJson(response, 409, { error: "El resultado aun no esta listo", status: job.status });
                    return;
                }

                sendJson(response, 200, {
                    screenshotRaw: job.result.screenshotBuffer.toString("base64"),
                    screenshotPath: job.result.screenshotPath,
                    consolePath: job.result.consolePath,
                    elapsedSeconds: job.result.elapsedSeconds,
                    vehiclePriceTax: job.result.vehiclePriceTax || null,
                    vehicleTotalAmount: job.result.vehicleTotalAmount || null,
                });
                return;
            }

            const screenshotFileName = resolveScreenshotFileName(request.method, request.url);

            if (screenshotFileName) {
                const screenshotPath = path.join(SCREENSHOTS_DIR, screenshotFileName);

                if (!isPathInsideDirectory(screenshotPath, SCREENSHOTS_DIR) || !fs.existsSync(screenshotPath)) {
                    sendJson(response, 404, { error: "Screenshot no encontrada" });
                    return;
                }

                const stat = fs.statSync(screenshotPath);

                response.writeHead(200, {
                    "Content-Type": "image/png",
                    "Content-Length": stat.size,
                    "Cache-Control": "no-store",
                });
                fs.createReadStream(screenshotPath).pipe(response);
                return;
            }

            sendJson(response, 404, { error: "Ruta no encontrada" });
        } catch (error) {
            console.error("Error en la API:", error.message);
            sendJson(response, 500, { error: error.message });
        }
    });
}

async function executeJob(taskId, payload) {
    updateJob(taskId, { status: "running", error: null });

    try {
        const result = await runCetelemFlowWithRetries(payload);
        updateJob(taskId, {
            status: "completed",
            result,
            error: null,
        });
    } catch (error) {
        updateJob(taskId, {
            status: "failed",
            error: error.message,
        });
    }
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];

        request.on("data", (chunk) => {
            chunks.push(chunk);
        });

        request.on("end", () => {
            const rawBody = Buffer.concat(chunks).toString("utf8").trim();

            if (!rawBody) {
                reject(new Error("El body JSON es obligatorio"));
                return;
            }

            try {
                resolve(JSON.parse(rawBody));
            } catch {
                reject(new Error("El body no contiene un JSON valido"));
            }
        });

        request.on("error", reject);
    });
}

function sendJson(response, statusCode, payload) {
    const body = JSON.stringify(payload);

    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
}

function resolveScreenshotFileName(method, requestUrl) {
    if (method !== "GET" || !requestUrl) {
        return null;
    }

    const cleanUrl = requestUrl.split("?")[0];
    const match = cleanUrl.match(/(?:^|\/)screenshots\/([^/]+\.png)$/i);

    return match ? path.basename(match[1]) : null;
}

function isPathInsideDirectory(targetPath, baseDir) {
    const relativePath = path.relative(baseDir, targetPath);
    return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

module.exports = {
    createApiServer,
};
