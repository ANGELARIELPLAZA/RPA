const express = require("express");
const controller = require("../controllers/events.controller");

const router = express.Router();

router.post("/events", controller.createEvent);
router.get("/executions/:task_id/events", controller.listEvents);

module.exports = router;

