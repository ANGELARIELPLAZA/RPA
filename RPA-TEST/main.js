const http = require("http");
const https = require("https");
require("dotenv").config();

const BASE_URL = process.env.RPA_NODE_BASE_URL || "http://127.0.0.1:3100";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 15 * 60 * 1000);

const PAYLOADS = {
  cliente: {
    NIVEL_DETALLE: "CLIENTE",
    cliente: {
      customerType: "1",
      genero: "1",
      customerTitle: "1",
      customerName: "JUAN",
      customerAPaterno: "PEREZ",
      customerAMaterno: "LOPEZ",
      customerBirthDate: "01/01/1990",
      customerRfc: "PELJ900101ABC",
    },
  },
  vehiculo: {
    NIVEL_DETALLE: "VEHICULO",
    vehiculo: {
      vehicleType: "N",
      seminuevoCertificado: false,
      insuranceVehicleUse: "1",
      tipoCarga: "",
      servicio: "",
      vehicleBrand: "KIA",
      vehicleAnio: "2025",
      vehicleModel: "K3 SEDAN",
      vehicleVersion: "GT LINE",
      vehicleAccesories: "RINES Y PELICULA",
      vehicleIsConverted: false,
      vehicleAccesoriesAmount: "15000",
      vehicleChargeStationAmount: "",
      vehicleExtendedWarrantyOption: "0",
      gapInsurance: "N",
      gapInsurancePlan: "",
      gapInsuranceType: "",
    },
  },
  credito: {
    NIVEL_DETALLE: "CREDITO",
    credito: {
      creditDepositAmount: "50000",
      creditDepositPlan: "2504",
      creditDepositTerm: "48",
    },
  },
  completo: {
    flujos: ["cliente", "vehiculo", "credito"],
    cliente: {
      customerType: "1",
      genero: "1",
      customerTitle: "1",
      customerName: "JUAN",
      customerAPaterno: "PEREZ",
      customerAMaterno: "LOPEZ",
      customerBirthDate: "01/01/1990",
      customerRfc: "PELJ900101ABC",
    },
    vehiculo: {
      vehicleType: "N",
      seminuevoCertificado: false,
      insuranceVehicleUse: "1",
      tipoCarga: "",
      servicio: "",
      vehicleBrand: "KIA",
      vehicleAnio: "2025",
      vehicleModel: "K3 SEDAN",
      vehicleVersion: "GT LINE",
      vehicleAccesories: "RINES Y PELICULA",
      vehicleIsConverted: false,
      vehicleAccesoriesAmount: "15000",
      vehicleChargeStationAmount: "",
      vehicleExtendedWarrantyOption: "0",
      gapInsurance: "N",
      gapInsurancePlan: "",
      gapInsuranceType: "",
    },
    credito: {
      creditDepositAmount: "50000",
      creditDepositPlan: "2504",
      creditDepositTerm: "48",
    },
  },
};

function requestJson(method, path, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const body = payload ? JSON.stringify(payload) : null;
    const transport = url.protocol === "https:" ? https : http;

    const request = transport.request(
      url,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(body
            ? {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          let data = null;

          try {
            data = rawBody ? JSON.parse(rawBody) : null;
          } catch {
            reject(new Error(`Respuesta no JSON (${response.statusCode}): ${rawBody.slice(0, 300)}`));
            return;
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode}: ${JSON.stringify(data)}`));
            return;
          }

          resolve(data);
        });
      }
    );

    request.on("error", reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

async function waitForJob(taskId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const status = await requestJson("GET", `/status/${taskId}`);

    console.log(`Task ${taskId}: ${status.status}`);

    if (status.status === "completed") {
      return requestJson("GET", `/cotizar-cetelem-async/${taskId}/result`);
    }

    if (status.status === "failed") {
      throw new Error(status.error || "La task fallo sin detalle");
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timeout esperando task ${taskId}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPayload(name) {
  const payload = PAYLOADS[name];

  if (!payload) {
    throw new Error(`Prueba no soportada: ${name}. Usa: ${Object.keys(PAYLOADS).join(", ")}`);
  }

  console.log(`RPA-NODE: ${BASE_URL}`);
  console.log(`Prueba: ${name}`);

  const job = await requestJson("POST", "/cotizar-cetelem-async", payload);
  console.log(`Task creada: ${job.task_id}`);

  const result = await waitForJob(job.task_id);
  console.log(JSON.stringify(result, null, 2));
}

async function health() {
  const result = await requestJson("GET", "/health");
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const command = (process.argv[2] || "credito").toLowerCase();

  if (command === "health" || command === "healthz") {
    await health();
    return;
  }

  await runPayload(command);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  PAYLOADS,
  requestJson,
  waitForJob,
};
