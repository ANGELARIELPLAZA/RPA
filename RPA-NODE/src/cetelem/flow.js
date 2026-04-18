const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const {
    BAD_URL_TOKEN,
    HEADLESS,
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
const { fillClientData, fillVehicleData, readVehiclePriceTax, readVehicleTotalAmount } = require("./form");

const READY_TEXT_RAZON_SOCIAL = "capturar nombre de razon social como aparece en el registro del rfc o documentos oficiales";

function createTimestamp() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
}

function isDeadSession(url) {
    return (url || "").includes(BAD_URL_TOKEN);
}

function validateSession(pageOrPopup) {
    const currentUrl = pageOrPopup.url();
    console.log("URL actual:", currentUrl);

    if (isDeadSession(currentUrl)) {
        throw new Error("Sesion invalida detectada. Cayo en josso_security_check.");
    }
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

                let body = "";
                try {
                    body = (await popup.locator("body").innerText({ timeout: 2000 })).toLowerCase();
                } catch {
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
                console.log(`Validacion ${attempt}/${validationsPerCycle} fallo:`, failures);
            } catch (error) {
                lastFailures = [`exception=${error.message}`];
                console.log(`Validacion ${attempt}/${validationsPerCycle} lanzo error: ${error.message}`);
            }
        }

        if (reloads < maxReloads) {
            reloads += 1;
            console.log(`Pantalla invalida tras ${validationsPerCycle} validaciones ${JSON.stringify(lastFailures)}. Reload ${reloads}/${maxReloads}`);
            await popup.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
            continue;
        }

        throw new Error(`Pantalla incorrecta tras varios reloads: ${JSON.stringify(lastFailures)}`);
    }

    throw new Error("Timeout esperando pantalla correcta.");
}

async function createBrowserSession() {
    assertCredentials();

    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
        recordVideo: { dir: VIDEOS_DIR },
        viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();

    return { browser, context, page };
}

async function performLogin(page) {
    console.log("Abriendo login...");
    await page.goto(LOGIN_URL, { timeout: 30000 });
    validateSession(page);

    console.log("Ingresando usuario...");
    await page.fill('input[name="userName"]', USUARIO);

    console.log("Click primer ingresar...");
    await page.locator("#btnEntrar").click();
    validateSession(page);

    console.log("Ingresando password...");
    await page.fill('input[name="userPassword"]', PASSWORD);

    console.log("Click segundo ingresar y esperando popup...");
    const [popup] = await Promise.all([
        page.waitForEvent("popup", { timeout: 15000 }),
        page.locator("#btnEntrar").click(),
    ]);

    await popup.waitForLoadState("domcontentloaded", { timeout: 30000 });
    await waitForValidQuoteScreen(popup, 40000);
    validateSession(popup);

    if (!popup.url().includes("cotizador")) {
        throw new Error(`No llego al cotizador. URL actual: ${popup.url()}`);
    }

    return popup;
}

async function runCetelemFlow(payload) {
    const timestamp = createTimestamp();
    const screenshotPath = path.join(SCREENSHOTS_DIR, `playwright_popup_${timestamp}.png`);
    const errorScreenshotPath = path.join(SCREENSHOTS_DIR, `playwright_error_${timestamp}.png`);
    const consolePath = path.join(LOGS_DIR, `playwright_console_${timestamp}.txt`);
    const consoleLogs = [];
    const startTime = performance.now();

    const session = await createBrowserSession();
    const { browser, context, page } = session;

    let popup = null;

    const onConsole = (message) => {
        const text = message.text();
        consoleLogs.push(text);
        console.log("CONSOLE:", text);
    };

    page.on("console", onConsole);

    try {
        console.log(`Carpeta de videos: ${VIDEOS_DIR}`);
        popup = await performLogin(page);
        popup.on("console", onConsole);

        await fillClientData(popup, payload);
        await fillVehicleData(popup, payload);
        const vehiclePriceTax = await readVehiclePriceTax(popup);
        const vehicleTotalAmount = await readVehicleTotalAmount(popup);
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
            vehiclePriceTax,
            vehicleTotalAmount,
            videoPaths: {
                page: null,
                popup: null,
            },
        };
    } catch (error) {
        try {
            const target = popup || page;
            if (popup) {
                await prepareFullQuoteScreenshot(popup).catch(() => {});
            }
            await target.screenshot({
                path: errorScreenshotPath,
                type: "png",
                fullPage: true,
            });
            console.log(`Screenshot error: ${errorScreenshotPath}`);
        } catch {
            // no-op
        }

        try {
            fs.writeFileSync(consolePath, consoleLogs.join("\n"), "utf8");
            console.log(`Console log: ${consolePath}`);
        } catch {
            // no-op
        }

        throw error;
    } finally {
        let pageVideo = null;
        let popupVideo = null;

        try {
            pageVideo = await page.video()?.path();
        } catch {
            // no-op
        }

        try {
            popupVideo = popup ? await popup.video()?.path() : null;
        } catch {
            // no-op
        }

        try {
            if (popup) {
                await popup.close();
            }
        } catch {
            // no-op
        }

        try {
            await page.close();
        } catch {
            // no-op
        }

        await context.close();
        await browser.close();

        console.log(`Video page: ${pageVideo || "N/A"}`);
        console.log(`Video popup: ${popupVideo || "N/A"}`);
    }
}

async function runCetelemFlowWithRetries(payload) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_REINTENTOS; attempt += 1) {
        try {
            console.log(`Intento ${attempt}/${MAX_REINTENTOS}`);
            return await runCetelemFlow(payload);
        } catch (error) {
            lastError = error;
            console.error(`ERROR en intento ${attempt}: ${error.message}`);

            if (attempt < MAX_REINTENTOS) {
                console.log("Reintentando con nueva sesion...");
            }
        }
    }

    throw lastError;
}

module.exports = {
    runCetelemFlow,
    runCetelemFlowWithRetries,
};
