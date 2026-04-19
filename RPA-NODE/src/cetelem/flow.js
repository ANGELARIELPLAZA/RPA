const fs = require("fs");
const path = require("path");
const BrowserManager = require("../core/browser-manager");
const { enqueueContextTask, getActiveContextCount } = require("../core/context-queue");
const logger = require("../core/logger");
const { logTask, shortTaskId } = require("../core/task-logger");
const {
    BAD_URL_TOKEN,
    LOGIN_URL,
    LOGS_DIR,
    MAX_REINTENTOS,
    PASSWORD,
    SCREENSHOTS_DIR,
    TIPO_PERSONA_READY_VALUE,
    TIPO_PERSONA_SELECTOR,
    USUARIO,
    VIDEOS_DIR,
    assertCredentials,
} = require("../config");
const {
    fillClientData,
    fillCreditData,
    fillInsuranceData,
    fillVehicleData,
    readInsuranceMonthlyFee,
    readInsuranceOptions,
    readVehiclePriceTax,
    readVehicleTotalAmount,
} = require("./form");

const READY_TEXT_RAZON_SOCIAL = "capturar nombre de razon social como aparece en el registro del rfc o documentos oficiales";
const SYSTEMA_EXPERTO_ERROR_TEXT = "Error obteniendo variables para Systema Experto";
const ACTIVE_POPUP_SESSION_TEXT = "su sesión se encuentra activa en una ventana emergente";
const POPUP_TIMEOUT_MS = 15000;
const SESSION_LOAD_WAIT_MS = 6000;
const REOPEN_POPUP_SELECTOR = "#btnReopen";

const DATA_FLOWS = {
    cliente: fillClientData,
    vehiculo: fillVehicleData,
    credito: fillCreditData,
    seguro: fillInsuranceData,
};

function isBrowserClosedError(error) {
    return /browser.*closed|browser.*disconnected|target.*closed|context.*closed|has been closed/i.test(error.message || "");
}

function createNonRetryableError(message) {
    const error = new Error(message);
    error.retryable = false;
    return error;
}

function createTimestamp() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
}

function isDeadSession(url) {
    return (url || "").includes(BAD_URL_TOKEN);
}

function validateSession(pageOrPopup) {
    const currentUrl = pageOrPopup.url();
    logger.debug(`URL actual: ${currentUrl}`);

    if (isDeadSession(currentUrl)) {
        throw new Error("Sesion invalida detectada. Cayo en josso_security_check.");
    }
}

function registerDialogHandler(pageOrPopup) {
    pageOrPopup.on("dialog", async (dialog) => {
        const message = dialog.message() || "";
        logger.debug(`DIALOG: ${message}`);

        try {
            if (message.includes(SYSTEMA_EXPERTO_ERROR_TEXT)) {
                await dialog.accept();
                logger.debug("DIALOG aceptado: Systema Experto");
                return;
            }

            await dialog.dismiss();
            logger.debug("DIALOG descartado");
        } catch (error) {
            logger.warn(`No se pudo cerrar dialog: ${error.message}`);
        }
    });
}

async function getLowerBodyText(pageOrPopup, timeout = 2000) {
    try {
        return (await pageOrPopup.locator("body").innerText({ timeout })).toLowerCase();
    } catch {
        return "";
    }
}

async function detectActivePopupSession(page) {
    const body = await getLowerBodyText(page, 2500);
    return body.includes(ACTIVE_POPUP_SESSION_TEXT);
}

async function prepareFullQuoteScreenshot(popup) {
    await popup.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    await popup.evaluate(() => {
        const target = document.querySelector("#vehicleTotalAmount")
            || document.querySelector("#vehicleVersion")
            || document.querySelector("#vehiclePriceTax");

        if (target && typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ block: "center", inline: "nearest" });
        }

        const visited = new Set();
        let current = target instanceof Element ? target.parentElement : document.body;

        while (current) {
            if (!visited.has(current)) {
                visited.add(current);
                const computed = window.getComputedStyle(current);
                const overflowY = computed.overflowY;
                const overflow = computed.overflow;
                const isScrollable = ["auto", "scroll"].includes(overflowY)
                    || ["auto", "scroll"].includes(overflow)
                    || current.scrollHeight > current.clientHeight + 20;

                if (isScrollable) {
                    current.style.overflow = "visible";
                    current.style.overflowY = "visible";
                    current.style.height = "auto";
                    current.style.maxHeight = "none";
                }
            }

            current = current.parentElement;
        }

        document.documentElement.style.scrollBehavior = "auto";
        document.body.style.overflow = "visible";
        document.body.style.height = "auto";
        document.body.style.maxHeight = "none";
    });

    await popup.waitForTimeout(1200);
}

