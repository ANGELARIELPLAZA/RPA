const metricsService = require("../services/metrics.service");

async function getMetrics(req, res) {
    const metrics = await metricsService.getMetrics();
    return res.json(metrics);
}

async function getPrometheusMetrics(req, res) {
    const text = await metricsService.getPrometheusMetrics();
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return res.status(200).send(text);
}

module.exports = {
    getMetrics,
    getPrometheusMetrics,
};
