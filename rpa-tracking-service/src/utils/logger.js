const LEVELS = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
};

const fs = require("fs");
const path = require("path");

const configuredLevel = String(process.env.LOG_LEVEL || "info").toLowerCase();
const currentLevel = LEVELS[configuredLevel] ?? LEVELS.info;

const logToFile = String(process.env.LOG_TO_FILE || "false").toLowerCase() === "true";
const logDir = process.env.LOG_DIR || "./logs";
let fileStream = null;

function getFileStream() {
    if (!logToFile) return null;
    if (fileStream) return fileStream;
    try {
        fs.mkdirSync(logDir, { recursive: true });
        fileStream = fs.createWriteStream(path.join(logDir, "app.log"), { flags: "a" });
        return fileStream;
    } catch {
        return null;
    }
}

function shouldLog(level) {
    return currentLevel >= LEVELS[level];
}

function write(level, message, meta) {
    if (!shouldLog(level)) return;
    const suffix = meta === undefined ? "" : ` ${JSON.stringify(meta)}`;
    const line = `${message}${suffix}`;

    const stream = getFileStream();
    if (stream) {
        stream.write(`${new Date().toISOString()} ${level.toUpperCase()} ${line}\n`);
    }

    if (level === "error") return console.error(line);
    if (level === "warn") return console.warn(line);
    return console.log(line);
}

module.exports = {
    debug: (m, meta) => write("debug", m, meta),
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
};

process.on("exit", () => {
    if (fileStream) {
        try { fileStream.end(); } catch { }
    }
});