async function waitForValidQuoteScreen(popup, timeout = 45000) {
    const start = Date.now();
    let reloads = 0;
    const maxReloads = 3;
    const validationsPerCycle = 3;

    while (Date.now() - start < timeout) {
        let lastFailures = [];

        for (let attempt = 1; attempt <= validationsPerCycle; attempt += 1) {
            await popup.waitForTimeout(700);
            const failures = [];

            try {
                validateSession(popup);

                if (!popup.url().includes("cotizador")) {
                    failures.push("url");
                }

                const body = await getLowerBodyText(popup, 2000);
                if (!body) {
                    failures.push("body");
                }

                if (body.includes("cargando, por favor espere")) {
                    failures.push("overlay");
                }

                if (body.includes("cargando componentes visuales")) {
                    failures.push("componentes");
                }

                try {
                    const logo = popup.locator("#header-logo").first();
                    const count = await logo.count();
                    if (count === 0 || !(await logo.isVisible())) {
                        failures.push("logo");
                    }
                } catch {
                    failures.push("logo");
                }

                try {
                    const cotit = popup.locator('img[name="Cotit"]').first();
                    const count = await cotit.count();
                    if (count > 0 && (await cotit.isVisible())) {
                        failures.push("cotit");
                    }
                } catch {
                    // no-op
                }

                if (body.includes(READY_TEXT_RAZON_SOCIAL)) {
                    failures.push("razon_social");
                }

                try {
                    const field = popup.locator(TIPO_PERSONA_SELECTOR).first();
                    const value = await field.inputValue();

                    if (!(await field.isVisible())) {
                        failures.push("customer_hidden");
                    }

                    if (!(await field.isEnabled())) {
                        failures.push("customer_disabled");
                    }

                    if (value !== TIPO_PERSONA_READY_VALUE) {
                        failures.push(`customer_value=${value}`);
                    }
                } catch {
                    failures.push("customerType");
                }

                if (failures.length === 0) {
                    return;
                }

                lastFailures = [...failures];
                logger.debug(`Validacion ${attempt}/${validationsPerCycle} fallo`, { failures });
            } catch (error) {
                lastFailures = [`exception=${error.message}`];
                logger.debug(`Validacion ${attempt}/${validationsPerCycle} lanzo error: ${error.message}`);
            }
        }

        if (reloads < maxReloads) {
            reloads += 1;
            logger.warn(`Pantalla invalida. Reload ${reloads}/${maxReloads}`, { failures: lastFailures });
            await popup.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
            continue;
        }

        throw new Error(`Pantalla incorrecta tras varios reloads: ${JSON.stringify(lastFailures)}`);
    }

    throw new Error("Timeout esperando pantalla correcta.");
}

async function createBrowserSession() {
    assertCredentials();

    const browser = await BrowserManager.getBrowser();
    const activeContexts = getActiveContextCount();
    const videoEnabled = activeContexts <= 1;
    const contextOptions = {
        viewport: { width: 1366, height: 900 },
    };

    if (videoEnabled) {
        contextOptions.recordVideo = { dir: VIDEOS_DIR };
    }

    let context = null;

    try {
        context = await browser.newContext(contextOptions);
        const page = await context.newPage();

        return {
            context,
            page,
            videoEnabled,
        };
    } catch (error) {
        if (context) {
            await context.close().catch(() => {});
        }

        if (isBrowserClosedError(error)) {
            await BrowserManager.restart();
        }

        throw error;
    }
}

