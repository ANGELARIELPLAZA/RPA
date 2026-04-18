const http = require("http");
const { DEFAULT_BATCH_CONCURRENCY, MAX_BATCH_CONCURRENCY } = require("./config");

function normalizeBatchPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("El body JSON es obligatorio");
  }

  if (!Number.isInteger(MAX_BATCH_CONCURRENCY) || MAX_BATCH_CONCURRENCY < 1) {
    throw new Error("MAX_BATCH_CONCURRENCY debe ser un entero mayor o igual a 1");
  }

  if (!Number.isInteger(DEFAULT_BATCH_CONCURRENCY) || DEFAULT_BATCH_CONCURRENCY < 1) {
    throw new Error("DEFAULT_BATCH_CONCURRENCY debe ser un entero mayor o igual a 1");
  }

  const requestedConcurrency = Number(payload.concurrency || DEFAULT_BATCH_CONCURRENCY);
  if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1) {
    throw new Error("concurrency debe ser un entero mayor o igual a 1");
  }

  const concurrency = Math.min(requestedConcurrency, MAX_BATCH_CONCURRENCY);
  if (requestedConcurrency > MAX_BATCH_CONCURRENCY) {
    console.log(
      `concurrency=${requestedConcurrency} excede MAX_BATCH_CONCURRENCY=${MAX_BATCH_CONCURRENCY}. Usando ${concurrency}.`
    );
  }

  return normalizeClientList(payload.clientes, concurrency);
}

function normalizeClientList(clientes, concurrency) {
  if (!Array.isArray(clientes) || clientes.length === 0) {
    throw new Error("El arreglo clientes es obligatorio y debe tener al menos un elemento");
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency debe ser un entero mayor o igual a 1");
  }

  return {
    clientes: clientes.map((item) =>
      item && typeof item === "object" && item.cliente ? item : { cliente: item }
    ),
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
          let parsedJson = null;

          if (typeof contentType === "string" && contentType.includes("application/json")) {
            try {
              parsedJson = JSON.parse(rawBody.toString("utf8"));
            } catch {
              parsedJson = { error: rawBody.toString("utf8") };
            }
          }

          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            headers: response.headers,
            bodyLength: rawBody.length,
            data: parsedJson,
            error: parsedJson?.error || null,
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
  return processClientBatch({
    clientes,
    concurrency,
    runClient: (payload) => callCetelemEndpoint({ port, payload }),
  });
}

async function processClientBatch({ clientes, concurrency, runClient }) {
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
      const response = await runClient(payload);
      const finishedAt = new Date().toISOString();

      results[currentIndex] = {
        index: currentIndex,
        startedAt,
        finishedAt,
        ok: response.ok,
        statusCode: response.statusCode,
        customerRfc: cliente.customerRfc || null,
        customerName: cliente.customerName || cliente.customerRazonSocial || null,
        elapsedSeconds: response.data?.elapsedSeconds ?? null,
        vehicleTotalAmount: response.data?.vehicleTotalAmount ?? null,
        screenshotPath: response.data?.screenshotPath || null,
        consolePath: response.data?.consolePath || null,
        screenshotRawBytes: response.data?.screenshotRaw ? response.data.screenshotRaw.length : 0,
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
  normalizeClientList,
  processClientBatch,
  processMassiveClients,
};
