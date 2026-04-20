const fs = require("fs");
const http = require("http");
const path = require("path");
const { runCetelemFlow } = require("./cetelem/flow");
const { normalizeCetelemPayload } = require("./cetelem/normalize-payload");
const { getActiveContextCount, getPendingTaskCount } = require("./core/context-queue");
const logger = require("./core/logger");
const { getMemorySnapshot, shortTaskId } = require("./core/task-logger");
const { SCREENSHOTS_DIR, isRecordVideoEnabled, setRecordVideoEnabled } = require("./config");
const { createJob, deleteExpiredJobs, getJob, serializeJob, updateJob } = require("./jobs/store");

function createApiServer() {
    return http.createServer(async (request, response) => {
        try {
            deleteExpiredJobs();

            if (request.method === "POST" && request.url === "/cotizar-cetelem-async") {
                const payload = normalizeCetelemPayload(await readJsonBody(request));
                const job = createJob(payload);

                void executeJob(job.id, payload).catch((error) => {
                    logger.error(`[task ${shortTaskId(job.id)}] executeJob fallo de forma no controlada: ${error.message}`);
                    updateJob(job.id, {
                        status: "failed",
                        error: error.message,
                        result: {
                            consolePath: null,
                            elapsedSeconds: null,
                            errorScreenshot: false,
                            screenshotPath: null,
                        },
                    });
                });

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
                sendJson(response, 200, {
                    ok: true,
                    activeContexts: getActiveContextCount(),
                    queuedTasks: getPendingTaskCount(),
                    recordVideo: isRecordVideoEnabled(),
                    memory: getMemorySnapshot(),
                });
                return;
            }

            if (request.method === "GET" && request.url === "/record-video") {
                sendJson(response, 200, {
                    enabled: isRecordVideoEnabled(),
                });
                return;
            }

            if (request.method === "POST" && request.url === "/record-video") {
                const payload = await readJsonBody(request);
                const enabled = payload.enabled ?? payload.recordVideo;

                if (typeof enabled !== "boolean") {
                    sendJson(response, 400, { error: "enabled debe ser boolean" });
                    return;
                }

                sendJson(response, 200, {
                    enabled: setRecordVideoEnabled(enabled),
                });
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

                if (!["completed", "failed"].includes(job.status) || !job.result?.screenshotPath) {
                    sendJson(response, 409, { error: "La imagen aun no esta lista", status: job.status });
                    return;
                }

                const imageBuffer = job.result.screenshotBuffer || readResultScreenshot(job.result.screenshotPath);

                response.writeHead(200, {
                    "Content-Type": "image/png",
                    "Content-Length": Buffer.byteLength(imageBuffer),
                    "X-Screenshot-Path": job.result.screenshotPath,
                    "X-Console-Path": job.result.consolePath || "",
                    "X-Elapsed-Seconds": String(job.result.elapsedSeconds || ""),
                });
                response.end(imageBuffer);
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

                if (!["completed", "failed"].includes(job.status) || !job.result?.screenshotPath) {
                    sendJson(response, 409, { error: "El resultado aun no esta listo", status: job.status });
                    return;
                }

                const imageBuffer = job.result.screenshotBuffer || readResultScreenshot(job.result.screenshotPath);

                sendJson(response, 200, {
                    status: job.status,
                    error: job.error,
                    screenshotRaw: imageBuffer.toString("base64"),
                    screenshotPath: job.result.screenshotPath,
                    consolePath: job.result.consolePath,
                    elapsedSeconds: job.result.elapsedSeconds,
                    errorScreenshot: Boolean(job.result.errorScreenshot),
                    executedFlows: job.result.executedFlows || [],
                    stageTimings: job.result.stageTimings || [],
                    insuranceMonthlyFee: job.result.insuranceMonthlyFee || null,
                    insuranceOptions: job.result.insuranceOptions || [],
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
            logger.error(`Error en la API: ${error.message}`);
            sendJson(response, 500, { error: error.message });
        }
    });
}

async function executeJob(taskId, payload) {
    updateJob(taskId, { status: "running", error: null });
    const startedAt = performance.now();
    logger.info(`[task ${shortTaskId(taskId)}] created`);

    try {
        const result = await runCetelemFlow(payload);
        result.elapsedSeconds = result.elapsedSeconds ?? Number(((performance.now() - startedAt) / 1000).toFixed(2));
        updateJob(taskId, {
            status: "completed",
            result,
            error: null,
        });
        logger.info(
            `[task ${shortTaskId(taskId)}] exited code=0 time=${Number(((performance.now() - startedAt) / 1000).toFixed(2))}s screenshot=${result.screenshotPath}`
        );
    } catch (error) {
        updateJob(taskId, {
            status: "failed",
            result: {
                consolePath: error.consolePath || null,
                elapsedSeconds: error.elapsedSeconds || Number(((performance.now() - startedAt) / 1000).toFixed(2)),
                errorScreenshot: Boolean(error.screenshotPath || error.errorScreenshotPath),
                screenshotPath: error.screenshotPath || error.errorScreenshotPath || null,
            },
            error: error.message,
        });
        logger.error(
            `[task ${shortTaskId(taskId)}] exited code=1 time=${Number(((performance.now() - startedAt) / 1000).toFixed(2))}s screenshot=${error.screenshotPath || error.errorScreenshotPath || "N/A"} error="${error.message}"`
        );
    }
}

function readResultScreenshot(screenshotPath) {
    if (!screenshotPath || !isPathInsideDirectory(screenshotPath, SCREENSHOTS_DIR) || !fs.existsSync(screenshotPath)) {
        throw new Error("Screenshot no encontrada");
    }

    return fs.readFileSync(screenshotPath);
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