function buildTaskArtifactPath(taskId, suffix, extension) {
    if (!taskId) {
        return null;
    }

    const safeTaskId = String(taskId).replace(/[^a-f0-9-]/gi, "_");
    return path.join(VIDEOS_DIR, `${safeTaskId}_${suffix}.${extension}`);
}

function moveArtifact(sourcePath, targetPath) {
    if (!sourcePath || !targetPath || !fs.existsSync(sourcePath)) {
        return null;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    try {
        if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
        }

        fs.renameSync(sourcePath, targetPath);
        return targetPath;
    } catch {
        fs.copyFileSync(sourcePath, targetPath);
        return targetPath;
    }
}

async function closeQuoteSession(popup) {
    if (!popup || popup.isClosed()) {
        return;
    }

    try {
        const closeButton = popup.locator("#buttonClose").first();
        await closeButton.waitFor({ state: "visible", timeout: 5000 });
        await closeButton.click({ timeout: 5000 });

        const confirmModal = popup.locator(".messager-body", {
            hasText: "Está seguro que desea salir de la cotización",
        }).last();

        await confirmModal.waitFor({ state: "visible", timeout: 7000 });
        await confirmModal.locator("a.l-btn", { hasText: /^Ok$/ }).last().click({ timeout: 5000 });
        await popup.waitForTimeout(1000);
        logger.debug("Sesion de cotizacion cerrada desde buttonClose.");
    } catch (error) {
        logger.warn(`No se pudo cerrar sesion desde buttonClose: ${error.message}`);
    }
}

async function performLogin(page) {
    logger.debug("Abriendo login...");
    await page.goto(LOGIN_URL, { timeout: 30000 });
    validateSession(page);

    logger.debug("Ingresando usuario...");
    await page.fill('input[name="userName"]', USUARIO);

    logger.debug("Click primer ingresar...");
    await page.locator("#btnEntrar").click();
    validateSession(page);

    logger.debug("Ingresando password...");
    await page.fill('input[name="userPassword"]', PASSWORD);

    logger.debug("Click segundo ingresar y esperando popup...");
    const popup = await waitForQuotePopupAfterPassword(page);

    await popup.waitForLoadState("domcontentloaded", { timeout: 30000 });
    await waitForValidQuoteScreen(popup, 40000);
    validateSession(popup);

    if (!popup.url().includes("cotizador")) {
        throw new Error(`No llego al cotizador. URL actual: ${popup.url()}`);
    }

    return popup;
}

async function waitForQuotePopupAfterPassword(page) {
    const context = page.context();
    const pagesBeforeClick = new Set(context.pages());
    const popupPromise = page.waitForEvent("popup", { timeout: POPUP_TIMEOUT_MS }).catch(() => null);
    const pagePromise = context.waitForEvent("page", { timeout: POPUP_TIMEOUT_MS }).catch(() => null);

    await page.locator("#btnEntrar").click();
    logger.debug(`Esperando ${SESSION_LOAD_WAIT_MS}ms a que cargue la sesion...`);
    await page.waitForTimeout(SESSION_LOAD_WAIT_MS);

    const popup = await Promise.race([
        popupPromise,
        pagePromise,
        waitForActivePopupMessage(page),
    ]);

    if (popup) {
        return popup;
    }

    const quotePage = findAvailableQuotePage(context, page, pagesBeforeClick);

    if (quotePage) {
        return quotePage;
    }

    if (await detectActivePopupSession(page)) {
        return reopenQuotePopup(page, pagesBeforeClick);
    }

    logger.warn(`No se abrio popup de cotizador en ${POPUP_TIMEOUT_MS}ms. Intentando abrirlo sin marcar error.`);

    const openedPopup = await openQuotePopupIfAvailable(page, pagesBeforeClick);

    if (openedPopup) {
        return openedPopup;
    }

    throw new Error("No se encontro una pagina de cotizador abierta despues de intentar abrir el popup.");
}

async function waitForActivePopupMessage(page) {
    const deadline = Date.now() + POPUP_TIMEOUT_MS;

    while (Date.now() < deadline) {
        if (await detectActivePopupSession(page)) {
            return null;
        }

        await page.waitForTimeout(500);
    }

    return null;
}

