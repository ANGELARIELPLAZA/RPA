function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
}

const TASK_ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;

function validateTaskIdParam(req, res, next) {
    const taskId = req.params?.task_id;
    if (!isNonEmptyString(taskId) || !TASK_ID_RE.test(taskId)) {
        return res.status(400).json({ error: "task_id invalido" });
    }
    return next();
}

module.exports = {
    validateTaskIdParam,
};

