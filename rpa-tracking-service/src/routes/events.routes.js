const express = require("express");
const controller = require("../controllers/events.controller");
const { requireApiKey } = require("../middlewares/apiKeyAuth");
const { validateEventTypeBody, validateTaskIdBody, validateTaskIdParam } = require("../middlewares/validators");

const router = express.Router();

router.post("/events", requireApiKey(), validateTaskIdBody, validateEventTypeBody, controller.createEvent);
router.get("/executions/:task_id/events", requireApiKey(), validateTaskIdParam, controller.listEvents);

module.exports = router;
