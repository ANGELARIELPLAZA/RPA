const eventsService = require("../services/events.service");

async function createEvent(req, res) {
    const taskId = req.body?.task_id;
    const eventType = req.body?.event_type;
    if (!taskId) return res.status(400).json({ error: "task_id requerido" });
    if (!eventType) return res.status(400).json({ error: "event_type requerido" });

    const created = await eventsService.createEvent(req.body);
    return res.status(201).json(created);
}

async function listEvents(req, res) {
    const taskId = req.params.task_id;
    const list = await eventsService.listEvents(taskId, req.query || {});
    return res.json({ items: list });
}

module.exports = {
    createEvent,
    listEvents,
};

