const os = require("os");
const { enqueueContextTask, getActiveContextCount, getPendingTaskCount } = require("../core/context-queue");
const logger = require("../core/logger");
const { logTask } = require("../core/task-logger");
const { buildFlowStages } = require("./flowPlan.service");
const { takeTaskScreenshot } = require("./screenshot.service");
const trackingClient = require("./trackingClient.service");
const taskStore = require("./taskStore.service");

const { runCetelemFlowWithRetries } = require("../index");

let lastRobotError = null;

function isCetelemIntermitenteClickTimeout(errorMessage) {
    const m = String(errorMessage || "");
    if (!m) return false;

    const isClickTimeout =
        m.includes("locator.click: Timeout") ||
        (m.includes("Timeout") && m.includes("locator.click"));

    const isEntrar =
        m.includes("#btnEntrar") ||
        m.includes("locator('#btnEntrar')") ||
        m.includes("locator(\"#btnEntrar\")");

    const looksLikeOverlayInterception =
        m.includes("contenedor_carga") ||
        m.includes("intercepts pointer events");

    return isClickTimeout && isEntrar && looksLikeOverlayInterception;
}

function buildTaskDetalle(error) {
    const raw = error?.message ? String(error.message) : "";
    if (/502\s+bad\s+gateway/i.test(raw) || /\bbad\s+gateway\b/i.test(raw)) {
        return "portal de cetelem fuera de servicio";
    }
    if (isCetelemIntermitenteClickTimeout(raw)) {
        return "portal de cetelem con intermitencias: pantalla de carga bloqueo el click en 'Ingresar'";
    }
    return raw || "Error durante ejecución";
}

function getRobotStatus() {
    if (lastRobotError) return "error";
    return getActiveContextCount() > 0 ? "ocupado" : "libre";
}

function getLastRobotError() {
    return lastRobotError;
}

function setRobotError(error) {
    lastRobotError = error
        ? {
            message: error?.message || String(error),
            at: Date.now(),
        }
        : null;
}

