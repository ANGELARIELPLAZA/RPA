const express = require("express");
const { listTasks } = require("../controllers/tasks.controller");

const router = express.Router();

router.get("/tasks", listTasks);

module.exports = router;

