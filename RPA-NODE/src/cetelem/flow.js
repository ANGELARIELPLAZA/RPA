const fs = require("fs");
const path = require("path");
const BrowserManager = require("../core/browser-manager");
const { enqueueContextTask, getActiveContextCount } = require("../core/context-queue");
const logger = require("../core/logger");
const { logTask, shortTaskId } = require("../core/task-logger");
const {
    BAD_URL_TOKEN,
    isRecordVideoEnabled,
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
const pageNavigationLocks = new WeakMap();
const STEP_LOG_WARN_EVERY_MS = 8000;
const STEP_TIMEOUT_DEFAULT_MS = 45000;
const VALIDATION_LOCATOR_TIMEOUT_MS = 2500;

const DATA_FLOWS = {
    cliente: fillClientData,
    vehiculo: fillVehicleData,
    credito: fillCreditData,
    seguro: fillInsuranceData,
};

function isBrowserClosedError(error) {
    return /browser.*closed|browser.*disconnected|target.*closed|context.*closed|has been closed/i.test(error.message || "");
}

function isNavigationAbortError(error) {
    return /net::ERR_ABORTED|frame detached|navigation.*interrupted|execution context.*destroyed|target.*closed|page.*closed|context.*closed|has been closed/i.test(error.message || "");
}

function createNonRetryableError(message) {
    const error = new Error(message);
    error.retryable = false;
    return error;
}

function createTimestamp() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
}

function maybeFixMojibake(text) {
    if (typeof text !== "string" || text.length === 0) {
        return text || "";
    }

    if (!/[ÃÂ]/.test(text)) {
        return text;
    }

    try {
        return Buffer.from(text, "latin1").toString("utf8");
    } catch {
        return text;
    }
}

function normalizeForMatch(text) {
    const value = maybeFixMojibake(String(text || ""))
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");

    return value.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function createTimeoutError(label, ms) {
    const error = new Error(`Timeout en paso "${label}" tras ${ms}ms.`);
    error.retryable = true;
    return error;
}

async function runStep(label, pageOrPopup, action, {
    timeoutMs = STEP_TIMEOUT_DEFAULT_MS,
    warnEveryMs = STEP_LOG_WARN_EVERY_MS,
    level = "info",
    meta = {},
} = {}) {
    const start = performance.now();
    const prefix = `[step:${label}]`;
    const log = logger[level] || logger.info;

    log(`${prefix} start`, {
        url: getPageUrl(pageOrPopup) || "N/A",
        closed: Boolean(pageOrPopup?.isClosed?.()),
        ...meta,
    });

    let warned = 0;
    const warnTimer = warnEveryMs > 0
        ? setInterval(() => {
            warned += 1;
            logger.warn(`${prefix} still waiting`, {
                warned,
                elapsedSeconds: elapsedSecondsSince(start),
                url: getPageUrl(pageOrPopup) || "N/A",
            });
        }, warnEveryMs)
        : null;

    try {
        const result = await Promise.race([
            Promise.resolve().then(action),
            new Promise((_, reject) => setTimeout(() => reject(createTimeoutError(label, timeoutMs)), timeoutMs)),
        ]);

        log(`${prefix} end`, {
            elapsedSeconds: elapsedSecondsSince(start),
            url: getPageUrl(pageOrPopup) || "N/A",
        });

        return result;
    } finally {
        if (warnTimer) {
            clearInterval(warnTimer);
        }
    }
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

async function runExclusivePageNavigation(page, label, action) {
    if (!page || page.isClosed()) {
        throw new Error(`No se puede navegar ${label}: page cerrada.`);
    }

    const previous = pageNavigationLocks.get(page) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
        logger.debug(`[nav:${label}] inicio url=${getPageUrl(page) || "N/A"}`);
        const result = await action();
        logger.debug(`[nav:${label}] fin url=${getPageUrl(page) || "N/A"}`);
        return result;
    });

    const tracked = current.finally(() => {
        if (pageNavigationLocks.get(page) === tracked) {
            pageNavigationLocks.delete(page);
        }
    });

    pageNavigationLocks.set(page, tracked);

    return current;
}

