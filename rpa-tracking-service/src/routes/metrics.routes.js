const express = require("express");
const { getMetrics, getPrometheusMetrics } = require("../controllers/metrics.controller");
const { METRICS_PUBLIC } = require("../config/env");
const { requireApiKey } = require("../middlewares/apiKeyAuth");

const router = express.Router();
const auth = METRICS_PUBLIC ? (req, res, next) => next() : requireApiKey();
router.get("/metrics", auth, getMetrics);
router.get("/metrics/prometheus", auth, getPrometheusMetrics);
module.exports = router;
