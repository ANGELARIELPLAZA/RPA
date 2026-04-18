require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const USUARIO = process.env.USUARIO;
const PASSWORD = process.env.PASSWORD;

if (!USUARIO || !PASSWORD) {
    console.error("ERROR: Faltan USUARIO o PASSWORD en el archivo .env");
    process.exit(1);
}

const TIPO_PERSONA_SELECTOR = "#customerType";
const TIPO_PERSONA_READY_VALUE = "1";
const BAD_URL_TOKEN = "josso_security_check";
const LOGIN_URL = "https://cck.creditoclick.com.mx/users-web/auth/kia/login?w=true";
const MAX_REINTENTOS = 3;

const BASE_DIR = __dirname;
const VIDEOS_DIR = path.join(BASE_DIR, "videos", "playwright");
const SCREENSHOTS_DIR = path.join(BASE_DIR, "screenshots");
const LOGS_DIR = path.join(BASE_DIR, "logs");

for (const dir of [VIDEOS_DIR, SCREENSHOTS_DIR, LOGS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
}

function sesionMuerta(url) {
    return (url || "").includes(BAD_URL_TOKEN);
}

function validarSesion(pageOrPopup) {
    const currentUrl = pageOrPopup.url();
    console.log("URL actual:", currentUrl);

    if (sesionMuerta(currentUrl)) {
        throw new Error("Sesión inválida detectada. Cayó en josso_security_check.");
    }
}

async function esperarPantallaListaReal(popup, consoleLogs, timeout = 45_000) {
    const inicio = Date.now();
    let recargas = 0;
    const MAX_RECARGAS = 3;
    const VALIDACIONES_POR_CICLO = 3;

    const TEXTO_RAZON_SOCIAL =
        "capturar nombre de razón social como aparece en el registro del rfc ó documentos oficiales";

    while (Date.now() - inicio < timeout) {
        let ultimoFallos = [];

        for (let intentoValidacion = 1; intentoValidacion <= VALIDACIONES_POR_CICLO; intentoValidacion++) {
            await popup.waitForTimeout(700);
            const fallos = [];

            try {
                validarSesion(popup);

                if (!popup.url().includes("cotizador")) {
                    fallos.push("url");
                }

                let body = "";
                try {
                    body = (await popup.locator("body").innerText({ timeout: 2000 })).toLowerCase();
                } catch {
                    body = "";
                    fallos.push("body");
                }

                if (body.includes("cargando, por favor espere")) {
                    fallos.push("overlay");
                }

                if (body.includes("cargando componentes visuales")) {
                    fallos.push("componentes");
                }

                try {
                    const logo = popup.locator("#header-logo").first();
                    const logoCount = await logo.count();
                    if (logoCount === 0 || !(await logo.isVisible())) {
                        fallos.push("logo");
                    }
                } catch {
                    fallos.push("logo");
                }

                try {
                    const cotit = popup.locator('img[name="Cotit"]').first();
                    const cotitCount = await cotit.count();
                    if (cotitCount > 0 && (await cotit.isVisible())) {
                        fallos.push("cotit");
                    }
                } catch {
                    // ignorado intencionalmente
                }

                if (body.includes(TEXTO_RAZON_SOCIAL)) {
                    fallos.push("razon_social");
                }

                try {
                    const campo = popup.locator(TIPO_PERSONA_SELECTOR).first();
                    const valor = await campo.inputValue();

                    if (!(await campo.isVisible())) {
                        fallos.push("customer_hidden");
                    }

                    if (!(await campo.isEnabled())) {
                        fallos.push("customer_disabled");
                    }

                    if (valor !== TIPO_PERSONA_READY_VALUE) {
                        fallos.push(`customer_value=${valor}`);
                    }
                } catch {
                    fallos.push("customerType");
                }

                if (fallos.length === 0) {
                    return;
                }

                ultimoFallos = [...fallos];
                console.log(
                    `Validación ${intentoValidacion}/${VALIDACIONES_POR_CICLO} falló:`,
                    fallos
                );
            } catch (e) {
                ultimoFallos = [`exception=${e.message}`];
                console.log(
                    `Validación ${intentoValidacion}/${VALIDACIONES_POR_CICLO} lanzó error: ${e.message}`
                );
            }
        }

        if (recargas < MAX_RECARGAS) {
            recargas += 1;
            console.log(
                `Pantalla inválida tras ${VALIDACIONES_POR_CICLO} validaciones ${JSON.stringify(
                    ultimoFallos
                )}. Reload ${recargas}/${MAX_RECARGAS}`
            );
            await popup.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
            continue;
        }

        throw new Error(`Pantalla incorrecta tras varios reloads: ${JSON.stringify(ultimoFallos)}`);
    }

    throw new Error("Timeout esperando pantalla correcta.");
}

const CLIENTE_BASE_FIELDS = [
    {
        key: "customerType",
        selector: "#customerType",
        type: "select",
        required: true,
        transform: (v) => String(v).trim(),
    },
];

const CLIENTE_FIELDS_BY_TYPE = {
    // 1 = FISICA
    "1": [
        {
            key: "genero",
            selector: "#genero",
            type: "select",
            required: true,
            transform: (v) => String(v).trim(),
        },
        {
            key: "customerTitle",
            selector: "#customerTitle",
            type: "select",
            required: true,
            timeout: 25000,
            retries: 5,
            transform: (v) => String(v).trim(),
        },
        {
            key: "customerName",
            labelFor: "customerName",
            type: "input",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim().toUpperCase(),
        },
        {
            key: "customerAPaterno",
            labelFor: "customerAPaterno",
            type: "input",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim().toUpperCase(),
        },
        {
            key: "customerAMaterno",
            labelFor: "customerAMaterno",
            type: "input",
            required: false,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim().toUpperCase(),
        },
        {
            key: "customerBirthDate",
            labelFor: "customerBirthDate",
            type: "input",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim(),
        },
        {
            key: "customerRfc",
            labelFor: "customerRfc",
            type: "input",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim().toUpperCase(),
        },
    ],

    // 2 = MORAL
    "2": [
        {
            key: "customerRazonSocial",
            labelFor: "customerRazonSocial",
            type: "input",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim().toUpperCase(),
        },
        {
            key: "customerNombreComercial",
            selector: "#customerNombreComercial",
            type: "input",
            required: false,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim().toUpperCase(),
        },
        {
            key: "customerBirthDate",
            labelFor: "customerBirthDate",
            type: "input",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim(),
        },
        {
            key: "customerRfc",
            labelFor: "customerRfc",
            type: "input",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim().toUpperCase(),
        },
    ],

    // 3 = FISICA EMPRESARIAL
    "3": [
        {
            key: "genero",
            selector: "#genero",
            type: "select",
            required: true,
            transform: (v) => String(v).trim(),
        },
        {
            key: "customerTitle",
            selector: "#customerTitle",
            type: "select",
            required: true,
            timeout: 25000,
            retries: 5,
            transform: (v) => String(v).trim(),
        },
        {
            key: "customerName",
            labelFor: "customerName",
            type: "input",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim().toUpperCase(),
        },
        {
            key: "customerAPaterno",
            labelFor: "customerAPaterno",
            type: "input",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim().toUpperCase(),
        },
        {
            key: "customerAMaterno",
            labelFor: "customerAMaterno",
            type: "input",
            required: false,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim().toUpperCase(),
        },
        {
            key: "customerBirthDate",
            labelFor: "customerBirthDate",
            type: "input",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim(),
        },
        {
            key: "customerRfc",
            labelFor: "customerRfc",
            type: "input",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim().toUpperCase(),
        },
        {
            key: "customerNumUnidades",
            selector: "#customerNumUnidades",
            type: "select",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim(),
        },
        {
            key: "customerFirstCredit",
            selector: "#customerFirstCredit",
            type: "select",
            required: true,
            timeout: 15000,
            retries: 3,
            transform: (v) => String(v).trim(),
        },
    ],
};

function getNestedValue(obj, key) {
    return key.split(".").reduce((acc, part) => acc?.[part], obj);
}

async function resolveFieldSelector(page, field) {
    if (field.selector) {
        return field.selector;
    }

    if (field.labelFor) {
        const label = page.locator(`label[for="${field.labelFor}"]`).first();

        await label.waitFor({
            state: "visible",
            timeout: field.timeout ?? 15000,
        });

        const targetId = await label.getAttribute("for");

        if (!targetId) {
            throw new Error(`El label de ${field.key} no tiene atributo "for"`);
        }

        return `#${targetId}`;
    }

    if (field.labelText) {
        const label = page.locator("label", { hasText: field.labelText }).first();

        await label.waitFor({
            state: "visible",
            timeout: field.timeout ?? 15000,
        });

        const targetId = await label.getAttribute("for");

        if (!targetId) {
            throw new Error(`El label "${field.labelText}" no tiene atributo "for"`);
        }

        return `#${targetId}`;
    }

    throw new Error(`El campo ${field.key} no tiene selector, labelFor ni labelText`);
}

async function waitForSelectReady(page, selector, expectedValue, options = {}) {
    const {
        timeout = 15000,
        waitOptionsLoaded = true,
    } = options;

    await page.waitForSelector(selector, {
        state: "visible",
        timeout,
    });

    await page.waitForFunction(
        ({ selector, expectedValue, waitOptionsLoaded }) => {
            const el = document.querySelector(selector);
            if (!el) return false;
            if (el.tagName !== "SELECT") return false;
            if (el.disabled) return false;

            const options = Array.from(el.options || []);
            if (options.length === 0) return false;
            if (waitOptionsLoaded && options.length <= 1) return false;

            return options.some(opt => String(opt.value) === String(expectedValue));
        },
        { selector, expectedValue: String(expectedValue), waitOptionsLoaded },
        { timeout }
    );
}

async function selectAndVerify(page, selector, value, options = {}) {
    const {
        timeout = 15000,
        retries = 3,
        settleMs = 300,
        fieldName = selector,
    } = options;

    const expectedValue = String(value);
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await waitForSelectReady(page, selector, expectedValue, { timeout });

            await page.selectOption(selector, expectedValue);
            await page.waitForTimeout(settleMs);

            const selectedValue = await page.locator(selector).inputValue();

            if (String(selectedValue) !== expectedValue) {
                throw new Error(
                    `El portal no conservó el valor. Esperado=${expectedValue}, actual=${selectedValue}`
                );
            }

            console.log(`[OK] ${fieldName}=${expectedValue}`);
            return;
        } catch (error) {
            lastError = error;
            console.log(
                `[WARN] ${fieldName} intento ${attempt}/${retries}: ${error.message}`
            );

            if (attempt < retries) {
                await page.waitForTimeout(500);
            }
        }
    }

    throw new Error(
        `No se pudo seleccionar ${fieldName}=${expectedValue}. Último error: ${lastError?.message || "desconocido"}`
    );
}

