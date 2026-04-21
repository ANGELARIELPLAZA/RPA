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

function escapeLabelValue(value) {
    return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/\n/g, "\\n")
        .replace(/"/g, '\\"');
}

function safeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

async function getPrometheusMetrics() {
    const totals = await Execution.aggregate([
        {
            $match: {
                tiempo_transcurrido_ms: { $type: "number" },
            },
        },
        {
            $group: {
                _id: "$status",
                count: { $sum: 1 },
                avg_ms: { $avg: "$tiempo_transcurrido_ms" },
                p95_arr: {
                    $percentile: {
                        input: "$tiempo_transcurrido_ms",
                        p: [0.95],
                        method: "approximate",
                    },
                },
            },
        },
    ]);

    const failuresByStage = await Execution.aggregate([
        { $match: { status: "fallido" } },
        { $group: { _id: "$etapa_nombre", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
    ]);

    const topErrors = await Execution.aggregate([
        { $match: { status: "fallido", detalle: { $exists: true, $ne: "" } } },
        { $group: { _id: "$detalle", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
    ]);

    const total = await Execution.countDocuments();

    const lines = [];
    lines.push("# HELP rpa_executions_total Total executions stored in MongoDB.");
    lines.push("# TYPE rpa_executions_total gauge");
    lines.push(`rpa_executions_total ${safeNumber(total)}`);

    lines.push("# HELP rpa_executions_by_status Executions count grouped by status.");
    lines.push("# TYPE rpa_executions_by_status gauge");

    lines.push("# HELP rpa_execution_duration_avg_ms Average execution duration in milliseconds grouped by status.");
    lines.push("# TYPE rpa_execution_duration_avg_ms gauge");

    lines.push("# HELP rpa_execution_duration_p95_ms p95 execution duration in milliseconds grouped by status.");
    lines.push("# TYPE rpa_execution_duration_p95_ms gauge");

    for (const row of totals) {
        const status = escapeLabelValue(row._id);
        const count = safeNumber(row.count);
        const avg = safeNumber(row.avg_ms);
        const p95 = safeNumber(Array.isArray(row.p95_arr) ? row.p95_arr[0] : 0);

        lines.push(`rpa_executions_by_status{status="${status}"} ${count}`);
        lines.push(`rpa_execution_duration_avg_ms{status="${status}"} ${avg}`);
        lines.push(`rpa_execution_duration_p95_ms{status="${status}"} ${p95}`);
    }

    lines.push("# HELP rpa_failures_by_stage_total Failed executions grouped by stage (top N).");
    lines.push("# TYPE rpa_failures_by_stage_total gauge");
    for (const row of failuresByStage) {
        const stage = escapeLabelValue(row._id);
        lines.push(`rpa_failures_by_stage_total{stage="${stage}"} ${safeNumber(row.count)}`);
    }

    lines.push("# HELP rpa_top_errors_total Failed executions grouped by detalle (top N).");
    lines.push("# TYPE rpa_top_errors_total gauge");
    for (const row of topErrors) {
        const detalle = escapeLabelValue(String(row._id).slice(0, 160));
        lines.push(`rpa_top_errors_total{detalle="${detalle}"} ${safeNumber(row.count)}`);
    }

    lines.push("");
    return lines.join("\n");
}

module.exports = {
    getMetrics,
    getPrometheusMetrics,
};