async function executeTask(taskId, normalizedPayload, portalMeta) {
    taskStore.markStarted(taskId);
    trackingClient.updateExecution(taskId, { started_at: new Date().toISOString() });
    trackingClient.createEvent({
        task_id: taskId,
        event_type: "started",
        level: "info",
        message: "Ejecución iniciada",
        timestamp: new Date().toISOString(),
        meta: {},
    });

    const stages = buildFlowStages(normalizedPayload);
    const totalSteps = stages.length;
    let currentStep = 0;
    let etapaNombre = "inicializando";

    const stageIndexByName = new Map(stages.map((s, idx) => [s?.name, idx]));

    taskStore.setStage(taskId, etapaNombre, currentStep, totalSteps);
    trackingClient.updateExecution(taskId, {
        status: "En progreso",
        etapa_nombre: etapaNombre,
        current_step: currentStep,
        total_steps: totalSteps,
        etapa_numero: `${currentStep}/${totalSteps}`,
        portal_meta: portalMeta || undefined,
        robot_meta: {
            hostname: os.hostname(),
            pid: process.pid,
            environment: process.env.NODE_ENV || "development",
            headless: process.env.HEADLESS,
            version: process.env.npm_package_version,
        },
    });

    const hooks = {
        onStage: async ({ name }) => {
            etapaNombre = name;
            const idx = stageIndexByName.get(name);
            currentStep = Number.isInteger(idx) && idx >= 0 ? idx + 1 : currentStep + 1;
            taskStore.setStage(taskId, etapaNombre, currentStep, totalSteps);
            trackingClient.updateExecution(taskId, {
                etapa_nombre: etapaNombre,
                current_step: currentStep,
                total_steps: totalSteps,
                etapa_numero: `${currentStep}/${totalSteps}`,
            });
            trackingClient.createEvent({
                task_id: taskId,
                event_type: "stage_change",
                etapa_nombre: etapaNombre,
                etapa_numero: `${currentStep}/${totalSteps}`,
                message: `Etapa: ${etapaNombre}`,
                level: "info",
                timestamp: new Date().toISOString(),
                meta: {},
            });
            logTask(taskId, `etapa=${etapaNombre}`, { etapaNumero: `${currentStep}/${totalSteps}` }, { level: "debug" });
        },
        onProgress: async ({ page, message }) => {
            const msg = String(message || "").trim();
            if (!msg) return;

            const now = Date.now();
            const task = taskStore.getTask(taskId);
            const lastAt = task?.__last_progress_at || 0;
            const lastMsg = task?.__last_progress_msg || "";

            // throttle: evita spam si llega el mismo msg muy seguido
            if (msg === lastMsg && now - lastAt < 500) return;

            const url = page && typeof page.url === "function" ? page.url() : "";
            const detalle = url ? `${msg} | URL: ${url}` : msg;

            taskStore.patchTask(taskId, {
                detalle,
                __last_progress_at: now,
                __last_progress_msg: msg,
            });
            trackingClient.updateExecution(taskId, { detalle });
        },
        onErrorScreenshot: async ({ page }) => {
            const shot = await takeTaskScreenshot(page, { taskId, etapaNombre });
            if (shot?.url) {
                taskStore.patchTask(taskId, { screenshot_url: shot.url });
                trackingClient.updateExecution(taskId, { screenshot_url: shot.url });
                trackingClient.createEvent({
                    task_id: taskId,
                    event_type: "screenshot",
                    etapa_nombre: etapaNombre,
                    etapa_numero: `${currentStep}/${totalSteps}`,
                    message: "Screenshot generado",
                    level: "warn",
                    screenshot_url: shot.url,
                    timestamp: new Date().toISOString(),
                    meta: {},
                });
            }
            return shot;
        },
    };

    try {
        logTask(taskId, "iniciando RPA", { totalSteps }, { level: "info" });
        const result = await runCetelemFlowWithRetries(normalizedPayload, hooks);
        setRobotError(null);
        taskStore.completeTask(taskId, result?.result ?? result ?? null);

        trackingClient.updateExecution(taskId, {
            status: "completado",
            etapa_nombre: "completado",
            current_step: totalSteps,
            total_steps: totalSteps,
            etapa_numero: `${totalSteps}/${totalSteps}`,
            finished_at: new Date().toISOString(),
            result: result?.result ?? result ?? null,
        });
        trackingClient.createEvent({
            task_id: taskId,
            event_type: "completed",
            etapa_nombre: "completado",
            etapa_numero: `${totalSteps}/${totalSteps}`,
            message: "Ejecución completada",
            level: "info",
            timestamp: new Date().toISOString(),
            meta: {},
        });
    } catch (error) {
        setRobotError(error);
        logger.error(`[task ${String(taskId).slice(0, 8)}] error: ${error?.message || error}`);

        // intentar screenshot si el flow expone page en error (hooks), si no, solo marcar fallo
        const errorDetalle = buildTaskDetalle(error);
        const lastProgress = taskStore.getTask(taskId)?.detalle;
        const detalle = lastProgress ? `${lastProgress}\nError: ${errorDetalle}` : errorDetalle;
        taskStore.failTask(taskId, {
            detalle,
            error: {
                message: error?.message || String(error),
                stack: error?.stack,
                code: error?.code,
            },
        });

        trackingClient.updateExecution(taskId, {
            status: "fallido",
            detalle,
            error: {
                message: error?.message || String(error),
                stack: error?.stack,
                code: error?.code,
            },
            finished_at: new Date().toISOString(),
        });
        trackingClient.createEvent({
            task_id: taskId,
            event_type: "error",
            etapa_nombre: etapaNombre,
            etapa_numero: `${currentStep}/${totalSteps}`,
            message: detalle,
            level: "error",
            timestamp: new Date().toISOString(),
            meta: { code: error?.code },
        });
    }
}

function enqueueExecution(taskId, normalizedPayload, portalMeta) {
    return enqueueContextTask(() => executeTask(taskId, normalizedPayload, portalMeta));
}

function getQueueSnapshot() {
    return {
        activeContexts: getActiveContextCount(),
        queuedTasks: getPendingTaskCount(),
        robot: getRobotStatus(),
        lastRobotError: getLastRobotError(),
    };
}

module.exports = {
    enqueueExecution,
    getQueueSnapshot,
    getRobotStatus,
};