async function gotoAndSettle(page, url, label, timeout = 30000) {
    return runExclusivePageNavigation(page, label, async () => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        await waitForPageSettled(page, timeout).catch((error) => {
            logger.warn(`[nav:${label}] pagina no quedo en networkidle: ${error.message}`);
        });
        return page;
    });
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
        return maybeFixMojibake(await pageOrPopup.locator("body").innerText({ timeout })).toLowerCase();
    } catch {
        return "";
    }
}

async function getNormalizedBodyText(pageOrPopup, timeout = 2000) {
    try {
        return normalizeForMatch(await pageOrPopup.locator("body").innerText({ timeout }));
    } catch {
        return "";
    }
}

async function detectBlockingOverlay(pageOrPopup) {
    if (!pageOrPopup || pageOrPopup.isClosed?.()) {
        return { blocking: false, hits: [] };
    }

    const candidates = [
        ".window-mask",
        ".datagrid-mask",
        ".datagrid-mask-msg",
        ".panel-mask",
        ".panel-loading",
        ".loading-mask",
        ".loading-overlay",
        "[class*=\"mask\"]",
        "[id*=\"mask\"]",
        "[class*=\"loading\"]",
        "[id*=\"loading\"]",
        "[aria-busy=\"true\"]",
    ];

    try {
        return await pageOrPopup.evaluate((selectors) => {
            const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
            const hits = [];

            const isVisible = (el) => {
                if (!(el instanceof Element)) return false;
                const style = window.getComputedStyle(el);
                if (style.display === "none" || style.visibility === "hidden") return false;
                if (Number(style.opacity || "1") < 0.05) return false;
                const rect = el.getBoundingClientRect();
                if (rect.width < 10 || rect.height < 10) return false;
                if (rect.bottom <= 0 || rect.right <= 0) return false;
                if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
                return true;
            };

            const isBlocking = (el) => {
                const style = window.getComputedStyle(el);
                if (style.pointerEvents === "none") return false;
                const rect = el.getBoundingClientRect();
                const area = Math.max(0, rect.width) * Math.max(0, rect.height);
                const coversViewport = area / viewportArea >= 0.35;
                if (!coversViewport) return false;

                const x = Math.floor(window.innerWidth / 2);
                const y = Math.floor(window.innerHeight / 2);
                const top = document.elementFromPoint(x, y);
                return top === el || (top instanceof Node && el.contains(top));
            };

            for (const selector of selectors) {
                const elements = Array.from(document.querySelectorAll(selector));
                for (const el of elements) {
                    if (!isVisible(el)) continue;
                    const blocking = isBlocking(el);
                    if (!blocking) continue;

                    const rect = el.getBoundingClientRect();
                    hits.push({
                        selector,
                        tag: el.tagName,
                        id: el.id || null,
                        className: typeof el.className === "string" ? el.className : null,
                        rect: {
                            x: Math.round(rect.x),
                            y: Math.round(rect.y),
                            width: Math.round(rect.width),
                            height: Math.round(rect.height),
                        },
                    });

                    if (hits.length >= 5) {
                        return { blocking: true, hits };
                    }
                }
            }

            return { blocking: hits.length > 0, hits };
        }, candidates);
    } catch {
        return { blocking: false, hits: [] };
    }
}

function classifySessionUrl(url) {
    if (!url) {
        return "sin_url";
    }

    if (isDeadSession(url)) {
        return "dead_josso";
    }

    if (url.includes("cotizador")) {
        return "cotizador";
    }

    if (url.includes("/login") || url.includes("cck/login") || url.includes("auth/kia/login")) {
        return "login";
    }

    return "desconocido";
}

