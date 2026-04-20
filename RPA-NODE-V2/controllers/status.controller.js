const taskStore = require("../services/taskStore.service");
const { formatearSalidaCliente } = require("../services/statusFormatter.service");

function getStatus(req, res) {
    const taskId = req.params.task_id;
    const task = taskStore.getTask(taskId);
    if (!task) {
        return res.status(404).json({
            status: "fallido",
            detalle: "task_id no encontrado",
        });
    }

    const formato = String(req.query.formato ?? "").trim().toLowerCase();
    const isDebug = formato === "debug";

    const includePayloadRaw = req.query.include_payload ?? req.query.payload ?? req.query.includePayload;
    const includePayload = includePayloadRaw === "1" || includePayloadRaw === "true" || includePayloadRaw === true;

    const tech = taskStore.toPublicStatus(task, { includePayload });

    if (isDebug) {
        return res.json(tech);
    }

    return res.json(formatearSalidaCliente(tech));
}

module.exports = {
    getStatus,
};
