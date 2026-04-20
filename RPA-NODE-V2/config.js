const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
    path: process.env.DOTENV_PATH || path.resolve(__dirname, ".", ".env"),
    quiet: true,
});

const USUARIO = process.env.USUARIO;
const PASSWORD = process.env.PASSWORD;
const HEADLESS = (process.env.HEADLESS || "true").toLowerCase() === "true";
let recordVideoEnabled = (process.env.RECORD_VIDEO || "false").toLowerCase() === "true";

const SERVER_PORT = Number(process.env.PORT || 3000);
const SERVER_HOST = process.env.HOST || "0.0.0.0";

const MAX_REINTENTOS = Number(process.env.MAX_REINTENTOS || 3);
const MAX_CONTEXTS = Number(process.env.MAX_CONTEXTS || 3);

// Compatibilidad con helpers existentes
const BAD_URL_TOKEN = "josso_security_check";
const TIPO_PERSONA_SELECTOR = "#customerType";
const TIPO_PERSONA_READY_VALUE = "1";

// Portal / timeouts
const CETELEM_URL =
    process.env.CETELEM_URL ||
    process.env.CETELEM_LOGIN_URL ||
    "https://cck.creditoclick.com.mx/users-web/auth/kia/login?w=true";
const PING_TIMEOUT_MS = Number(process.env.PING_TIMEOUT_MS || 5000);
const STATUS_TIMEOUT_MS = Number(process.env.STATUS_TIMEOUT_MS || 4000);

// Evidencias
const SCREENSHOTS_DIR = path.resolve(__dirname, process.env.SCREENSHOTS_DIR || "./screenshots");

// Base URL pública para construir screenshot_url
const BASE_URL = String(process.env.BASE_URL || `http://localhost:${SERVER_PORT}`).replace(/\/+$/, "");

// Observabilidad / monitor
const MONITOR_ENABLED = (process.env.MONITOR_ENABLED || "true").toLowerCase() === "true";
const MONITOR_REFRESH_MS = Number(process.env.MONITOR_REFRESH_MS || 1000);

// Tracking service (microservicio Mongo) - desacoplado
const TRACKING_ENABLED = (process.env.TRACKING_ENABLED || "false").toLowerCase() === "true";
const TRACKING_SERVICE_URL = process.env.TRACKING_SERVICE_URL || "http://rpa-tracking-service:3100";
const TRACKING_TIMEOUT_MS = Number(process.env.TRACKING_TIMEOUT_MS || 3000);

// Directorios adicionales (logs / videos) con defaults razonables
const LOGS_DIR = path.resolve(__dirname, process.env.LOGS_DIR || "./logs");
const VIDEOS_DIR = path.resolve(__dirname, process.env.VIDEOS_DIR || "./videos/playwright");

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

function assertCredentials() {
    if (!USUARIO || !PASSWORD) {
        throw new Error("Faltan USUARIO o PASSWORD en el archivo .env");
    }
}

function isRecordVideoEnabled() {
    return recordVideoEnabled;
}

function setRecordVideoEnabled(enabled) {
    recordVideoEnabled = Boolean(enabled);
    return recordVideoEnabled;
}

module.exports = {
    BAD_URL_TOKEN,
    BASE_URL,
    DEFAULT_CLIENT_PAYLOAD,
    HEADLESS,
    isRecordVideoEnabled,
    CETELEM_URL,
    LOGS_DIR,
    MAX_CONTEXTS,
    MAX_REINTENTOS,
    MONITOR_ENABLED,
    MONITOR_REFRESH_MS,
    PASSWORD,
    PING_TIMEOUT_MS,
    SCREENSHOTS_DIR,
    SERVER_HOST,
    SERVER_PORT,
    STATUS_TIMEOUT_MS,
    setRecordVideoEnabled,
    TIPO_PERSONA_READY_VALUE,
    TIPO_PERSONA_SELECTOR,
    TRACKING_ENABLED,
    TRACKING_SERVICE_URL,
    TRACKING_TIMEOUT_MS,
    USUARIO,
    VIDEOS_DIR,
    assertCredentials,
};
