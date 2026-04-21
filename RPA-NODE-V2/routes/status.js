const express = require("express");
const { getStatus } = require("../controllers/status.controller");
const { requireApiKey } = require("../middlewares/apiKeyAuth");
const { validateTaskIdParam } = require("../middlewares/validators");

const router = express.Router();

router.get("/status/:task_id", requireApiKey(), validateTaskIdParam, getStatus);

module.exports = router;
