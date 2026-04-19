const LEVELS = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
};

const configuredLevel = String(process.env.LOG_LEVEL || "info").toLowerCase();
const currentLevel = LEVELS[configuredLevel] ?? LEVELS.info;

function shouldLog(level) {
    return currentLevel >= LEVELS[level];
}

function write(level, message, meta) {
    if (!shouldLog(level)) {
        return;
    }

    const suffix = meta === undefined ? "" : ` ${JSON.stringify(meta)}`;
    const line = `${message}${suffix}`;

    if (level === "error") {
        console.error(line);
        return;
    }

    if (level === "warn") {
        console.warn(line);
        return;
    }

    console.log(line);
}

module.exports = {
    debug: (message, meta) => write("debug", message, meta),
    error: (message, meta) => write("error", message, meta),
    info: (message, meta) => write("info", message, meta),
    shouldLog,
    warn: (message, meta) => write("warn", message, meta),
};