async function logSessionState(pageOrPopup, label, cause = "") {
    const url = getPageUrl(pageOrPopup);
    const body = pageOrPopup && !pageOrPopup.isClosed?.()
        ? await getNormalizedBodyText(pageOrPopup, 1000)
        : "";
    const state = body.includes(normalizeForMatch(ACTIVE_POPUP_SESSION_TEXT))
        ? "sessionActive_popup"
        : classifySessionUrl(url);

    logger.warn(`[session:${label}] state=${state} url=${url || "N/A"} cause=${cause || "N/A"}`);
    return { state, url };
}

async function detectActivePopupSession(page) {
    const body = await getNormalizedBodyText(page, 2500);
    return body.includes(normalizeForMatch(ACTIVE_POPUP_SESSION_TEXT));
}

function getPageUrl(page) {
    try {
        return page && !page.isClosed() ? page.url() : "";
    } catch {
        return "";
    }
}

async function waitForPageSettled(page, timeout = 30000) {
    if (!page || page.isClosed()) {
        throw new Error("Page cerrada antes de esperar carga.");
    }

    await page.waitForLoadState("domcontentloaded", { timeout });
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 10000) }).catch(() => {});
}

async function recreatePageFrom(page, fallbackUrl, reason) {
    const context = page?.context?.();
    const targetUrl = getPageUrl(page) || fallbackUrl;

    if (!context) {
        throw new Error(`No se pudo recrear page: context no disponible. Motivo: ${reason}`);
    }

    logger.warn(`Recreando page despues de fallo de navegacion: ${reason}. targetUrl=${targetUrl || "N/A"}`);

    if (page && !page.isClosed()) {
        await page.close().catch(() => {});
    }

    try {
        const nextPage = await context.newPage();

        if (targetUrl) {
            await gotoAndSettle(nextPage, targetUrl, "recreate-page", 30000);
        }

        return nextPage;
    } catch (error) {
        if (isBrowserClosedError(error) || isNavigationAbortError(error)) {
            await BrowserManager.restart();
            const browser = await BrowserManager.getBrowser();
            const nextContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
            const nextPage = await nextContext.newPage();

            if (targetUrl) {
                await gotoAndSettle(nextPage, targetUrl, "recreate-page-browser-restart", 30000);
            }

            return nextPage;
        }

        throw error;
    }
}

