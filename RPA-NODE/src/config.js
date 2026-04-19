const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
    path: process.env.DOTENV_PATH || path.resolve(__dirname, "..", ".env"),
    quiet: true,
});

const USUARIO = process.env.USUARIO;
const PASSWORD = process.env.PASSWORD;
const HEADLESS = (process.env.HEADLESS || "true").toLowerCase() === "true";
let recordVideoEnabled = (process.env.RECORD_VIDEO || "true").toLowerCase() === "true";
const SERVER_PORT = Number(process.env.PORT || 3000);
const SERVER_HOST = process.env.HOST || "0.0.0.0";
const MAX_REINTENTOS = Number(process.env.MAX_REINTENTOS || 3);
const MAX_CONTEXTS = Number(process.env.MAX_CONTEXTS || 3);
const LOGIN_URL = process.env.CETELEM_LOGIN_URL || "https://cck.creditoclick.com.mx/users-web/auth/kia/login?w=true";
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
    DEFAULT_CLIENT_PAYLOAD,
    HEADLESS,
    isRecordVideoEnabled,
    LOGIN_URL,
    LOGS_DIR,
    MAX_CONTEXTS,
    MAX_REINTENTOS,
    PASSWORD,
    SCREENSHOTS_DIR,
    SERVER_HOST,
    SERVER_PORT,
    setRecordVideoEnabled,
    TIPO_PERSONA_READY_VALUE,
    TIPO_PERSONA_SELECTOR,
    USUARIO,
    VIDEOS_DIR,
    assertCredentials,
};
