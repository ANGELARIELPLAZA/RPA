const express = require("express");
const { getMetrics, getPrometheusMetrics } = require("../controllers/metrics.controller");

const router = express.Router();
router.get("/metrics", getMetrics);
router.get("/metrics/prometheus", getPrometheusMetrics);
module.exports = router;
