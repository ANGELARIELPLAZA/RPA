const logger = require("../core/logger");
const { formatHhMmSs } = require("../utils/time");

function truncate(value, max) {
    const raw = String(value || "");
    if (raw.length <= max) return raw;
    return `${raw.slice(0, Math.max(0, max - 1))}…`;
}

function pad(value, len) {
    const raw = String(value || "");
    if (raw.length >= len) return raw.slice(0, len);
    return raw.padEnd(len, " ");
}

function render(snapshot, options = {}) {
    const maxTasks = options.maxTasks || 10;

    const header = `RPA-NODE-V2 | API: ${snapshot.api?.toUpperCase?.() || snapshot.api} | Portal: ${snapshot.portal} | Robot: ${String(snapshot.robot || "").toUpperCase()}`;
    const uptime = formatHhMmSs(snapshot.uptime_ms || 0);
    const line2 = `Uptime: ${uptime} | Active: ${snapshot.activeContexts} | Queue: ${snapshot.queuedTasks} | Done: ${snapshot.metrics?.done ?? 0} | Fail: ${snapshot.metrics?.fail ?? 0}`;

    const rows = (snapshot.recentTasks || []).slice(0, maxTasks).map((t) => {
        const id = truncate(t.task_id, 8);
        const status = truncate(t.status, 12);
        const etapa = truncate(t.etapa_nombre, 12);
        const avance = truncate(t.etapa_numero, 7);
        const tiempo = truncate(t.tiempo_transcurrido, 10);
        const err = t.detalle ? ` | ${truncate(t.detalle, 42)}` : t.screenshot_url ? ` | ${truncate(t.screenshot_url, 42)}` : "";
        return `${pad(id, 12)} ${pad(status, 12)} ${pad(etapa, 12)} ${pad(avance, 7)} ${pad(tiempo, 10)}${err}`;
    });

    const sep = "-".repeat(50);
    const tableHead = `TASK_ID      STATUS       ETAPA        AVANCE  TIEMPO     DETALLE/URL`;
    const body = rows.length ? rows.join("\n") : "(sin tareas)";

    return `${sep}\n${header}\n${line2}\n${sep}\n${tableHead}\n${body}\n${sep}\n`;
}

function startConsoleMonitor(getSnapshot, options = {}) {
    const enabled = Boolean(options.enabled);
    if (!enabled) return { stop: () => { } };

    const refreshMs = Math.max(250, Number(options.refreshMs || 1000));
    const isTTY = Boolean(process.stdout.isTTY);

    let timer = null;
    let stopped = false;
    let lastNonTtyHash = "";

    function writeToScreen(text) {
        // Limpieza + cursor home para evitar scroll
        process.stdout.write("\x1b[2J\x1b[H");
        process.stdout.write(text);
    }

    async function tick() {
        if (stopped) return;
        try {
            const snapshot = await getSnapshot();
            const text = render(snapshot, options);

            if (isTTY) {
                writeToScreen(text);
                return;
            }

            // Modo no-TTY: solo log mínimo cuando cambia algo importante
            const hash = `${snapshot.api}|${snapshot.portal}|${snapshot.robot}|${snapshot.activeContexts}|${snapshot.queuedTasks}|${snapshot.metrics?.done}|${snapshot.metrics?.fail}`;
            if (hash !== lastNonTtyHash) {
                lastNonTtyHash = hash;
                logger.info(`[monitor] api=${snapshot.api} portal=${snapshot.portal} robot=${snapshot.robot} active=${snapshot.activeContexts} queue=${snapshot.queuedTasks} done=${snapshot.metrics?.done} fail=${snapshot.metrics?.fail}`);
            }
        } catch (error) {
            logger.warn(`[monitor] error: ${error?.message || error}`);
        }
    }

    function stop() {
        stopped = true;
        if (timer) clearInterval(timer);
        timer = null;
        if (isTTY) {
            process.stdout.write("\x1b[0m");
        }
    }

    timer = setInterval(tick, refreshMs);
    timer.unref?.();
    tick();

    process.on("SIGINT", () => stop());
    process.on("SIGTERM", () => stop());

    return { stop };
}

module.exports = {
    startConsoleMonitor,
};

