const executionsService = require("../services/executions.service");

async function createExecution(req, res) {
    const taskId = req.body?.task_id;
    if (!taskId) return res.status(400).json({ error: "task_id requerido" });

    const created = await executionsService.createExecution(req.body);
    return res.status(201).json(created);
}

async function patchExecution(req, res) {
    const taskId = req.params.task_id;
    const updated = await executionsService.patchExecution(taskId, req.body || {});
    if (!updated) return res.status(404).json({ error: "task_id no encontrado" });
    return res.json(updated);
}

async function getExecution(req, res) {
    const taskId = req.params.task_id;
    const found = await executionsService.getExecution(taskId);
    if (!found) return res.status(404).json({ error: "task_id no encontrado" });
    return res.json(found);
}

async function listExecutions(req, res) {
    const list = await executionsService.listExecutions(req.query || {});
    return res.json({ items: list });
}

module.exports = {
    createExecution,
    getExecution,
    listExecutions,
    patchExecution,
};

