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

function normalizeNivelDetalle(payload) {
    const raw = String(payload?.nivel_detalle ?? payload?.nivelDetalle ?? "").trim().toLowerCase();
    return raw;
}

function isSuccessfulFlowResult(payload, flowResult) {
    const nivelDetalle = normalizeNivelDetalle(payload);
    const result = flowResult && typeof flowResult === "object" ? flowResult : null;

    // Reglas de negocio: en modo "seguros" esperamos al menos 1 prima > 0.
    if (nivelDetalle === "seguros" && Array.isArray(flowResult)) {
        return flowResult.length > 0;
    }

    const estatus = result ? Number(result.estatus_code) : NaN;
    const hasEstatus = Number.isFinite(estatus);

    // Si el flow devuelve estatus_code, 1 = Ã©xito; cualquier otro valor es fallo.
    if (hasEstatus) return estatus === 1;

    // Reglas de negocio: guardar_cotizacion requiere folio.
    if (nivelDetalle === "guardar_cotizacion") {
        const folio = String(result?.folio ?? "").trim();
        return Boolean(folio);
    }

    // Si no hay seÃ±al de estatus, asumir Ã©xito (compatibilidad).
    return true;
}

function mergeDetalle(currentDetalle, extraDetalle) {
    const a = String(currentDetalle ?? "").trim();
    const b = String(extraDetalle ?? "").trim();
    if (!a) return b;
    if (!b) return a;
    if (a.includes(b)) return a;
    return `${a}\n${b}`;
}

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

async function readFormErrorContent(page) {
    if (!page) return "";

    try {
        const text = await page.evaluate(() => {
            const candidates = [
                document.querySelector("#formErrorContent"),
                document.querySelector(".formErrorContent"),
            ].filter(Boolean);

            const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();

            for (const el of candidates) {
                const t = normalize(el?.innerText || el?.textContent);
                if (t) return t;
            }

            // Fallback: algunos portales muestran errores en modales.
            const modal = document.querySelector(".messager-body");
            const modalText = normalize(modal?.innerText || modal?.textContent);
            if (modalText) return modalText;

            return "";
        });

        const trimmed = String(text || "").trim();
        if (!trimmed) return "";
        return trimmed.length > 800 ? `${trimmed.slice(0, 799)}…` : trimmed;
    } catch {
        return "";
    }
}