async function resilientRefreshPage(page, {
    label = "page",
    fallbackUrl = "",
    attempts = 2,
    waitAfterMs = 800,
} = {}) {
    let currentPage = page;
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (!currentPage || currentPage.isClosed()) {
            return recreatePageFrom(currentPage || page, fallbackUrl, `${label} cerrada antes de refresh`);
        }

        try {
            await currentPage.waitForTimeout(waitAfterMs).catch(() => {});
            await currentPage.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});

            const currentUrl = getPageUrl(currentPage) || fallbackUrl;
            if (!currentUrl) {
                throw new Error(`No hay URL disponible para refrescar ${label}.`);
            }

            logger.debug(`Refrescando ${label} con navegacion resiliente. Intento ${attempt}/${attempts}.`);
            await gotoAndSettle(currentPage, currentUrl, `refresh-${label}`, 30000);
            return currentPage;
        } catch (error) {
            lastError = error;
            logger.warn(`Refresh resiliente fallo en ${label} intento ${attempt}/${attempts}: ${error.message}`);

            if (!isNavigationAbortError(error) && !isBrowserClosedError(error) && attempt < attempts) {
                await currentPage.waitForTimeout(1000).catch(() => {});
                continue;
            }

            if (attempt < attempts) {
                await currentPage.waitForTimeout(1000).catch(() => {});
            }
        }
    }

    return recreatePageFrom(currentPage || page, fallbackUrl, lastError?.message || `${label} no pudo refrescarse`);
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
    let refreshes = 0;
    const maxRefreshes = 3;
    const validationsPerCycle = 3;
    let currentPopup = popup;

    while (Date.now() - start < timeout) {
        let lastFailures = [];

        for (let attempt = 1; attempt <= validationsPerCycle; attempt += 1) {
            const failures = [];

            try {
                if (!currentPopup || currentPopup.isClosed()) {
                    throw new Error("Popup cerrado durante validacion.");
                }

                await currentPopup.waitForTimeout(700);
                validateSession(currentPopup);

                if (!currentPopup.url().includes("cotizador")) {
                    failures.push("url");
                }

                const body = await getLowerBodyText(currentPopup, 2000);
                if (!body) {
                    failures.push("body");
                }

                const overlay = await detectBlockingOverlay(currentPopup);
                if (overlay.blocking) {
                    failures.push("overlay_blocking");
                }

                try {
                    const logo = currentPopup.locator("#header-logo").first();
                    const count = await logo.count();
                    if (count > 0 && !(await logo.isVisible({ timeout: VALIDATION_LOCATOR_TIMEOUT_MS }))) {
                        failures.push("logo");
                    }
                } catch {
                    // best-effort: no bloquear por cambios en el header del portal
                }

                // "Cotit" puede aparecer como overlay/transitorio; no se considera criterio de fallo

                if (body.includes(READY_TEXT_RAZON_SOCIAL)) {
                    failures.push("razon_social");
                }

                try {
                    await currentPopup.waitForFunction(
                        ({ selector, expectedValue }) => {
                            const element = document.querySelector(selector);
                            if (!element || element.tagName !== "SELECT" || element.disabled) {
                                return false;
                            }

                            const options = Array.from(element.options || []);
                            if (options.length === 0) {
                                return false;
                            }

                            const current = String(element.value || "").trim();
                            return current === String(expectedValue).trim();
                        },
                        { selector: TIPO_PERSONA_SELECTOR, expectedValue: TIPO_PERSONA_READY_VALUE },
                        { timeout: VALIDATION_LOCATOR_TIMEOUT_MS }
                    );
                } catch {
                    failures.push("customerType");
                }

                if (failures.length === 0) {
                    logger.info("[popup] valid quote screen", {
                        elapsedSeconds: Number(((Date.now() - start) / 1000).toFixed(2)),
                        url: getPageUrl(currentPopup) || "N/A",
                    });
                    return currentPopup;
                }

                lastFailures = [...failures];
                logger.debug(`Validacion ${attempt}/${validationsPerCycle} fallo`, { failures });
            } catch (error) {
                lastFailures = [`exception=${error.message}`];
                logger.debug(`Validacion ${attempt}/${validationsPerCycle} lanzo error: ${error.message}`);
            }
        }

        if (refreshes < maxRefreshes) {
            refreshes += 1;
            logger.warn(`Pantalla invalida. Refresh resiliente ${refreshes}/${maxRefreshes}`, { failures: lastFailures });
            currentPopup = await resilientRefreshPage(currentPopup, {
                label: "popup cotizador",
                fallbackUrl: LOGIN_URL,
            });
            continue;
        }

        throw new Error(`Pantalla incorrecta tras varios refreshes: ${JSON.stringify(lastFailures)}`);
    }

    throw new Error("Timeout esperando pantalla correcta.");
}