async function fillAndVerify(page, selector, value, options = {}) {
    const {
        timeout = 15000,
        retries = 3,
        settleMs = 500,
        fieldName = selector,
    } = options;

    const expectedValue = String(value).trim();
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await page.waitForSelector(selector, {
                state: "visible",
                timeout,
            });

            const locator = page.locator(selector);
            const isDateField =
                fieldName.toLowerCase().includes("birthdate") ||
                selector.toLowerCase().includes("birthdate") ||
                selector.toLowerCase().includes("fecha");

            await locator.click({ timeout });

            // limpiar
            await locator.press("Control+A").catch(() => {});
            await locator.press("Meta+A").catch(() => {});
            await locator.press("Delete").catch(() => {});
            await locator.fill("").catch(() => {});

            if (isDateField) {
                // escritura real para máscaras
                await locator.pressSequentially(expectedValue, { delay: 120 });
            } else {
                await locator.fill(expectedValue);
            }

            await locator.dispatchEvent("input").catch(() => {});
            await locator.dispatchEvent("change").catch(() => {});
            await locator.blur();

            await page.waitForTimeout(settleMs);

            const currentValue = (await locator.inputValue()).trim();

            if (currentValue !== expectedValue) {
                throw new Error(
                    `Esperado=${expectedValue}, actual=${currentValue}`
                );
            }

            console.log(`[OK] ${fieldName}=${expectedValue}`);
            return;

        } catch (error) {
            lastError = error;

            console.log(
                `[WARN] ${fieldName} intento ${attempt}/${retries}: ${error.message}`
            );

            if (attempt < retries) {
                await page.waitForTimeout(700);
            }
        }
    }

    throw new Error(
        `No se pudo llenar ${fieldName}=${expectedValue}. Último error: ${lastError?.message || "desconocido"}`
    );
}

