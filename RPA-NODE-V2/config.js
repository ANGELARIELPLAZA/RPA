const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
    path: process.env.DOTENV_PATH || path.resolve(__dirname, ".", ".env"),
    quiet: true,
});

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

// Base URL publica para construir screenshot_url
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

function normalizeAgenciaKey(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function parseCredentialsByAgenciaEnv() {
    const raw = process.env.CREDENTIALS_BY_AGENCIA;
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

        const out = {};
        for (const [k, v] of Object.entries(parsed)) {
            const key = normalizeAgenciaKey(k);
            if (!key) continue;
            if (!v || typeof v !== "object" || Array.isArray(v)) continue;

            const usuario = v.usuario ?? v.username ?? v.user;
            const password = v.password ?? v.pass;

            const usuarioStr = usuario === undefined || usuario === null ? "" : String(usuario).trim();
            const passwordStr = password === undefined || password === null ? "" : String(password).trim();

            if (!usuarioStr || !passwordStr) continue;

            out[key] = { usuario: usuarioStr, password: passwordStr };
        }
        return out;
    } catch (error) {
        credentialsByAgenciaParseError = error;
        return {};
    }
}

let credentialsByAgenciaParseError = null;
const CREDENTIALS_BY_AGENCIA = parseCredentialsByAgenciaEnv();

function assertCredentials() {
    const hasCredentialsMap = Boolean(CREDENTIALS_BY_AGENCIA && Object.keys(CREDENTIALS_BY_AGENCIA).length);
    if (!hasCredentialsMap) {
        if (credentialsByAgenciaParseError) {
            throw new Error(`CREDENTIALS_BY_AGENCIA invalido (JSON): ${credentialsByAgenciaParseError.message}`);
        }
        throw new Error("Falta CREDENTIALS_BY_AGENCIA (JSON) en el archivo .env");
    }
}

function resolveCredentialsForAgencia(agencia) {
    const agenciaResolved = agencia || process.env.AGENCIA || process.env.DEFAULT_AGENCIA;
    const key = normalizeAgenciaKey(agenciaResolved);

    if (!key) {
        throw new Error(
            "Falta agencia para resolver credenciales (envia agencia en payload o define AGENCIA/DEFAULT_AGENCIA en .env)."
        );
    }

    const availableKeys = Object.keys(CREDENTIALS_BY_AGENCIA || {});
    if (!availableKeys.length) {
        if (!process.env.CREDENTIALS_BY_AGENCIA) {
            throw new Error("Falta CREDENTIALS_BY_AGENCIA (JSON) en el entorno.");
        }
        if (credentialsByAgenciaParseError) {
            throw new Error(`CREDENTIALS_BY_AGENCIA invalido (JSON): ${credentialsByAgenciaParseError.message}`);
        }
        throw new Error("CREDENTIALS_BY_AGENCIA vacio o sin entradas validas (requiere usuario+password por agencia).");
    }

    const creds = CREDENTIALS_BY_AGENCIA[key];
    if (!creds?.usuario || !creds?.password) {
        throw new Error(
            `No hay credenciales configuradas para la agencia "${String(agenciaResolved)}" (key="${key}", disponibles=${availableKeys.join(",")}).`
        );
    }

    return { usuario: creds.usuario, password: creds.password };
}

function resolveUsuarioForAgencia(agencia) {
    return resolveCredentialsForAgencia(agencia).usuario;
}

function resolvePasswordForAgencia(agencia) {
    return resolveCredentialsForAgencia(agencia).password;
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
    PING_TIMEOUT_MS,
    resolveUsuarioForAgencia,
    resolveCredentialsForAgencia,
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
    VIDEOS_DIR,
    assertCredentials,
    resolvePasswordForAgencia,
};
