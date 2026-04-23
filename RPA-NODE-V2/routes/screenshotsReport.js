const express = require("express");
const { requireApiKey } = require("../middlewares/apiKeyAuth");
const { getScreenshotsReport } = require("../controllers/screenshotsReport.controller");

const router = express.Router();

router.get("/screenshots-report", requireApiKey(), getScreenshotsReport);

module.exports = router;

