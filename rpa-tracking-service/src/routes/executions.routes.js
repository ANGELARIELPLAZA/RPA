const express = require("express");
const controller = require("../controllers/executions.controller");
const { requireApiKey } = require("../middlewares/apiKeyAuth");
const { validateTaskIdBody, validateTaskIdParam } = require("../middlewares/validators");

const router = express.Router();

router.post("/executions", requireApiKey(), validateTaskIdBody, controller.createExecution);
router.patch("/executions/:task_id", requireApiKey(), validateTaskIdParam, controller.patchExecution);
router.get("/executions/:task_id", requireApiKey(), validateTaskIdParam, controller.getExecution);
router.get("/executions", requireApiKey(), controller.listExecutions);

module.exports = router;
