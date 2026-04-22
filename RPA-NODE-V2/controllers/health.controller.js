const { formatShortDuration } = require("../utils/time");
const { getHealthSnapshot } = require("../services/health.service");

async function getHealth(req, res) {
    const snapshot = await getHealthSnapshot();
    return res.json({
        api: snapshot.api,
        portal: snapshot.portal,
        robot: snapshot.robot,
        uptime: formatShortDuration(snapshot.uptime_ms),
        uptime_ms: snapshot.uptime_ms,
        build: snapshot.build,
        activeContexts: snapshot.activeContexts,
        queuedTasks: snapshot.queuedTasks,
        metrics: snapshot.metrics,
        recentTasks: snapshot.recentTasks,
        portal_meta: snapshot.portal_meta,
    });
}

module.exports = {
    getHealth,
};
