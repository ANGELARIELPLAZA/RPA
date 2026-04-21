const Execution = require("../models/Execution");
const { toDate } = require("../utils/time");

function isErrorText(value) {
    if (typeof value !== "string") return false;
    return /\berror\b/i.test(value);
}

function hasOwn(obj, key) {
    return obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function inferShouldFailFromPayload(payload) {
    const result = payload?.result || {};

    // Si el cliente ya nos manda un error estructurado, es fallo.
    if (payload?.error && (payload.error.message || payload.error.stack || payload.error.code)) return true;

    // Señales textuales de error
    const mensajeDet = result?.mensaje_det || result?.mensaje || result?.message;
    if (isErrorText(mensajeDet)) return true;
    if (isErrorText(payload?.detalle)) return true;

    // Código de estatus explícito (cuando aplica)
    const estatusCode = result?.estatus_code;
    if (typeof estatusCode === "number" && estatusCode !== 0) return true;
    if (typeof estatusCode === "string" && estatusCode !== "0" && estatusCode !== "") return true;

    // Casos conocidos: guardado sin folio => fallo aunque el cliente marque completado
    if (hasOwn(result, "folio") && (result.folio === null || result.folio === undefined || result.folio === "")) {
        const completionLike =
            payload?.status === "completado" || payload?.etapa_nombre === "completado" || Boolean(payload?.finished_at);
        if (completionLike) return true;
    }

    return false;
}

function normalizeExecutionUpdates(updates) {
    // Normalización de fechas (acepta strings, numbers o Date)
    if (updates.fecha_ejecucion) updates.fecha_ejecucion = toDate(updates.fecha_ejecucion);
    if (updates.started_at) updates.started_at = toDate(updates.started_at);
    if (updates.finished_at) updates.finished_at = toDate(updates.finished_at);

    // Si vienen timestamps, intentar calcular duración
    const startedAt = updates.started_at || undefined;
    const finishedAt = updates.finished_at || undefined;
    if (startedAt && finishedAt) {
        updates.tiempo_transcurrido_ms = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    }

    const completionLike =
        updates.status === "completado" || updates.etapa_nombre === "completado" || Boolean(updates.finished_at);

    if (completionLike && updates.status !== "fallido" && inferShouldFailFromPayload(updates)) {
        updates.status = "fallido";
        updates.etapa_nombre = "fallido";

        if (!updates.error) updates.error = {};
        if (!updates.error.message) {
            const result = updates.result || {};
            updates.error.message = result?.mensaje_det || updates.detalle || "Ejecución marcada como fallida";
        }
    }

    return updates;
}

async function createExecution(payload) {
    const normalized = normalizeExecutionUpdates({ ...payload });
    const doc = await Execution.create(normalized);
    return doc.toObject();
}

async function patchExecution(taskId, patch) {
    const updates = normalizeExecutionUpdates({ ...patch });

    const doc = await Execution.findOneAndUpdate({ task_id: taskId }, { $set: updates }, { new: true });
    return doc ? doc.toObject() : null;
}

async function getExecution(taskId) {
    const doc = await Execution.findOne({ task_id: taskId });
    return doc ? doc.toObject() : null;
}

async function listExecutions(query) {
    const filter = {};

    if (query.status) filter.status = query.status;
    if (query.etapa_nombre) filter.etapa_nombre = query.etapa_nombre;

    if (query.from || query.to) {
        filter.createdAt = {};
        if (query.from) filter.createdAt.$gte = toDate(query.from) || undefined;
        if (query.to) filter.createdAt.$lte = toDate(query.to) || undefined;
    }

    const limit = Math.min(200, Math.max(1, Number(query.limit || 50)));

    const docs = await Execution.find(filter).sort({ createdAt: -1 }).limit(limit);
    return docs.map((d) => d.toObject());
}

module.exports = {
    createExecution,
    getExecution,
    listExecutions,
    patchExecution,
};
