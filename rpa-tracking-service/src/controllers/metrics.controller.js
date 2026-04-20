const metricsService = require("../services/metrics.service");

async function getMetrics(req, res) {
    const metrics = await metricsService.getMetrics();
    return res.json(metrics);
}

module.exports = {
    getMetrics,
};