async function datosDelCliente(page, data) {
    const cliente = data?.cliente;

    if (!cliente || typeof cliente !== "object") {
        throw new Error("No viene el objeto cliente en el JSON");
    }

    // =========================
    // 1. Obtener customerType
    // =========================
    const customerTypeRaw = getNestedValue(cliente, "customerType");

    const customerTypeEmpty =
        customerTypeRaw === undefined ||
        customerTypeRaw === null ||
        String(customerTypeRaw).trim() === "";

    if (customerTypeEmpty) {
        throw new Error("Falta el campo requerido: customerType");
    }

    const customerType = String(customerTypeRaw).trim();

    // =========================
    // 2. Llenar campos base
    // =========================
    for (const field of CLIENTE_BASE_FIELDS) {
        const rawValue = getNestedValue(cliente, field.key);

        const isEmpty =
            rawValue === undefined ||
            rawValue === null ||
            String(rawValue).trim() === "";

        if (isEmpty) {
            if (field.required) {
                throw new Error(`Falta el campo requerido: ${field.key}`);
            }
            continue;
        }

        const value = field.transform ? field.transform(rawValue) : rawValue;
        const selector = await resolveFieldSelector(page, field);

        if (field.type === "select") {
            await selectAndVerify(page, selector, value, {
                fieldName: field.key,
                retries: field.retries ?? 3,
                timeout: field.timeout ?? 15000,
                settleMs: 300,
            });
        } else if (field.type === "input") {
            await fillAndVerify(page, selector, value, {
                fieldName: field.key,
                retries: field.retries ?? 3,
                timeout: field.timeout ?? 15000,
                settleMs: 400,
            });
        } else {
            throw new Error(`Tipo de campo no soportado: ${field.type}`);
        }
    }

    // =========================
    // 3. Esperar render dinámico
    // =========================
    await page.waitForTimeout(800);

    // =========================
    // 4. Obtener campos por tipo
    // =========================
    const fieldsByType = CLIENTE_FIELDS_BY_TYPE[customerType];

    if (!fieldsByType) {
        throw new Error(`customerType no soportado: ${customerType}`);
    }

    // =========================
    // 5. Llenar campos del tipo
    // =========================
    for (const field of fieldsByType) {
        const rawValue = getNestedValue(cliente, field.key);

        const isEmpty =
            rawValue === undefined ||
            rawValue === null ||
            String(rawValue).trim() === "";

        if (isEmpty) {
            if (field.required) {
                throw new Error(`Falta el campo requerido: ${field.key}`);
            }
            continue;
        }

        const value = field.transform ? field.transform(rawValue) : rawValue;
        const selector = await resolveFieldSelector(page, field);

        if (field.type === "select") {
            await selectAndVerify(page, selector, value, {
                fieldName: field.key,
                retries: field.retries ?? 3,
                timeout: field.timeout ?? 15000,
                settleMs: 300,
            });
        } else if (field.type === "input") {
            await fillAndVerify(page, selector, value, {
                fieldName: field.key,
                retries: field.retries ?? 3,
                timeout: field.timeout ?? 15000,
                settleMs: 400,
            });
        } else {
            throw new Error(`Tipo de campo no soportado: ${field.type}`);
        }
    }

    console.log(`[OK] Datos del cliente completados para tipo ${customerType}`);
}

