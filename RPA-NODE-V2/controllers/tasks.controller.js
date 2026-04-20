const taskStore = require("../services/taskStore.service");

function normalizeStatusFilter(value) {
    if (value === undefined || value === null) return [];
    const raw = String(value).trim();
    if (!raw) return [];
    return raw
        .split(",")
        .map((x) => String(x || "").trim().toLowerCase())
        .filter(Boolean);
}

function listTasks(req, res) {
    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 50;

    const statuses = normalizeStatusFilter(req.query.status ?? req.query.statuses);
    const tasks = taskStore.listRecentTasks(limit);

    const filtered = statuses.length
        ? tasks.filter((t) => statuses.includes(String(t.status || "").toLowerCase()))
        : tasks;

    return res.json({
        total: filtered.length,
        tasks: filtered.map((t) => taskStore.toPublicStatus(t, { includeScreenshotBase64: false })),
    });
}

module.exports = {
    listTasks,
};

