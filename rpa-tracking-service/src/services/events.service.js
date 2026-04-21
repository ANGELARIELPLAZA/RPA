const ExecutionEvent = require("../models/ExecutionEvent");
const { sanitizeMongoObject } = require("../utils/sanitize");

async function createEvent(payload) {
    const cleaned = sanitizeMongoObject(payload || {});
    const doc = await ExecutionEvent.create(cleaned || {});
    return doc.toObject();
}

async function listEvents(taskId, query) {
    const limit = Math.min(500, Math.max(1, Number(query.limit || 200)));
    const docs = await ExecutionEvent.find({ task_id: taskId }).sort({ createdAt: 1 }).limit(limit);
    return docs.map((d) => d.toObject());
}

module.exports = {
    createEvent,
    listEvents,
};
