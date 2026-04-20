const Execution = require("../models/Execution");

async function getMetrics() {
    const totals = await Execution.aggregate([
        {
            $group: {
                _id: "$status",
                count: { $sum: 1 },
                avgDuration: { $avg: "$tiempo_transcurrido_ms" },
            },
        },
    ]);

    const byStatus = Object.fromEntries(totals.map((r) => [r._id, { count: r.count, avg_ms: r.avgDuration || 0 }]));

    const failuresByStage = await Execution.aggregate([
        { $match: { status: "fallido" } },
        { $group: { _id: "$etapa_nombre", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
    ]);

    const topErrors = await Execution.aggregate([
        { $match: { status: "fallido", detalle: { $exists: true, $ne: "" } } },
        { $group: { _id: "$detalle", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
    ]);

    const total = await Execution.countDocuments();

    return {
        total,
        byStatus,
        failuresByStage,
        topErrors,
    };
}

module.exports = {
    getMetrics,
};

