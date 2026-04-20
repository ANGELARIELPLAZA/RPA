const crypto = require("crypto");
const logger = require("../core/logger");
const { formatDateTime } = require("../utils/time");
const { pingPortal } = require("../services/portalHealth.service");
const { normalizeCotizacionPayload } = require("../services/payloadNormalizer.service");
const { buildFlowStages } = require("../services/flowPlan.service");
const taskStore = require("../services/taskStore.service");
const trackingClient = require("../services/trackingClient.service");
const { enqueueExecution } = require("../services/cetelemAsync.service");

function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // Fallback muy raro, pero evita romper en runtimes viejos
    return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function isPortalDown(portalStatus) {
    if (!portalStatus) return true;
    if (portalStatus.available) return false;

    const code = portalStatus.http_code;
    if (code === 502 || code === 503) return true;

    const errCode = portalStatus.error?.code;
    return ["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND"].includes(String(errCode || ""));
}

async function cotizarCetelemAsync(req, res) {
    // 1) VALIDACIÓN PREVIA OBLIGATORIA: validar portal ANTES de task_id
    const portal = await pingPortal();
    if (isPortalDown(portal)) {
        logger.error("[portal] fuera de servicio", portal);
        return res.status(503).json({
            status: "fallido",
            detalle: "portal de cetelem fuera de servicio",
            fecha_ejecucion: formatDateTime(new Date()),
        });
    }

    // 2) Normalización del payload (Formato A o B)
    let normalizedPayload;
    try {
        normalizedPayload = normalizeCotizacionPayload(req.body);
    } catch (error) {
        return res.status(400).json({
            status: "fallido",
            detalle: error?.message || "payload inválido",
            fecha_ejecucion: formatDateTime(new Date()),
        });
    }

    const task_id = uuid();
    const fecha_ejecucion = Date.now();
    const stages = buildFlowStages(normalizedPayload);

    taskStore.createTask({
        task_id,
        fecha_ejecucion,
        payload_original: req.body,
        payload_normalizado: normalizedPayload,
        total_steps: stages.length,
    });

    trackingClient.createExecution({
        task_id,
        source_service: "RPA-NODE-V2",
        status: "En progreso",
        etapa_nombre: "inicializando",
        etapa_numero: `0/${stages.length}`,
        current_step: 0,
        total_steps: stages.length,
        fecha_ejecucion: new Date(fecha_ejecucion).toISOString(),
        payload_original: req.body,
        payload_normalizado: normalizedPayload,
        portal_meta: {
            available_at_start: portal.available,
            http_code: portal.http_code,
            response_ms: portal.response_ms,
            url: portal.url,
        },
    });

    trackingClient.createEvent({
        task_id,
        event_type: "request",
        level: "info",
        message: "Request recibido",
        timestamp: new Date().toISOString(),
        meta: {},
    });

    // 3) Respuesta inmediata
    res.status(202).json({
        task_id,
        status: "En progreso",
        fecha_ejecucion: formatDateTime(new Date(fecha_ejecucion)),
    });

    // 4) Ejecución asíncrona (no bloquear response)
    enqueueExecution(task_id, normalizedPayload, {
        available_at_start: portal.available,
        http_code: portal.http_code,
        response_ms: portal.response_ms,
        url: portal.url,
    }).catch((error) => {
        logger.warn(`[enqueue] no se pudo encolar task_id=${task_id}: ${error?.message || error}`);
    });
}

module.exports = {
    cotizarCetelemAsync,
};
