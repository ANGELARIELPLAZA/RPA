const taskStore = require("../services/taskStore.service");

function getStatus(req, res) {
    const taskId = req.params.task_id;
    const task = taskStore.getTask(taskId);
    if (!task) {
        return res.status(404).json({ error: "task_id no encontrado" });
    }

    const includePayloadRaw = req.query.include_payload ?? req.query.payload ?? req.query.includePayload;
    const includePayload =
        includePayloadRaw === "1"
        || includePayloadRaw === "true"
        || includePayloadRaw === true;

    return res.json(taskStore.toPublicStatus(task, { includePayload }));
}

module.exports = {
    getStatus,
};