async function reopenQuotePopup(page, pagesBeforeClick) {
    const context = page.context();

    logger.warn("Sesion activa en ventana emergente. Reabriendo popup con btnReopen.");

    try {
        await page.locator(REOPEN_POPUP_SELECTOR).waitFor({ state: "visible", timeout: 5000 });
    } catch {
        throw createNonRetryableError(
            "Sesion activa en ventana emergente detectada, pero no se encontro el boton btnReopen."
        );
    }

    const popupPromise = page.waitForEvent("popup", { timeout: POPUP_TIMEOUT_MS }).catch(() => null);
    const pagePromise = context.waitForEvent("page", { timeout: POPUP_TIMEOUT_MS }).catch(() => null);

    await page.locator(REOPEN_POPUP_SELECTOR).click({ timeout: 5000 });

    const popup = await Promise.race([
        popupPromise,
        pagePromise,
    ]);

    if (popup) {
        return popup;
    }

    const existingPopup = findAvailableQuotePage(context, page, pagesBeforeClick);

    if (existingPopup) {
        return existingPopup;
    }

    throw createNonRetryableError(
        "Sesion activa en ventana emergente detectada, pero btnReopen no abrio el cotizador."
    );
}

function findAvailableQuotePage(context, page, pagesBeforeClick) {
    const pages = context.pages();
    const newPopup = pages.find((candidate) => (
        candidate !== page
        && (!pagesBeforeClick || !pagesBeforeClick.has(candidate))
        && !candidate.isClosed()
    ));

    if (newPopup) {
        return newPopup;
    }

    const quotePopup = pages.find((candidate) => (
        candidate !== page
        && !candidate.isClosed()
        && candidate.url().includes("cotizador")
    ));

    if (quotePopup) {
        return quotePopup;
    }

    if (!page.isClosed() && page.url().includes("cotizador")) {
        return page;
    }

    return null;
}

async function openQuotePopupIfAvailable(page, pagesBeforeClick) {
    const context = page.context();
    const reopenButton = page.locator(REOPEN_POPUP_SELECTOR).first();
    const canReopen = await reopenButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (canReopen) {
        logger.warn("Boton btnReopen disponible. Abriendo popup de cotizador.");

        const popupPromise = page.waitForEvent("popup", { timeout: POPUP_TIMEOUT_MS }).catch(() => null);
        const pagePromise = context.waitForEvent("page", { timeout: POPUP_TIMEOUT_MS }).catch(() => null);

        await reopenButton.click({ timeout: 5000 });

        const popup = await Promise.race([
            popupPromise,
            pagePromise,
        ]);

        return popup || findAvailableQuotePage(context, page, pagesBeforeClick);
    }

    const enterButton = page.locator("#btnEntrar").first();
    const canRetryEnter = await enterButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (canRetryEnter) {
        logger.warn("Boton de ingreso disponible. Reintentando abrir popup de cotizador.");

        const popupPromise = page.waitForEvent("popup", { timeout: POPUP_TIMEOUT_MS }).catch(() => null);
        const pagePromise = context.waitForEvent("page", { timeout: POPUP_TIMEOUT_MS }).catch(() => null);

        await enterButton.click({ timeout: 5000 });

        const popup = await Promise.race([
            popupPromise,
            pagePromise,
            waitForActivePopupMessage(page),
        ]);

        if (popup) {
            return popup;
        }

        if (await detectActivePopupSession(page)) {
            return reopenQuotePopup(page, pagesBeforeClick);
        }

        return findAvailableQuotePage(context, page, pagesBeforeClick);
    }

    if (page.url().includes("cotizador")) {
        return page;
    }

    return null;
}

function elapsedSecondsSince(startTime) {
    return Number(((performance.now() - startTime) / 1000).toFixed(2));
}

