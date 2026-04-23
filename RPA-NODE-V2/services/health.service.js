const { getPortalStatusCached } = require("./portalHealth.service");
const taskStore = require("./taskStore.service");
const { getQueueSnapshot } = require("./cetelemAsync.service");

function getUptimeMs() {
    return Math.floor(process.uptime() * 1000);
}

function getBuildInfo() {
    let version = null;
    try {
        // eslint-disable-next-line global-require
        version = require("../package.json")?.version ?? null;
    } catch {
        version = null;
    }

    return {
        version,
        git_sha: process.env.GIT_SHA || process.env.SOURCE_VERSION || null,
        build_date: process.env.BUILD_DATE || null,
        node: process.version,
    };
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
        build: getBuildInfo(),
        activeContexts: queue.activeContexts,
        queuedTasks: queue.queuedTasks,
        metrics,
    };
}

module.exports = {
    getHealthSnapshot,
};
