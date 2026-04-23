const fs = require("fs");
const path = require("path");
const taskStore = require("../services/taskStore.service");
const { BASE_URL, SCREENSHOTS_DIR } = require("../config");

function pad2(n) {
    return String(n).padStart(2, "0");
}

function formatDayLocal(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function normalizeNivelDetalle(task) {
    const raw = String(task?.payload_normalizado?.nivel_detalle ?? task?.payload_normalizado?.nivelDetalle ?? "").trim().toLowerCase();
    if (raw) return raw;
    return String(task?.payload_original?.nivel_detalle ?? task?.payload_original?.nivelDetalle ?? "").trim().toLowerCase();
}

function normalizeAgencia(task) {
    const a = task?.payload_normalizado?.agencia ?? task?.payload_original?.agencia;
    return String(a ?? "").trim() || "desconocida";
}

function parseIntSafe(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function pushGrouped(groups, { day, agencia, endpoint, task_id, nivel_detalle }, item) {
    const d = day || "unknown_day";
    const a = agencia || "desconocida";
    const e = endpoint || "unknown_endpoint";
    const t = task_id || "unknown_task";
    const n = nivel_detalle || "sin_nivel_detalle";

    groups[d] ??= {};
    groups[d][a] ??= {};
    groups[d][a][e] ??= {};
    groups[d][a][e][t] ??= {};
    groups[d][a][e][t][n] ??= [];
    groups[d][a][e][t][n].push(item);
}

function buildScreenshotUrl(filename) {
    return `${BASE_URL}/screenshots/${encodeURIComponent(filename)}`;
}

function parsePortalLabel(label) {
    const l = String(label || "");
    const aStart = l.indexOf("agencia_");
    const eStart = l.indexOf("_endpoint_");
    const agencia =
        aStart >= 0 && eStart > aStart
            ? String(l.slice(aStart + "agencia_".length, eStart)).trim()
            : "";
    const endpoint = eStart >= 0 ? String(l.slice(eStart + "_endpoint_".length)).trim() : "";

    return {
        agencia: agencia || "desconocida",
        endpoint: endpoint ? `/${endpoint.replace(/^\/+/, "")}` : "unknown_endpoint",
    };
}

function listPortalScreenshots({ maxFiles = 400, sinceDay } = {}) {
    const out = [];
    let files = [];
    try {
        files = fs.readdirSync(SCREENSHOTS_DIR);
    } catch {
        files = [];
    }

    const portalFiles = files
        .filter((f) => /^portal_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_.+\.png$/i.test(f))
        .sort()
        .slice(-Math.max(1, maxFiles));

    for (const filename of portalFiles) {
        const m = filename.match(/^portal_(\d{4}-\d{2}-\d{2})_\d{2}-\d{2}-\d{2}_(.+)\.png$/i);
        if (!m) continue;
        const day = m[1];
        if (sinceDay && day < sinceDay) continue;

        const label = m[2];
        const meta = parsePortalLabel(label);

        out.push({
            kind: "portal",
            day,
            agencia: meta.agencia,
            endpoint: meta.endpoint,
            task_id: null,
            nivel_detalle: null,
            filename,
            screenshot_url: buildScreenshotUrl(filename),
        });
    }

    return out;
}

function listTaskScreenshotsFromStore({ limit = 200, sinceMs } = {}) {
    const tasks = taskStore.listRecentTasks(limit);
    const out = [];

    for (const task of tasks) {
        if (!task?.screenshot_url) continue;
        const fechaMs =
            typeof task.fecha_ejecucion === "number"
                ? task.fecha_ejecucion
                : Number.isFinite(Date.parse(task.fecha_ejecucion))
                    ? Date.parse(task.fecha_ejecucion)
                    : null;
        if (!fechaMs) continue;
        if (sinceMs && fechaMs < sinceMs) continue;

        const day = formatDayLocal(fechaMs);
        const agencia = normalizeAgencia(task);
        const endpoint = task.endpoint || null;
        const nivel_detalle = normalizeNivelDetalle(task) || null;

        const match = String(task.screenshot_url).match(/\/screenshots\/([^?#]+)/i);
        const filename = match ? decodeURIComponent(match[1]) : null;

        out.push({
            kind: "task",
            day,
            agencia,
            endpoint,
            task_id: task.task_id,
            nivel_detalle,
            filename,
            screenshot_url: task.screenshot_url,
            status: task.status,
            etapa_nombre: task.etapa_nombre,
            etapa_numero: task.etapa_numero,
        });
    }

    return out;
}

function listTaskScreenshotsFromDisk({ maxFiles = 1200, sinceDay } = {}) {
    const out = [];
    let files = [];
    try {
        files = fs.readdirSync(SCREENSHOTS_DIR);
    } catch {
        files = [];
    }

    const taskFiles = files
        .filter((f) => /^task_[0-9a-f-]{8,}_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_.+\.png$/i.test(f))
        .sort()
        .slice(-Math.max(1, maxFiles));

    for (const filename of taskFiles) {
        const m = filename.match(/^task_([0-9a-f-]{8,})_(\d{4}-\d{2}-\d{2})_\d{2}-\d{2}-\d{2}_.+\.png$/i);
        if (!m) continue;
        const task_id = m[1];
        const day = m[2];
        if (sinceDay && day < sinceDay) continue;

        out.push({
            kind: "task_file",
            day,
            agencia: "desconocida",
            endpoint: "unknown_endpoint",
            task_id,
            nivel_detalle: null,
            filename,
            screenshot_url: buildScreenshotUrl(filename),
        });
    }

    return out;
}

function buildHtml(items) {
    const esc = (s) =>
        String(s ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");

    const rows = items
        .map((it) => {
            const title = [
                it.day,
                it.agencia ? `agencia=${it.agencia}` : null,
                it.endpoint ? `endpoint=${it.endpoint}` : null,
                it.task_id ? `task=${it.task_id}` : null,
                it.nivel_detalle ? `nivel=${it.nivel_detalle}` : null,
                it.etapa_nombre ? `etapa=${it.etapa_nombre}` : null,
                it.status ? `status=${it.status}` : null,
            ]
                .filter(Boolean)
                .join(" | ");
            return `<div class="card">
  <div class="meta">${esc(title)}</div>
  <a href="${esc(it.screenshot_url)}" target="_blank" rel="noreferrer">
    <img src="${esc(it.screenshot_url)}" loading="lazy" />
  </a>
</div>`;
        })
        .join("\n");

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Screenshots report</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:16px;background:#0b0f14;color:#e8eef5}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
    .card{border:1px solid #1e2a36;border-radius:10px;padding:10px;background:#0f1720}
    .meta{font-size:12px;opacity:.85;margin-bottom:8px;word-break:break-word}
    img{width:100%;height:auto;border-radius:8px;border:1px solid #1e2a36;background:#0b0f14}
    a{color:inherit;text-decoration:none}
  </style>
</head>
<body>
  <h2>Screenshots</h2>
  <div class="grid">${rows}</div>
</body>
</html>`;
}

function getScreenshotsReport(req, res) {
    const limit = Math.max(1, Math.min(2000, parseIntSafe(req.query.limit, 200)));
    const days = Math.max(1, Math.min(60, parseIntSafe(req.query.days, 7)));
    const includePortal = String(req.query.include_portal ?? "1") !== "0";
    const format = String(req.query.format ?? "json").trim().toLowerCase();

    const now = Date.now();
    const sinceMs = now - days * 24 * 60 * 60 * 1000;
    const sinceDay = formatDayLocal(sinceMs);

    const items = [];
    const fromStore = listTaskScreenshotsFromStore({ limit, sinceMs });
    const knownFilenames = new Set(fromStore.map((x) => x.filename).filter(Boolean));
    items.push(...fromStore);
    for (const it of listTaskScreenshotsFromDisk({ maxFiles: 1500, sinceDay })) {
        if (it.filename && knownFilenames.has(it.filename)) continue;
        items.push(it);
    }
    if (includePortal) {
        items.push(...listPortalScreenshots({ maxFiles: 800, sinceDay }));
    }

    items.sort((a, b) => String(b.day).localeCompare(String(a.day)));

    if (format === "html") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        return res.status(200).send(buildHtml(items));
    }

    const groups = {};
    for (const it of items) {
        pushGrouped(
            groups,
            {
                day: it.day,
                agencia: it.agencia,
                endpoint: it.endpoint,
                task_id: it.task_id,
                nivel_detalle: it.nivel_detalle,
            },
            it
        );
    }

    return res.json({
        generated_at: new Date().toISOString(),
        days,
        total_items: items.length,
        groups,
    });
}

module.exports = {
    getScreenshotsReport,
};