async function createBrowserSession() {
    assertCredentials();

    const browser = await BrowserManager.getBrowser();
    const activeContexts = getActiveContextCount();
    const videoEnabled = isRecordVideoEnabled() && activeContexts <= 1;
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
            hasText: /seguro.*salir.*cotizaci/i,
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
    let loginPage = page;

    logger.debug("Abriendo login...");
    await gotoAndSettle(loginPage, LOGIN_URL, "login-open", 30000);
    await logSessionState(loginPage, "login-open", "login inicial cargado");
    validateSession(loginPage);

    logger.debug("Ingresando usuario...");
    await loginPage.waitForSelector('input[name="userName"]', { state: "visible", timeout: 20000 });
    await loginPage.fill('input[name="userName"]', USUARIO);

    logger.debug("Click primer ingresar...");
    await loginPage.locator("#btnEntrar").click();
    await loginPage.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await logSessionState(loginPage, "login-user", "usuario enviado");
    validateSession(loginPage);

    logger.debug("Ingresando password...");
    await loginPage.waitForSelector('input[name="userPassword"]', { state: "visible", timeout: 20000 });
    await loginPage.fill('input[name="userPassword"]', PASSWORD);

    logger.debug("Click segundo ingresar y esperando popup...");
    let popup = await waitForQuotePopupAfterPassword(loginPage);
    logger.info("[popup] detected", {
        url: getPageUrl(popup) || "N/A",
        isSameAsLoginPage: popup === loginPage,
        closed: Boolean(popup?.isClosed?.()),
    });

    registerDialogHandler(popup);

    await runStep("popup-domcontentloaded", popup, async () => {
        await popup.waitForLoadState("domcontentloaded", { timeout: 30000 });
        await popup.waitForTimeout(250);
    }, { timeoutMs: 35000, meta: { phase: "post-quote-popup" } });

    popup = await runStep("popup-validate-quote-screen", popup, async () => waitForValidQuoteScreen(popup, 40000), {
        timeoutMs: 50000,
        meta: { phase: "post-quote-popup" },
    });

    await runStep("popup-validate-session", popup, async () => validateSession(popup), {
        timeoutMs: 5000,
        meta: { phase: "post-quote-popup" },
    });

    if (!popup.url().includes("cotizador")) {
        throw new Error(`No llego al cotizador. URL actual: ${popup.url()}`);
    }

    return popup;
}

