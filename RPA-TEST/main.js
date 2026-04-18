const { createApiServer } = require("./src/server");
const { normalizeBatchPayload, processClientBatch } = require("./src/batch");
const { runCetelemFlowWithRetries } = require("./src/cetelem/flow");
const { DEFAULT_CLIENT_PAYLOAD, DEFAULT_SIMULATION_PAYLOAD, SERVER_PORT } = require("./src/config");

async function runCli() {
  const result = await runCetelemFlowWithRetries(DEFAULT_CLIENT_PAYLOAD);

  console.log(`OK | Tiempo total: ${result.elapsedSeconds}s`);
  console.log(`Vehicle total amount: ${result.vehicleTotalAmount?.raw || "N/A"}`);
  console.log(`Screenshot: ${result.screenshotPath}`);
  console.log(`Console log: ${result.consolePath}`);
  console.log(`Video page: ${result.videoPaths.page || "N/A"}`);
  console.log(`Video popup: ${result.videoPaths.popup || "N/A"}`);
}

async function runFiveClientSimulationCli() {
  const batch = normalizeBatchPayload(DEFAULT_SIMULATION_PAYLOAD);

  console.log(`Simulando ${batch.clientes.length} clientes con concurrencia ${batch.concurrency}...`);

  const result = await processClientBatch({
    clientes: batch.clientes,
    concurrency: batch.concurrency,
    runClient: async (payload) => {
      try {
        const flowResult = await runCetelemFlowWithRetries(payload);

        return {
          ok: true,
          statusCode: 200,
          headers: {},
          bodyLength: 0,
          data: {
            consolePath: flowResult.consolePath,
            elapsedSeconds: flowResult.elapsedSeconds,
            executedFlows: flowResult.executedFlows,
            screenshotPath: flowResult.screenshotPath,
            vehiclePriceTax: flowResult.vehiclePriceTax,
            vehicleTotalAmount: flowResult.vehicleTotalAmount,
          },
          error: null,
        };
      } catch (error) {
        return {
          ok: false,
          statusCode: 500,
          headers: {},
          bodyLength: 0,
          data: null,
          error: error.message,
        };
      }
    },
  });

  console.log(JSON.stringify(result, null, 2));
}

function runServer() {
  const server = createApiServer();

  server.listen(SERVER_PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${SERVER_PORT}`);
  });
}

async function main() {
  const command = process.argv[2] || "server";

  if (command === "run") {
    await runCli();
    return;
  }

  if (command === "simulate5" || command === "simular5") {
    await runFiveClientSimulationCli();
    return;
  }

  if (command === "server") {
    runServer();
    return;
  }

  throw new Error(`Comando no soportado: ${command}`);
}

main().catch((error) => {
  console.error("Fallo no controlado:", error.message);
  process.exit(1);
});
