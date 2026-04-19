const { getActiveContextCount, getPendingTaskCount } = require("./context-queue");

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

function logTask(taskId, message, extra = {}) {
    const payload = {
        task_id: taskId || "cli",
        activeContexts: getActiveContextCount(),
        queuedTasks: getPendingTaskCount(),
        memory: getMemorySnapshot(),
        ...extra,
    };

    console.log(`[task:${payload.task_id}] ${message} ${JSON.stringify(payload)}`);
}

module.exports = {
    getMemorySnapshot,
    logTask,
};