async function ejecutarFlujo() {
    const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\..+/, "")
        .replace("T", "_");

    const screenshotFile = path.join(SCREENSHOTS_DIR, `playwright_popup_${timestamp}.png`);
    const errorScreenshotFile = path.join(SCREENSHOTS_DIR, `playwright_error_${timestamp}.png`);
    const consoleFile = path.join(LOGS_DIR, `playwright_console_${timestamp}.txt`);

    const consoleLogs = [];

    const onConsole = (msg) => {
        const texto = msg.text();
        consoleLogs.push(texto);
        console.log("CONSOLE:", texto);
    };

    const HEADLESS = (process.env.HEADLESS || "false").toLowerCase() === "true";

    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
        recordVideo: {
            dir: VIDEOS_DIR,
        },
        viewport: { width: 1366, height: 900 },
    });

    const page = await context.newPage();
    page.on("console", onConsole);

    let popup = null;
    const start = performance.now();

    try {
        console.log(`Carpeta de videos: ${VIDEOS_DIR}`);
        console.log("Abriendo login...");
        await page.goto(LOGIN_URL, { timeout: 30000 });
        validarSesion(page);

        console.log("Ingresando usuario...");
        await page.fill('input[name="userName"]', USUARIO);

        console.log("Click primer ingresar...");
        await page.locator("#btnEntrar").click();
        validarSesion(page);

        console.log("Ingresando password...");
        await page.fill('input[name="userPassword"]', PASSWORD);

        console.log("Click segundo ingresar y esperando popup...");
        const [newPopup] = await Promise.all([
            page.waitForEvent("popup", { timeout: 15000 }),
            page.locator("#btnEntrar").click(),
        ]);

        popup = newPopup;
        popup.on("console", onConsole);

        await popup.waitForLoadState("domcontentloaded", { timeout: 30000 });

        await esperarPantallaListaReal(popup, consoleLogs, 40_000);
        validarSesion(popup);

        const data = {
            cliente: {
                customerType: "3",
                genero: "1",
                customerTitle: "1",
                customerName: "ANGEL",
                customerAPaterno: "PLAZA",
                customerAMaterno: "HERNANDEZ",
                customerBirthDate: "01/01/1990",
                customerRfc: "PEHA900101ABC",
                customerNumUnidades: "2",
                customerFirstCredit: "1"
            }
        };

        await datosDelCliente(popup, data);

        if (!popup.url().includes("cotizador")) {
            throw new Error(`No llegó al cotizador. URL actual: ${popup.url()}`);
        }

        await popup.screenshot({ path: screenshotFile });

        fs.writeFileSync(consoleFile, consoleLogs.join("\n"), "utf8");

        const elapsed = ((performance.now() - start) / 1000).toFixed(2);
        console.log(`OK | Tiempo total: ${elapsed}s`);
        console.log(`Screenshot: ${screenshotFile}`);
        console.log(`Console log: ${consoleFile}`);
    } catch (e) {
        const elapsed = ((performance.now() - start) / 1000).toFixed(2);
        console.error(`ERROR: ${e.message}`);
        console.error(`Tiempo antes del fallo: ${elapsed}s`);

        try {
            const target = popup || page;
            await target.screenshot({ path: errorScreenshotFile });
            console.log(`Screenshot error: ${errorScreenshotFile}`);
        } catch { }

        try {
            fs.writeFileSync(consoleFile, consoleLogs.join("\n"), "utf8");
            console.log(`Console log: ${consoleFile}`);
        } catch { }

        throw e;
    } finally {
        let pageVideo = null;
        let popupVideo = null;

        try {
            pageVideo = await page.video()?.path();
        } catch { }

        try {
            popupVideo = popup ? await popup.video()?.path() : null;
        } catch { }

        if (popup) {
            try {
                await popup.close();
            } catch { }
        }

        try {
            await page.close();
        } catch { }

        await context.close();
        await browser.close();

        console.log(`Video page: ${pageVideo}`);
        console.log(`Video popup: ${popupVideo}`);
    }
}

async function main() {
    for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
        try {
            console.log(`\nIntento ${intento}/${MAX_REINTENTOS}`);
            await ejecutarFlujo();
            process.exit(0);
        } catch (e) {
            console.error(`ERROR en intento ${intento}: ${e.message}`);

            if (intento === MAX_REINTENTOS) {
                process.exit(1);
            }

            console.log("Reintentando con nueva sesión...");
        }
    }
}

main().catch((err) => {
    console.error("Fallo no controlado:", err);
    process.exit(1);
});