function normalizeRequestedDataFlows(payload) {
    const requestedFlows = payload?.flujos || payload?.flows;
    const nivelDetalle = payload?.NIVEL_DETALLE || payload?.nivelDetalle || payload?.nivel_detalle;

    if (Array.isArray(requestedFlows) && requestedFlows.length > 0) {
        return requestedFlows.map((flow) => String(flow).trim().toLowerCase()).filter(Boolean);
    }

    if (nivelDetalle) {
        return [String(nivelDetalle).trim().toLowerCase()];
    }

    const presentFlows = Object.keys(DATA_FLOWS).filter((flow) => payload?.[flow] !== undefined);
    return presentFlows.length > 0 ? presentFlows : ["cliente"];
}

async function runRequestedDataFlows(page, payload) {
    const flows = normalizeRequestedDataFlows(payload);
    const timings = [];

    for (const flow of flows) {
        const fillFlow = DATA_FLOWS[flow];

        if (!fillFlow) {
            throw new Error(`Flujo no soportado: ${flow}`);
        }

        if (payload?.[flow] === undefined) {
            throw new Error(`No viene el objeto ${flow} en el JSON`);
        }

        logger.debug(`Ejecutando flujo de datos: ${flow}`);
        const flowStartTime = performance.now();
        await fillFlow(page, payload);
        timings.push({
            name: flow,
            elapsedSeconds: elapsedSecondsSince(flowStartTime),
        });
    }

    return { flows, timings };
}

async function runCetelemFlow(payload, options = {}) {
    const taskId = options.taskId || null;
    const timestamp = createTimestamp();
    const screenshotPath = path.join(SCREENSHOTS_DIR, `playwright_popup_${timestamp}.png`);
    const errorScreenshotPath = path.join(SCREENSHOTS_DIR, `playwright_error_${timestamp}.png`);
    const consolePath = path.join(LOGS_DIR, `playwright_console_${timestamp}.txt`);
    const consoleLogs = [];
    const startTime = performance.now();

    logTask(taskId, "queued", {}, { level: "debug" });

    return enqueueContextTask(() => runCetelemFlowInContext({
        payload,
        taskId,
        screenshotPath,
        errorScreenshotPath,
        consolePath,
        consoleLogs,
        startTime,
    }));
}

