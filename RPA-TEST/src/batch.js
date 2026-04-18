const http = require("http");

function normalizeBatchPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("El body JSON es obligatorio");
  }

  if (!Array.isArray(payload.clientes) || payload.clientes.length === 0) {
    throw new Error("El arreglo clientes es obligatorio y debe tener al menos un elemento");
  }

  const concurrency = Number(payload.concurrency || 1);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency debe ser un entero mayor o igual a 1");
  }

  return {
    clientes: payload.clientes.map((cliente) => ({ cliente })),
    concurrency,
  };
}

function callCetelemEndpoint({ port, payload }) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/cetelem-cotizar-async",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const rawBody = Buffer.concat(chunks);
          const contentType = response.headers["content-type"] || "";
          let parsedError = null;

          if (typeof contentType === "string" && contentType.includes("application/json")) {
            try {
              parsedError = JSON.parse(rawBody.toString("utf8"));
            } catch {
              parsedError = { error: rawBody.toString("utf8") };
            }
          }

          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            headers: response.headers,
            bodyLength: rawBody.length,
            error: parsedError?.error || null,
          });
        });
      }
    );

    request.on("error", (error) => {
      resolve({
        ok: false,
        statusCode: 500,
        headers: {},
        bodyLength: 0,
        error: error.message,
      });
    });

    request.write(body);
    request.end();
  });
}

async function processMassiveClients({ port, clientes, concurrency }) {
  const results = new Array(clientes.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= clientes.length) {
        return;
      }

      const payload = clientes[currentIndex];
      const cliente = payload.cliente || {};
      const startedAt = new Date().toISOString();
      const response = await callCetelemEndpoint({ port, payload });
      const finishedAt = new Date().toISOString();

      results[currentIndex] = {
        index: currentIndex,
        startedAt,
        finishedAt,
        ok: response.ok,
        statusCode: response.statusCode,
        customerRfc: cliente.customerRfc || null,
        customerName: cliente.customerName || cliente.customerRazonSocial || null,
        screenshotPath: response.headers["x-screenshot-path"] || null,
        consolePath: response.headers["x-console-path"] || null,
        elapsedSeconds: response.headers["x-elapsed-seconds"]
          ? Number(response.headers["x-elapsed-seconds"])
          : null,
        responseBytes: response.bodyLength,
        error: response.error,
      };
    }
  }

  const workerCount = Math.min(concurrency, clientes.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const success = results.filter((item) => item.ok).length;

  return {
    total: clientes.length,
    success,
    failed: clientes.length - success,
    concurrency: workerCount,
    results,
  };
}

module.exports = {
  normalizeBatchPayload,
  processMassiveClients,
};
