const Execution = require("../models/Execution");
const { toDate } = require("../utils/time");

async function createExecution(payload) {
    const doc = await Execution.create(payload);
    return doc.toObject();
}

async function patchExecution(taskId, patch) {
    const updates = { ...patch };

    if (updates.fecha_ejecucion) updates.fecha_ejecucion = toDate(updates.fecha_ejecucion);
    if (updates.started_at) updates.started_at = toDate(updates.started_at);
    if (updates.finished_at) updates.finished_at = toDate(updates.finished_at);

    // Si vienen timestamps, intentar calcular duración
    const startedAt = updates.started_at || undefined;
    const finishedAt = updates.finished_at || undefined;
    if (startedAt && finishedAt) {
        updates.tiempo_transcurrido_ms = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    }

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

