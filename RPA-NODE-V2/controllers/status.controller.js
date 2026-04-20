const taskStore = require("../services/taskStore.service");
const { formatearSalidaCliente } = require("../services/statusFormatter.service");

function normalizeNivelDetalleFromTask(task) {
    const raw = String(task?.payload_normalizado?.nivel_detalle ?? task?.payload_normalizado?.nivelDetalle ?? "").trim().toLowerCase();
    if (raw) return raw;
    return String(task?.payload_original?.nivel_detalle ?? task?.payload_original?.nivelDetalle ?? "").trim().toLowerCase();
}

function getStatus(req, res) {
    const taskId = req.params.task_id;
    const task = taskStore.getTask(taskId);
    if (!task) {
        return res.status(404).json({
            estatus_code: 0,
            nivel_detalle: "seguros",
            mensaje_det: "task_id no encontrado",
            data: null,
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

    const nivel_detalle = normalizeNivelDetalleFromTask(task) || "seguros";
    return res.json(formatearSalidaCliente({ ...tech, nivel_detalle }));
}

module.exports = {
    getStatus,
};
