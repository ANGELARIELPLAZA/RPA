const taskStore = require("../services/taskStore.service");
const { formatearSalidaCliente } = require("../services/statusFormatter.service");

function normalizeNivelDetalleFromTask(task) {
    const raw = String(task?.payload_normalizado?.nivel_detalle ?? task?.payload_normalizado?.nivelDetalle ?? "").trim().toLowerCase();
    if (raw) return raw;
    return String(task?.payload_original?.nivel_detalle ?? task?.payload_original?.nivelDetalle ?? "").trim().toLowerCase();
}

function mapTaskStatusToJobStatus(taskStatus) {
    const s = String(taskStatus || "").toLowerCase();
    if (s === "completado") return "completed";
    if (s === "fallido") return "failed";
    return "processing";
}

function getJob(req, res) {
    const jobId = req.params.job_id;
    const task = taskStore.getTask(jobId);

    // Para este endpoint de polling, preferimos responder 200 con status=failed
    // para que el cliente deje de reintentar si el job no existe.
    if (!task) {
        return res.json({
            status: "failed",
            error_message: "task_id no encontrado",
            response_data: null,
        });
    }

    const nivel_detalle = normalizeNivelDetalleFromTask(task) || "seguros";
    const tech = taskStore.toPublicStatus(task, { includePayload: false, includeScreenshotBase64: false });
    const client = formatearSalidaCliente({ ...tech, nivel_detalle });

    const jobStatus = mapTaskStatusToJobStatus(task.status);

    if (jobStatus === "failed") {
        return res.json({
            status: "failed",
            error_message: client?.mensaje_det || tech?.detalle || "Error",
            response_data: client,
            screenshot_url: tech?.screenshot_url || null,
        });
    }

    if (jobStatus === "completed") {
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
    getJob,
};

