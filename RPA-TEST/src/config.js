const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
  path: process.env.DOTENV_PATH || path.resolve(__dirname, "..", ".env"),
});

const USUARIO = process.env.USUARIO;
const PASSWORD = process.env.PASSWORD;
const HEADLESS = (process.env.HEADLESS || "true").toLowerCase() === "true";
const SERVER_PORT = Number(process.env.PORT || 3100);
const MAX_REINTENTOS = Number(process.env.MAX_REINTENTOS || 3);
const DEFAULT_BATCH_CONCURRENCY = Number(process.env.DEFAULT_BATCH_CONCURRENCY || 5);
const MAX_BATCH_CONCURRENCY = Number(process.env.MAX_BATCH_CONCURRENCY || 5);
const LOGIN_URL =
  process.env.CETELEM_LOGIN_URL ||
  "https://cck.creditoclick.com.mx/users-web/auth/kia/login?w=true";
const BAD_URL_TOKEN = "josso_security_check";
const TIPO_PERSONA_SELECTOR = "#customerType";
const TIPO_PERSONA_READY_VALUE = "1";

const BASE_DIR = path.resolve(__dirname, "..");
const LOGS_DIR = path.join(BASE_DIR, "logs");
const SCREENSHOTS_DIR = path.join(BASE_DIR, "screenshots");
const VIDEOS_DIR = path.join(BASE_DIR, "videos", "playwright");

for (const dir of [LOGS_DIR, SCREENSHOTS_DIR, VIDEOS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const DEFAULT_CLIENT_PAYLOAD = {
  cliente: {
    customerType: "3",
    genero: "1",
    customerTitle: "1",
    customerName: "ANGEL",
    customerAPaterno: "PLAZA",
    customerAMaterno: "HERNANDEZ",
    customerBirthDate: "01/01/1990",
    customerRfc: "PEHA900101ABC",
    customerNumUnidades: "2",
    customerFirstCredit: "1",
  },
  vehiculo: {
    vehicleType: "N",
    insuranceVehicleUse: "1",
  },
};

const DEFAULT_SIMULATION_CLIENTS = [
  DEFAULT_CLIENT_PAYLOAD,
  {
    cliente: {
      customerType: "3",
      genero: "2",
      customerTitle: "2",
      customerName: "MARIA",
      customerAPaterno: "LOPEZ",
      customerAMaterno: "PEREZ",
      customerBirthDate: "05/08/1992",
      customerRfc: "LOPM920805ABC",
      customerNumUnidades: "1",
      customerFirstCredit: "2",
    },
    vehiculo: {
      vehicleType: "N",
      insuranceVehicleUse: "1",
    },
  },
  {
    cliente: {
      customerType: "3",
      genero: "1",
      customerTitle: "1",
      customerName: "CARLOS",
      customerAPaterno: "RAMIREZ",
      customerAMaterno: "GARCIA",
      customerBirthDate: "12/03/1988",
      customerRfc: "RAGC880312ABC",
      customerNumUnidades: "1",
      customerFirstCredit: "1",
    },
    vehiculo: {
      vehicleType: "N",
      insuranceVehicleUse: "1",
    },
  },
  {
    cliente: {
      customerType: "3",
      genero: "2",
      customerTitle: "2",
      customerName: "LAURA",
      customerAPaterno: "MARTINEZ",
      customerAMaterno: "SOTO",
      customerBirthDate: "21/11/1995",
      customerRfc: "MASL951121ABC",
      customerNumUnidades: "2",
      customerFirstCredit: "2",
    },
    vehiculo: {
      vehicleType: "N",
      insuranceVehicleUse: "1",
    },
  },
  {
    cliente: {
      customerType: "3",
      genero: "1",
      customerTitle: "1",
      customerName: "JORGE",
      customerAPaterno: "HERNANDEZ",
      customerAMaterno: "DIAZ",
      customerBirthDate: "30/06/1985",
      customerRfc: "HEDJ850630ABC",
      customerNumUnidades: "3",
      customerFirstCredit: "1",
    },
    vehiculo: {
      vehicleType: "N",
      insuranceVehicleUse: "1",
    },
  },
];

const DEFAULT_SIMULATION_PAYLOAD = {
  concurrency: DEFAULT_BATCH_CONCURRENCY,
  clientes: DEFAULT_SIMULATION_CLIENTS,
};

function assertCredentials() {
  if (!USUARIO || !PASSWORD) {
    throw new Error("Faltan USUARIO o PASSWORD en el archivo .env");
  }
}

module.exports = {
  BAD_URL_TOKEN,
  DEFAULT_BATCH_CONCURRENCY,
  DEFAULT_CLIENT_PAYLOAD,
  DEFAULT_SIMULATION_PAYLOAD,
  HEADLESS,
  LOGIN_URL,
  LOGS_DIR,
  MAX_BATCH_CONCURRENCY,
  MAX_REINTENTOS,
  PASSWORD,
  SCREENSHOTS_DIR,
  SERVER_PORT,
  TIPO_PERSONA_READY_VALUE,
  TIPO_PERSONA_SELECTOR,
  USUARIO,
  VIDEOS_DIR,
  assertCredentials,
};