async function waitForQuotePopupAfterPassword(page) {
    let context = page.context();
    const pagesBeforeClick = new Set(context.pages());
    const popupPromise = page.waitForEvent("popup", { timeout: POPUP_TIMEOUT_MS }).catch(() => null);
    const pagePromise = context.waitForEvent("page", { timeout: POPUP_TIMEOUT_MS }).catch(() => null);

    await page.locator("#btnEntrar").click();
    await logSessionState(page, "login-password-click", "password enviado");
    logger.debug(`Esperando ${SESSION_LOAD_WAIT_MS}ms a que cargue la sesion...`);
    await page.waitForLoadState("domcontentloaded", { timeout: SESSION_LOAD_WAIT_MS }).catch(() => {});
    await page.waitForTimeout(1000);
    const loginPage = page;
    context = loginPage.context();

    const popup = await Promise.race([
        popupPromise,
        pagePromise,
        waitForActivePopupMessage(loginPage),
    ]);

    if (popup) {
        await logSessionState(popup, "quote-popup", "popup detectado despues de password");
        return popup;
    }

    const quotePage = findAvailableQuotePage(context, loginPage, pagesBeforeClick);

    if (quotePage) {
        await logSessionState(quotePage, "quote-page", "pagina cotizador ya disponible");
        return quotePage;
    }

    if (await detectActivePopupSession(loginPage)) {
        await logSessionState(loginPage, "session-active", "portal reporta sesion activa en popup");
        return reopenQuotePopup(loginPage, pagesBeforeClick);
    }

    logger.warn(`No se abrio popup de cotizador en ${POPUP_TIMEOUT_MS}ms. Intentando abrirlo sin marcar error.`);

    const openedPopup = await openQuotePopupIfAvailable(loginPage, pagesBeforeClick);

    if (openedPopup) {
        await logSessionState(openedPopup, "quote-opened", "popup abierto por recovery local");
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
    await logSessionState(page, "reopen-popup", "sessionActive requiere btnReopen");

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
        await logSessionState(popup, "reopen-popup-ok", "btnReopen abrio popup");
        return popup;
    }

    const existingPopup = findAvailableQuotePage(context, page, pagesBeforeClick);

    if (existingPopup) {
        await logSessionState(existingPopup, "reopen-existing-popup", "btnReopen no emitio popup pero existe cotizador");
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
        await logSessionState(page, "open-quote-reopen", "btnReopen visible");

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
        await logSessionState(page, "open-quote-enter", "btnEntrar visible despues de login");

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

        const flowStartTime = performance.now();
        await runStep(`flow-${flow}`, page, async () => {
            await fillFlow(page, payload);
        }, {
            timeoutMs: 120000,
            meta: { flow },
        });
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
        context = popup.context();
        const loginElapsedSeconds = elapsedSecondsSince(loginStartTime);
        popup.on("console", onConsole);
        registerDialogHandler(popup);

        const { flows: executedFlows, timings: flowTimings } = await runStep("run-data-flows", popup, async () => (
            runRequestedDataFlows(popup, payload)
        ), {
            timeoutMs: 180000,
            meta: { flowsRequested: normalizeRequestedDataFlows(payload) },
        });
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
                vehiclePriceTax = await runStep("read-vehiclePriceTax", popup, async () => readVehiclePriceTax(popup), {
                    timeoutMs: 30000,
                });
            } catch (error) {
                logger.warn(`No se pudo leer vehiclePriceTax: ${error.message}`);
            }

            try {
                vehicleTotalAmount = await runStep("read-vehicleTotalAmount", popup, async () => readVehicleTotalAmount(popup), {
                    timeoutMs: 30000,
                });
            } catch (error) {
                logger.warn(`No se pudo leer vehicleTotalAmount: ${error.message}`);
            }
        }

        if (executedFlows.includes("seguro")) {
            try {
                insuranceOptions = await runStep("read-insuranceOptions", popup, async () => readInsuranceOptions(popup), {
                    timeoutMs: 30000,
                });
            } catch (error) {
                logger.warn(`No se pudieron leer opciones de seguro: ${error.message}`);
            }

            try {
                insuranceMonthlyFee = await runStep("read-insuranceMonthlyFee", popup, async () => readInsuranceMonthlyFee(popup), {
                    timeoutMs: 30000,
                });
            } catch (error) {
                logger.warn(`No se pudo leer insuranceMonthlyFee: ${error.message}`);
            }
        }

        await runStep("prepare-screenshot", popup, async () => prepareFullQuoteScreenshot(popup), {
            timeoutMs: 45000,
        });

        const screenshotBuffer = await runStep("take-screenshot", popup, async () => (
            popup.screenshot({
                path: screenshotPath,
                type: "png",
                fullPage: true,
            })
        ), {
            timeoutMs: 60000,
            meta: { screenshotPath },
        });

        await runStep("write-console-log", popup, async () => {
            fs.writeFileSync(consolePath, consoleLogs.join("\n"), "utf8");
        }, {
            timeoutMs: 5000,
            meta: { consolePath, consoleLines: consoleLogs.length },
        });

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
        const target = popup || page;
        await logSessionState(target, "task-failed", error.message).catch(() => {});

        if (isBrowserClosedError(error)) {
            await BrowserManager.restart();
        }

        error.elapsedSeconds = elapsedSecondsSince(startTime);
        error.consolePath = consolePath;

        try {
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
                logger.debug("Cerrando popup sin buttonClose; recovery usa cierre de page/context.");
                await popup.close();
            }
        } catch {
            // no-op
        }

        try {
            if (page) {
                logger.debug("Cerrando login page sin logout UI.");
                await page.close();
            }
        } catch {
            // no-op
        }

        try {
            if (context) {
                logger.debug(`[task:${taskId || "cli"}] Cerrando contexto Playwright completo.`);
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
            logger.debug(`[task ${shortTaskId(options.taskId)}] attempt ${attempt}/${MAX_REINTENTOS} recovery=clean_context_per_attempt`);
            return await runCetelemFlow(payload, options);
        } catch (error) {
            lastError = error;
            const retryable = error.retryable !== false;
            logger.warn(`[task ${shortTaskId(options.taskId)}] recovery cause="${error.message}" attempt=${attempt}/${MAX_REINTENTOS} retryable=${retryable} action=context_closed_and_recreated_on_next_attempt`);

            if (error.retryable === false) {
                break;
            }

            if (attempt < MAX_REINTENTOS) {
                logger.debug(`[task ${shortTaskId(options.taskId)}] reintentando con browser context limpio`);
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
