const http = require("http");
const { runCetelemFlowWithRetries } = require("./cetelem/flow");

function createApiServer() {
    return http.createServer(async (request, response) => {
        try {
            if (request.method === "POST" && request.url === "/cotizar-cetelem-async") {
                const payload = await readJsonBody(request);
                const result = await runCetelemFlowWithRetries(payload);

                response.writeHead(200, {
                    "Content-Type": "image/png",
                    "Content-Length": Buffer.byteLength(result.screenshotBuffer),
                    "X-Screenshot-Path": result.screenshotPath,
                    "X-Console-Path": result.consolePath,
                    "X-Elapsed-Seconds": String(result.elapsedSeconds),
                });
                response.end(result.screenshotBuffer);
                return;
            }

            if (request.method === "GET" && request.url === "/health") {
                sendJson(response, 200, { ok: true });
                return;
            }

            sendJson(response, 404, { error: "Ruta no encontrada" });
        } catch (error) {
            console.error("Error en la API:", error.message);
            sendJson(response, 500, { error: error.message });
        }
    });
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

module.exports = {
    createApiServer,
};
