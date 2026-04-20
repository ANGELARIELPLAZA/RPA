const express = require("express");
const controller = require("../controllers/executions.controller");

const router = express.Router();

router.post("/executions", controller.createExecution);
router.patch("/executions/:task_id", controller.patchExecution);
router.get("/executions/:task_id", controller.getExecution);
router.get("/executions", controller.listExecutions);

module.exports = router;

