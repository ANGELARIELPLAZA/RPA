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

    const formato = String(req.query.formato ?? "").trim().toLowerCase();
    const isDebug = formato === "debug";

    const includePayloadRaw = req.query.include_payload ?? req.query.payload ?? req.query.includePayload;
    const includePayload = includePayloadRaw === "1" || includePayloadRaw === "true" || includePayloadRaw === true;

    // Formato técnico completo (para soporte)
    if (isDebug) {
        if (!task) {
            return res.status(404).json({
                status: "fallido",
                detalle: "task_id no encontrado",
            });
        }
        return res.json(taskStore.toPublicStatus(task, { includePayload }));
    }

    // Por defecto: formato compatible con polling (waitForJobCompletion)
    if (!task) {
        return res.json({
            status: "failed",
            error_message: "task_id no encontrado",
            response_data: null,
        });
    }

    const tech = taskStore.toPublicStatus(task, { includePayload: false, includeScreenshotBase64: false });
    const nivel_detalle = normalizeNivelDetalleFromTask(task) || "seguros";
    const client = formatearSalidaCliente({ ...tech, nivel_detalle });

    const s = String(task.status || "").toLowerCase();
    if (s === "fallido") {
        return res.json({
            status: "failed",
            error_message: client?.mensaje_det || tech?.detalle || "Error",
            response_data: client,
            screenshot_url: tech?.screenshot_url || null,
        });
    }

    if (s === "completado") {
        return res.json({
            status: "completed",
            response_data: client,
        });
    }

    return res.json({
        status: "processing",
        response_data: client,
    });
}

module.exports = {
    getStatus,
};
