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

    const includeScreenshotBase64Raw =
        req.query.include_screenshot_base64 ?? req.query.screenshot_base64 ?? req.query.includeScreenshotBase64;
    const includeScreenshotBase64 =
        includeScreenshotBase64Raw === "1" || includeScreenshotBase64Raw === "true" || includeScreenshotBase64Raw === true;

    // Formato técnico completo (para soporte)
    if (isDebug) {
        if (!task) {
            return res.status(404).json({
                status: "fallido",
                detalle: "task_id no encontrado",
            });
        }
        return res.json(taskStore.toPublicStatus(task, { includePayload, includeScreenshotBase64 }));
    }

    // Por defecto: formato compatible con polling (waitForJobCompletion)
    if (!task) {
        return res.json({
            status: "failed",
            error_message: "task_id no encontrado",
            estatus_code: 0,
            nivel_detalle: "seguros",
            mensaje_det: "task_id no encontrado",
            data: null,
        });
    }

    const tech = taskStore.toPublicStatus(task, { includePayload: false, includeScreenshotBase64: false });
    const nivel_detalle = normalizeNivelDetalleFromTask(task) || "seguros";
    const client = formatearSalidaCliente({ ...tech, nivel_detalle });

    const s = String(task.status || "").toLowerCase();
    if (s === "fallido") {
        const fullMsg = String(client?.mensaje_det || tech?.detalle || "Error");
        const firstLine = fullMsg.split("\n")[0].trim();
        return res.json({
            status: "failed",
            // `error_message` se mantiene por compatibilidad; dejarlo corto para evitar duplicar `mensaje_det` completo.
            error_message: firstLine || fullMsg,
            ...client,
            screenshot_url: tech?.screenshot_url || null,
        });
    }

    if (s === "completado") {
        return res.json({
            status: "completed",
            ...client,
            screenshot_url: tech?.screenshot_url || null,
        });
    }

    return res.json({
        status: "processing",
        ...client,
    });
}

module.exports = {
    getStatus,
};
