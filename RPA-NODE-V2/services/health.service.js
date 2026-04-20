const { getPortalStatusCached } = require("./portalHealth.service");
const taskStore = require("./taskStore.service");
const { getQueueSnapshot } = require("./cetelemAsync.service");

function getUptimeMs() {
    return Math.floor(process.uptime() * 1000);
}

async function getHealthSnapshot() {
    const portal = await getPortalStatusCached();
    const metrics = taskStore.getMetrics();
    const queue = getQueueSnapshot();

    return {
        api: "ok",
        portal: portal.available ? "disponible" : "fuera de servicio",
        portal_meta: portal,
        robot: queue.robot,
        uptime_ms: getUptimeMs(),
        activeContexts: queue.activeContexts,
        queuedTasks: queue.queuedTasks,
        metrics,
        recentTasks: taskStore.listRecentTasks(10).map(taskStore.toPublicStatus),
    };
}

module.exports = {
    getHealthSnapshot,
};

