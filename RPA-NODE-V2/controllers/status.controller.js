const taskStore = require("../services/taskStore.service");

function getStatus(req, res) {
    const taskId = req.params.task_id;
    const task = taskStore.getTask(taskId);
    if (!task) {
        return res.status(404).json({ error: "task_id no encontrado" });
    }

    return res.json(taskStore.toPublicStatus(task));
}

module.exports = {
    getStatus,
};

