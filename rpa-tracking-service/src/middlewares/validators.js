function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
}

const TASK_ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;
const EVENT_TYPE_RE = /^[a-zA-Z0-9._:-]{1,64}$/;

function validateTaskIdParam(req, res, next) {
    const taskId = req.params?.task_id;
    if (!isNonEmptyString(taskId) || !TASK_ID_RE.test(taskId)) {
        return res.status(400).json({ error: "task_id invalido" });
    }
    return next();
}

function validateTaskIdBody(req, res, next) {
    const taskId = req.body?.task_id;
    if (!isNonEmptyString(taskId) || !TASK_ID_RE.test(taskId)) {
        return res.status(400).json({ error: "task_id requerido o invalido" });
    }
    return next();
}

function validateEventTypeBody(req, res, next) {
    const eventType = req.body?.event_type;
    if (!isNonEmptyString(eventType) || !EVENT_TYPE_RE.test(eventType)) {
        return res.status(400).json({ error: "event_type requerido o invalido" });
    }
    return next();
}

module.exports = {
    validateEventTypeBody,
    validateTaskIdBody,
    validateTaskIdParam,
};