async function runCetelemFlowInContext({
    payload,
    taskId,
    screenshotPath,
    errorScreenshotPath,
    consolePath,
    consoleLogs,
    startTime,
}) {
    let context = null;
    let page = null;
    let videoEnabled = false;

    let popup = null;

    const onConsole = (message) => {
        const text = message.text();
        consoleLogs.push(text);
        logger.debug(`BROWSER_CONSOLE: ${text}`);
    };

    try {
        const session = await createBrowserSession();
        context = session.context;
        page = session.page;
        videoEnabled = session.videoEnabled;

        page.on("console", onConsole);
        registerDialogHandler(page);

        logTask(taskId, "started", {
            elapsedSeconds: elapsedSecondsSince(startTime),
            videoEnabled,
        });
        logger.debug(`Carpeta de videos: ${VIDEOS_DIR}`);
        const loginStartTime = performance.now();
        popup = await performLogin(page);
        const loginElapsedSeconds = elapsedSecondsSince(loginStartTime);
        popup.on("console", onConsole);
        registerDialogHandler(popup);

        const { flows: executedFlows, timings: flowTimings } = await runRequestedDataFlows(popup, payload);
        const stageTimings = [
            {
                name: "login",
                elapsedSeconds: loginElapsedSeconds,
            },
            ...flowTimings,
        ];
        let insuranceMonthlyFee = null;
        let insuranceOptions = [];
        let vehiclePriceTax = null;
        let vehicleTotalAmount = null;

        if (executedFlows.includes("vehiculo")) {
            try {
                vehiclePriceTax = await readVehiclePriceTax(popup);
            } catch (error) {
                logger.warn(`No se pudo leer vehiclePriceTax: ${error.message}`);
            }

            try {
                vehicleTotalAmount = await readVehicleTotalAmount(popup);
            } catch (error) {
                logger.warn(`No se pudo leer vehicleTotalAmount: ${error.message}`);
            }
        }

        if (executedFlows.includes("seguro")) {
            try {
                insuranceOptions = await readInsuranceOptions(popup);
            } catch (error) {
                logger.warn(`No se pudieron leer opciones de seguro: ${error.message}`);
            }

            try {
                insuranceMonthlyFee = await readInsuranceMonthlyFee(popup);
            } catch (error) {
                logger.warn(`No se pudo leer insuranceMonthlyFee: ${error.message}`);
            }
        }

        await prepareFullQuoteScreenshot(popup);

        const screenshotBuffer = await popup.screenshot({
            path: screenshotPath,
            type: "png",
            fullPage: true,
        });
        fs.writeFileSync(consolePath, consoleLogs.join("\n"), "utf8");

        return {
            consolePath,
            elapsedSeconds: Number(((performance.now() - startTime) / 1000).toFixed(2)),
            screenshotBuffer,
            screenshotPath,
            executedFlows,
            stageTimings,
            insuranceMonthlyFee,
            insuranceOptions,
            vehiclePriceTax,
            vehicleTotalAmount,
        };
    } catch (error) {
        if (isBrowserClosedError(error)) {
            await BrowserManager.restart();
        }

        error.elapsedSeconds = elapsedSecondsSince(startTime);
        error.consolePath = consolePath;

        try {
            const target = popup || page;
            if (!target) {
                throw new Error("No hay page disponible para screenshot de error");
            }
            if (popup) {
                await prepareFullQuoteScreenshot(popup).catch(() => {});
            }
            await target.screenshot({
                path: errorScreenshotPath,
                type: "png",
                fullPage: true,
            });
            error.screenshotPath = errorScreenshotPath;
            error.errorScreenshotPath = errorScreenshotPath;
            logger.warn(`Screenshot error: ${errorScreenshotPath}`);
        } catch {
            // no-op
        }

        try {
            fs.writeFileSync(consolePath, consoleLogs.join("\n"), "utf8");
            error.consolePath = consolePath;
            logger.debug(`Console log: ${consolePath}`);
        } catch {
            // no-op
        }

        throw error;
    } finally {
        logTask(taskId, "stopping", {
            elapsedSeconds: elapsedSecondsSince(startTime),
        }, { level: "debug" });

        let pageVideo = null;
        let popupVideo = null;

        try {
            pageVideo = videoEnabled && page ? await page.video()?.path() : null;
        } catch {
            // no-op
        }

        try {
            popupVideo = videoEnabled && popup ? await popup.video()?.path() : null;
        } catch {
            // no-op
        }

        try {
            if (popup) {
                await closeQuoteSession(popup);
                await popup.close();
            }
        } catch {
            // no-op
        }

        try {
            if (page) {
                await page.close();
            }
        } catch {
            // no-op
        }

        try {
            if (context) {
                await context.close();
            }
        } catch (error) {
            logger.warn(`[task:${taskId || "cli"}] No se pudo cerrar context: ${error.message}`);
        }

        const taskPageVideo = moveArtifact(pageVideo, buildTaskArtifactPath(taskId, "page", "webm"));
        const taskPopupVideo = moveArtifact(popupVideo, buildTaskArtifactPath(taskId, "popup", "webm"));

        logger.debug(`Video page: ${taskPageVideo || pageVideo || "N/A"}`);
        logger.debug(`Video popup: ${taskPopupVideo || popupVideo || "N/A"}`);
        logTask(taskId, "stopped", {
            elapsedSeconds: elapsedSecondsSince(startTime),
        }, { level: "debug" });
    }
}

async function runCetelemFlowWithRetries(payload, options = {}) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_REINTENTOS; attempt += 1) {
        try {
            logger.debug(`[task ${shortTaskId(options.taskId)}] attempt ${attempt}/${MAX_REINTENTOS}`);
            return await runCetelemFlow(payload, options);
        } catch (error) {
            lastError = error;
            logger.warn(`[task ${shortTaskId(options.taskId)}] attempt=${attempt}/${MAX_REINTENTOS} error="${error.message}"`);

            if (error.retryable === false) {
                break;
            }

            if (attempt < MAX_REINTENTOS) {
                logger.debug(`[task ${shortTaskId(options.taskId)}] retrying`);
            }
        }
    }

    throw lastError;
}

module.exports = {
    normalizeRequestedDataFlows,
    runCetelemFlow,
    runCetelemFlowWithRetries,
    runRequestedDataFlows,
};