async function readFormErrorSnapshot(page) {
    if (!page) return { content: "", field: "" };

    try {
        const snap = await page.evaluate(() => {
            const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();

            const isVisible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (!style) return false;
                if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
                const rect = el.getBoundingClientRect?.();
                if (!rect) return true;
                return rect.width > 0 && rect.height > 0;
            };

            const pickText = (el) => normalize(el?.innerText || el?.textContent);

            const getLabelForInput = (input) => {
                if (!input) return "";
                const id = input.getAttribute?.("id");
                if (id && window.CSS && CSS.escape) {
                    const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                    const t = pickText(l);
                    if (t) return t;
                }
                const wrapLabel = input.closest("label");
                const wt = pickText(wrapLabel);
                if (wt) return wt;

                const group = input.closest(".form-group") || input.closest(".field") || input.closest("td") || input.closest("tr");
                if (group) {
                    const lab = group.querySelector("label");
                    const t = pickText(lab);
                    if (t) return t;
                }
                return "";
            };

            const candidates = [
                document.querySelector("#formErrorContent"),
                document.querySelector(".formErrorContent"),
            ].filter(Boolean);

            let content = "";
            for (const el of candidates) {
                const t = pickText(el);
                if (t) { content = t; break; }
            }

            if (!content) {
                const modal = document.querySelector(".messager-body");
                const modalText = pickText(modal);
                if (modalText) content = modalText;
            }

            if (!content) return { content: "", field: "" };

            const needle = "por favor seleccione";
            const errorEls = Array.from(document.querySelectorAll("div,span,small,p,li"))
                .filter((el) => isVisible(el))
                .map((el) => ({ el, t: pickText(el) }))
                .filter((x) => x.t && x.t.toLowerCase().includes(needle));

            for (const { el } of errorEls) {
                const scope = el.closest(".form-group") || el.closest(".field") || el.closest("td") || el.closest("tr") || el.parentElement;
                const input = scope?.querySelector?.("select, input, textarea");
                const label = getLabelForInput(input);
                const id = input?.getAttribute?.("id") || "";
                if (label || id) {
                    return { content, field: label ? `${label}${id ? ` (#${id})` : ""}` : (id ? `#${id}` : "") };
                }
            }

            const invalid = Array.from(document.querySelectorAll("select, input, textarea"))
                .filter((el) => isVisible(el))
                .filter((el) => {
                    const aria = String(el.getAttribute?.("aria-invalid") || "").toLowerCase() === "true";
                    const cls = String(el.className || "").toLowerCase();
                    return aria || cls.includes("invalid") || cls.includes("error");
                })[0];

            if (invalid) {
                const label = getLabelForInput(invalid);
                const id = invalid.getAttribute?.("id") || "";
                return { content, field: label ? `${label}${id ? ` (#${id})` : ""}` : (id ? `#${id}` : "") };
            }

            return { content, field: "" };
        });

        const content = String(snap?.content || "").trim();
        const field = String(snap?.field || "").trim();
        if (!content) return { content: "", field: "" };
        const clipped = content.length > 800 ? `${content.slice(0, 799)}â€¦` : content;
        return { content: clipped, field };
    } catch {
        return { content: "", field: "" };
    }
}

async function readVisibleFormErrorsSnapshot(page) {
    if (!page) return { errors: [], content: "", field: "" };

    try {
        const snap = await page.evaluate(() => {
            const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();

            const isVisible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (!style) return false;
                if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
                const rect = el.getBoundingClientRect?.();
                if (!rect) return true;
                return rect.width > 0 && rect.height > 0;
            };

            const pickText = (el) => normalize(el?.innerText || el?.textContent);

            const getLabelForInput = (input) => {
                if (!input) return "";
                const id = input.getAttribute?.("id");
                if (id && window.CSS && CSS.escape) {
                    const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                    const t = pickText(l);
                    if (t) return t;
                }
                const wrapLabel = input.closest("label");
                const wt = pickText(wrapLabel);
                if (wt) return wt;

                const group = input.closest(".form-group") || input.closest(".field") || input.closest("td") || input.closest("tr");
                if (group) {
                    const lab = group.querySelector("label");
                    const t = pickText(lab);
                    if (t) return t;
                }
                return "";
            };

            const errors = [];

            // Tooltips de validación (p.ej. jQuery ValidationEngine)
            const promptEls = Array.from(document.querySelectorAll(".formErrorContent, .formError .formErrorContent"))
                .filter((el) => isVisible(el));

            for (const el of promptEls) {
                const msg = pickText(el);
                if (!msg) continue;

                const formError = el.closest(".formError");
                const formErrorId = String(formError?.getAttribute?.("id") || "");
                const m = formErrorId.match(/^(.+?)formError$/i);
                const fieldId = m ? m[1] : "";
                const input = fieldId ? document.getElementById(fieldId) : null;
                const label = getLabelForInput(input);
                const field = label
                    ? `${label}${fieldId ? ` (#${fieldId})` : ""}`
                    : (fieldId ? `#${fieldId}` : "");

                errors.push({ content: msg, field });
            }

            // Modales del portal visibles
            const modal = document.querySelector(".messager-body");
            const modalText = isVisible(modal) ? pickText(modal) : "";
            if (modalText) errors.push({ content: modalText, field: "" });

            return {
                errors,
                content: errors.map((e) => e.content).filter(Boolean).join(" | "),
                field: errors.map((e) => e.field).filter(Boolean)[0] || "",
            };
        });

        const errors = Array.isArray(snap?.errors) ? snap.errors : [];
        const content = String(snap?.content || "").trim();
        const field = String(snap?.field || "").trim();
        return { errors, content, field };
    } catch {
        return { errors: [], content: "", field: "" };
    }
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
    const phaseDurations = {};
    let currentPhaseName = null;
    let currentPhaseStartedAt = Date.now();

    const stageIndexByName = new Map(stages.map((s, idx) => [s?.name, idx]));
    let lastPage = null;

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
            const now = Date.now();
            if (currentPhaseName) {
                phaseDurations[currentPhaseName] =
                    (phaseDurations[currentPhaseName] || 0) + Math.max(0, now - currentPhaseStartedAt);
            }
            currentPhaseName = name;
            currentPhaseStartedAt = now;
            taskStore.patchTask(taskId, { phase_durations: { ...phaseDurations } });

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

            if (page) lastPage = page;

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

            const formSnap = await readVisibleFormErrorsSnapshot(page);
            const errors = Array.isArray(formSnap?.errors) ? formSnap.errors : [];
            const content = String(formSnap?.content || "").trim();
            const field = String(formSnap?.field || "").trim();

            // Siempre sobrescribir/limpiar para evitar "arrastrar" errores ya resueltos.
            taskStore.patchTask(taskId, {
                form_errors: errors,
                form_error_content: content || null,
                form_error_field: field || null,
            });
            trackingClient.updateExecution(taskId, {
                form_errors: errors,
                form_error_content: content || null,
                form_error_field: field || null,
            });

            if (content) {
                trackingClient.createEvent({
                    task_id: taskId,
                    event_type: "form_error",
                    etapa_nombre: etapaNombre,
                    etapa_numero: `${currentStep}/${totalSteps}`,
                    message: field ? `${content} (campo: ${field})` : content,
                    level: "warn",
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
        const doneAt = Date.now();
        if (currentPhaseName) {
            phaseDurations[currentPhaseName] =
                (phaseDurations[currentPhaseName] || 0) + Math.max(0, doneAt - currentPhaseStartedAt);
            taskStore.patchTask(taskId, { phase_durations: { ...phaseDurations } });
        }
        setRobotError(null);

        const flowResult = result?.result ?? result ?? null;
        const ok = isSuccessfulFlowResult(normalizedPayload, flowResult);

        if (!ok) {
            const task = taskStore.getTask(taskId);

            // Fallo de negocio (sin excepción): también capturar screenshot/errores del formulario si hay page disponible.
            if (!task?.screenshot_url && lastPage) {
                await hooks.onErrorScreenshot({ page: lastPage }).catch(() => { });
            }
            const detalle = mergeDetalle(task?.detalle, flowResult?.mensaje_det || "Error: ejecuciÃ³n finalizÃ³ sin Ã©xito");

            taskStore.patchTask(taskId, { result: flowResult ?? null });
            taskStore.failTask(taskId, { detalle });

            trackingClient.updateExecution(taskId, {
                status: "fallido",
                detalle,
                finished_at: new Date().toISOString(),
                result: flowResult ?? null,
            });
            trackingClient.createEvent({
                task_id: taskId,
                event_type: "error",
                etapa_nombre: etapaNombre,
                etapa_numero: `${currentStep}/${totalSteps}`,
                message: detalle,
                level: "error",
                timestamp: new Date().toISOString(),
                meta: { type: "business_result" },
            });

            return;
        }

        taskStore.completeTask(taskId, flowResult);

        trackingClient.updateExecution(taskId, {
            status: "completado",
            etapa_nombre: "completado",
            current_step: totalSteps,
            total_steps: totalSteps,
            etapa_numero: `${totalSteps}/${totalSteps}`,
            finished_at: new Date().toISOString(),
            result: flowResult,
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
        const doneAt = Date.now();
        if (currentPhaseName) {
            phaseDurations[currentPhaseName] =
                (phaseDurations[currentPhaseName] || 0) + Math.max(0, doneAt - currentPhaseStartedAt);
            taskStore.patchTask(taskId, { phase_durations: { ...phaseDurations } });
        }

        const isDebugStop = String(error?.code || "").toUpperCase() === "DEBUG_STOP";
        if (!isDebugStop) {
            setRobotError(error);
            logger.error(`[task ${String(taskId).slice(0, 8)}] error: ${error?.message || error}`);
        } else {
            setRobotError(null);
            logger.warn(`[task ${String(taskId).slice(0, 8)}] debug stop: ${error?.message || error}`);
        }

        // Si el robot ya tiene page, siempre intentar evidencia.
        const taskBeforeFail = taskStore.getTask(taskId);
        if (!taskBeforeFail?.screenshot_url && lastPage) {
            await hooks.onErrorScreenshot({ page: lastPage }).catch(() => { });
        }

        // intentar screenshot si el flow expone page en error (hooks), si no, solo marcar fallo
        const errorDetalle = isDebugStop ? String(error?.message || "Debug stop") : buildTaskDetalle(error);
        const formError = taskStore.getTask(taskId)?.form_error_content;
        const formErrorLine = formError ? `\nFormError: ${formError}` : "";
        const lastProgress = taskStore.getTask(taskId)?.detalle;
        const prefix = isDebugStop ? "DebugStop" : "Error";
        const detalle = lastProgress ? `${lastProgress}\n${prefix}: ${errorDetalle}${formErrorLine}` : `${errorDetalle}${formErrorLine}`;
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
            event_type: isDebugStop ? "debug_stop" : "error",
            etapa_nombre: etapaNombre,
            etapa_numero: `${currentStep}/${totalSteps}`,
            message: detalle,
            level: isDebugStop ? "warn" : "error",
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
