const http = require("http");
const { runCetelemFlowWithRetries } = require("./cetelem/flow");
const { normalizeBatchPayload, processMassiveClients } = require("./batch");
const { SERVER_PORT } = require("./config");

function createApiServer() {
  return http.createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/cetelem-cotizar-async") {
        const payload = await readJsonBody(request);
        const result = await runCetelemFlowWithRetries(payload);
        sendJson(response, 200, {
          screenshotRaw: result.screenshotBuffer.toString("base64"),
          screenshotPath: result.screenshotPath,
          consolePath: result.consolePath,
          elapsedSeconds: result.elapsedSeconds,
          vehicleTotalAmount: result.vehicleTotalAmount,
        });
        return;
      }

      if (request.method === "POST" && request.url === "/clientes/masivo") {
        const payload = await readJsonBody(request);
        const batch = normalizeBatchPayload(payload);
        const result = await processMassiveClients({
          port: SERVER_PORT,
          clientes: batch.clientes,
          concurrency: batch.concurrency,
        });

        sendJson(response, 200, result);
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
