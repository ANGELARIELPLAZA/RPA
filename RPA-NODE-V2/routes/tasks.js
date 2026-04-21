const express = require("express");
const { listTasks } = require("../controllers/tasks.controller");
const { requireApiKey } = require("../middlewares/apiKeyAuth");

const router = express.Router();

router.get("/tasks", requireApiKey(), listTasks);

module.exports = router;
