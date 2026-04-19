const { getActiveContextCount, getPendingTaskCount } = require("./context-queue");
const logger = require("./logger");

function formatBytes(bytes) {
    return `${Math.round((bytes / 1024 / 1024) * 100) / 100}MB`;
}

function getMemorySnapshot() {
    const memory = process.memoryUsage();

    return {
        rss: formatBytes(memory.rss),
        heapUsed: formatBytes(memory.heapUsed),
        heapTotal: formatBytes(memory.heapTotal),
        external: formatBytes(memory.external),
    };
}

function shortTaskId(taskId) {
    return String(taskId || "cli").slice(0, 8);
}

function formatMeta(meta) {
    return Object.entries(meta)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${key}=${value}`)
        .join(" ");
}

function logTask(taskId, message, extra = {}, options = {}) {
    const level = options.level || "info";
    const payload = {
        activeContexts: getActiveContextCount(),
        queuedTasks: getPendingTaskCount(),
        ...extra,
    };

    if (logger.shouldLog("debug") || options.includeMemory) {
        payload.memory = getMemorySnapshot();
    }

    const meta = formatMeta(payload);
    logger[level](`[task ${shortTaskId(taskId)}] ${message}${meta ? ` ${meta}` : ""}`);
}

module.exports = {
    getMemorySnapshot,
    logTask,
    shortTaskId,
};
