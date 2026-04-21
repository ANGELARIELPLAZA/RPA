const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
    path: process.env.DOTENV_PATH || path.resolve(__dirname, ".", ".env"),
    quiet: true,
});

const USUARIO = process.env.USUARIO;
const PASSWORD = process.env.PASSWORD;
const AGENCIA_PASSWORD_STRICT = (process.env.AGENCIA_PASSWORD_STRICT || "false").toLowerCase() === "true";
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

function normalizeAgenciaKey(value) {
    return String(value ?? "").trim().toLowerCase();
}

function parsePasswordsByAgenciaEnv() {
    const raw = process.env.PASSWORDS_BY_AGENCIA;
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

        const out = {};
        for (const [k, v] of Object.entries(parsed)) {
            const key = normalizeAgenciaKey(k);
            if (!key) continue;
            if (v === undefined || v === null) continue;
            const pass = String(v);
            if (!pass.trim()) continue;
            out[key] = pass;
        }
        return out;
    } catch {
        return {};
    }
}

const PASSWORDS_BY_AGENCIA = parsePasswordsByAgenciaEnv();

function resolvePasswordForAgencia(agencia, { strict = AGENCIA_PASSWORD_STRICT } = {}) {
    const key = normalizeAgenciaKey(agencia);

    if (!key) {
        if (!PASSWORD) {
            throw new Error("No hay PASSWORD configurado (y no se enviÃ³ agencia).");
        }
        return PASSWORD;
    }

    if (PASSWORDS_BY_AGENCIA[key]) return PASSWORDS_BY_AGENCIA[key];

    // Permite configurar una variable por agencia: PASSWORD_AGENCIA_<AGENCIA>
    const envSuffix = String(agencia ?? "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (envSuffix) {
        const envKey = `PASSWORD_AGENCIA_${envSuffix}`;
        const byEnv = process.env[envKey];
        if (byEnv && String(byEnv).trim()) return String(byEnv);
    }

    if (strict) {
        throw new Error(`No hay contraseÃ±a configurada para la agencia "${String(agencia)}".`);
    }

    if (PASSWORD) return PASSWORD;

    // Si no hay fallback global, siempre es un error (aunque strict=false).
    throw new Error(`No hay contraseÃ±a configurada para la agencia "${String(agencia)}".`);
}

function assertCredentials() {
    if (!USUARIO) {
        throw new Error("Falta USUARIO en el archivo .env");
    }

    const hasDefaultPassword = Boolean(PASSWORD && String(PASSWORD).trim());
    const hasMapPasswords = Boolean(PASSWORDS_BY_AGENCIA && Object.keys(PASSWORDS_BY_AGENCIA).length);
    const hasAnyAgenciaEnv = Object.keys(process.env).some((k) => String(k || "").startsWith("PASSWORD_AGENCIA_"));

    if (!hasDefaultPassword && !hasMapPasswords && !hasAnyAgenciaEnv) {
        throw new Error("Falta PASSWORD (o PASSWORDS_BY_AGENCIA / PASSWORD_AGENCIA_<...>) en el archivo .env");
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
    AGENCIA_PASSWORD_STRICT,
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
    resolvePasswordForAgencia,
};
