const { formatDateTime, formatShortDuration } = require("../utils/time");
const fs = require("fs");
const path = require("path");
const { SCREENSHOTS_DIR } = require("../config");

const tasks = new Map();

const counters = {
    completed: 0,
    failed: 0,
};

function now() {
    return Date.now();
}

function computeEtapaNumero(currentStep, totalSteps) {
    const current = Math.max(0, Number(currentStep || 0));
    const total = Math.max(0, Number(totalSteps || 0));
    if (!total) return "0/0";
    if (!current) return `0/${total}`;
    return `${Math.min(current, total)}/${total}`;
}

function computeElapsedMs(task) {
    const start = task.started_at || task.fecha_ejecucion;
    const end = task.finished_at || now();
    if (!start) return 0;
    return Math.max(0, end - start);
}

function normalizeNivelDetalleFromTask(task) {
    const raw = String(task?.payload_normalizado?.nivel_detalle ?? task?.payload_normalizado?.nivelDetalle ?? "").trim().toLowerCase();
    if (raw) return raw;
    return String(task?.payload_original?.nivel_detalle ?? task?.payload_original?.nivelDetalle ?? "").trim().toLowerCase();
}

function parseMoney(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const cleaned = raw.replace(/[$\s]/g, "").replace(/,/g, "");
    const num = Number.parseFloat(cleaned.replace(/[^\d.-]/g, ""));
    return Number.isFinite(num) ? num : null;
}

function mapPrimasSegurosFromResult(result) {
    if (!Array.isArray(result)) return null;
    return result
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
            aseguradora: String(x.aseguradora ?? "").trim(),
            monto: parseMoney(x.monto),
            anualidad_requerida: true,
            rango_anualidad: { minimo: null, maximo: null },
        }))
        .filter((x) => x.aseguradora && x.monto !== null && x.monto !== 0);
}

function toPublicStatus(task, { includePayload = false, includeScreenshotBase64 = true } = {}) {
    const elapsedMs = computeElapsedMs(task);
    const fechaMs =
        typeof task.fecha_ejecucion === "number"
            ? task.fecha_ejecucion
            : Number.isFinite(Date.parse(task.fecha_ejecucion))
                ? Date.parse(task.fecha_ejecucion)
                : null;
    const fechaEjecucion = fechaMs ? formatDateTime(new Date(fechaMs)) : null;

    let screenshotBase64 = null;
    if (includeScreenshotBase64 && task.status === "fallido" && task.screenshot_url) {
        try {
            const match = String(task.screenshot_url).match(/\/screenshots\/([^?#]+)/i);
            const filename = match ? decodeURIComponent(match[1]) : null;
            if (filename) {
                const resolved = path.resolve(SCREENSHOTS_DIR, filename);
                const root = path.resolve(SCREENSHOTS_DIR) + path.sep;
                if (resolved.startsWith(root) && fs.existsSync(resolved)) {
                    screenshotBase64 = fs.readFileSync(resolved).toString("base64");
                }
            }
        } catch {
            screenshotBase64 = null;
        }
    }

    const nivelDetalle = normalizeNivelDetalleFromTask(task);
    const primas_seguros =
        nivelDetalle === "seguros"
            ? mapPrimasSegurosFromResult(task.result)
            : null;

    return {
        task_id: task.task_id,
        status: task.status,
        ...(fechaEjecucion ? { fecha_ejecucion: fechaEjecucion } : {}),
        ...(fechaMs ? { fecha_ejecucion_ms: fechaMs } : {}),
        tiempo_transcurrido: formatShortDuration(elapsedMs),
        result: primas_seguros ? null : task.result ?? null,
        ...(primas_seguros ? { primas_seguros } : {}),
        etapa_nombre: task.etapa_nombre,
        etapa_numero: task.etapa_numero,
        ...(task.detalle ? { detalle: task.detalle } : {}),
        ...(task.screenshot_url ? { screenshot_url: task.screenshot_url } : {}),
        ...(screenshotBase64 ? { screenshot: { base64: screenshotBase64 } } : {}),
        ...(includePayload
            ? {
                payload_original: task.payload_original ?? null,
                payload_normalizado: task.payload_normalizado ?? null,
            }
            : {}),
    };
}

function createTask({ task_id, fecha_ejecucion, payload_original, payload_normalizado, total_steps }) {
    const task = {
        task_id,
        status: "En progreso",
        etapa_nombre: "inicializando",
        current_step: 0,
        total_steps: total_steps || 0,
        etapa_numero: computeEtapaNumero(0, total_steps || 0),
        fecha_ejecucion: fecha_ejecucion || now(),
        started_at: null,
        finished_at: null,
        payload_original,
        payload_normalizado,
        result: null,
        error: null,
        detalle: null,
        screenshot_url: null,
    };

    tasks.set(task_id, task);
    return task;
}

function getTask(taskId) {
    return tasks.get(taskId) || null;
}

function markStarted(taskId) {
    const task = getTask(taskId);
    if (!task) return null;
    if (!task.started_at) task.started_at = now();
    return task;
}

function setStage(taskId, etapaNombre, currentStep, totalSteps) {
    const task = getTask(taskId);
    if (!task) return null;

    if (typeof totalSteps === "number" && totalSteps > 0) {
        task.total_steps = totalSteps;
    }

    if (typeof currentStep === "number" && currentStep >= 0) {
        task.current_step = currentStep;
    }

    if (etapaNombre) {
        task.etapa_nombre = etapaNombre;
    }

    task.etapa_numero = computeEtapaNumero(task.current_step, task.total_steps);
    return task;
}

function completeTask(taskId, result) {
    const task = getTask(taskId);
    if (!task) return null;

    task.status = "completado";
    task.result = result ?? null;
    task.etapa_nombre = "completado";
    task.current_step = task.total_steps || task.current_step;
    task.etapa_numero = computeEtapaNumero(task.current_step, task.total_steps);
    task.finished_at = now();
    counters.completed += 1;
    return task;
}

function failTask(taskId, { detalle, error, screenshot_url } = {}) {
    const task = getTask(taskId);
    if (!task) return null;

    const wasFailed = task.status === "fallido";
    task.status = "fallido";
    task.detalle = detalle || task.detalle || "Error desconocido";
    task.error = error || task.error || null;
    if (screenshot_url) task.screenshot_url = screenshot_url;
    task.finished_at = now();
    if (!wasFailed) counters.failed += 1;
    return task;
}

function patchTask(taskId, patch = {}) {
    const task = getTask(taskId);
    if (!task) return null;
    Object.assign(task, patch);
    return task;
}

function listRecentTasks(limit = 10) {
    const all = Array.from(tasks.values());
    all.sort((a, b) => (b.fecha_ejecucion || 0) - (a.fecha_ejecucion || 0));
    return all.slice(0, Math.max(1, limit));
}

function getMetrics() {
    const all = Array.from(tasks.values());
    const active = all.filter((t) => t.status === "En progreso").length;
    const done = counters.completed;
    const fail = counters.failed;

    return {
        total: tasks.size,
        active,
        done,
        fail,
    };
}

module.exports = {
    completeTask,
    createTask,
    failTask,
    getMetrics,
    getTask,
    listRecentTasks,
    markStarted,
    patchTask,
    setStage,
    toPublicStatus,
};
