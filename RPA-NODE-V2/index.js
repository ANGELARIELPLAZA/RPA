const path = require("path");
const BrowserManager = require("./core/browser-manager");
const { LOGIN_URL, SCREENSHOTS_DIR, USUARIO, PASSWORD } = require("./config");

const DATA = {
    cliente: {
        customerType: "1",
        genero: "1",
        customerTitle: "1",
        customerName: "JUAN",
        customerAPaterno: "PEREZ",
        customerAMaterno: "LOPEZ",
        customerBirthDate: "01/01/1990",
        customerRfc: "PELJ900101ABC",
    },
    vehiculo: {
        vehicleType: "N",
        seminuevoCertificado: false,
        insuranceVehicleUse: "1",
        tipoCarga: "",
        servicio: "",
        vehicleBrand: "KIA",
        vehicleAnio: "2025",
        vehicleModel: "K3 SEDAN",
        vehicleVersion: "GT LINE",
        // vehiclePriceTax se recupera del portal
        vehicleAccesories: "RINES Y PELICULA",
        vehicleIsConverted: false,
        vehicleAccesoriesAmount: "15000",
        vehicleChargeStationAmount: "",
        vehicleExtendedWarrantyOption: "0",
        gapInsurance: "N",
        gapInsurancePlan: "",
        gapInsuranceType: "",
    },
    credito: {
        creditDepositAmount: "50000",
        creditDepositPlan: "2504",
        creditDepositTerm: "48",
    },
    seguro: {
        insuranceCP: "64000",
        insuranceRecruitment: "01",
        insuranceType: "01",
        insurancePaymentTermRemnant: "02",
        insuranceCoverageLorant: "AMPLIO",
        insuranceOption: "INBURSA",
    },
};

function empty(value) {
    return value === undefined || value === null || String(value).trim() === "";
}

async function esperarSelectEstableYSeleccionar(page, selector, value, options = {}) {
    const desired = normalizeString(value);
    const timeout = options.timeout ?? 120000;
    const stableMs = options.stableMs ?? 2000;
    const pollMs = options.pollMs ?? 300;

    await page.waitForSelector(selector, { state: "visible", timeout });

    const start = Date.now();
    let lastSnapshot = "";
    let stableSince = 0;

    while (Date.now() - start < timeout) {
        const snapshot = await page.locator(selector).evaluate((el) => {
            return Array.from(el.options || [])
                .map(opt => `${String(opt.value).trim()}::${String(opt.text).trim()}`)
                .join("|");
        }).catch(() => "");

        const hasDesired = snapshot.split("|").some(row => row.startsWith(`${desired}::`));

        if (snapshot === lastSnapshot && hasDesired) {
            if (!stableSince) stableSince = Date.now();

            if (Date.now() - stableSince >= stableMs) {
                await page.selectOption(selector, desired);
                await page.waitForTimeout(1500);
                return;
            }
        } else {
            stableSince = 0;
            lastSnapshot = snapshot;
        }

        await page.waitForTimeout(pollMs);
    }

    throw new Error(`El select ${selector} no se estabilizó con la opción "${desired}"`);
}

function normalizeString(value) {
    return String(value ?? "").trim();
}

function normalizeUppercase(value) {
    return normalizeString(value).toUpperCase();
}

function normalizeCheckbox(value) {
    if (typeof value === "boolean") return value;
    const normalized = normalizeString(value).toLowerCase();
    return ["1", "true", "si", "sí", "y", "yes", "on"].includes(normalized);
}

function normalizeBirthDate(value) {
    const raw = normalizeString(value);
    const digits = raw.match(/\d/g)?.join("") || "";

    if (digits.length !== 8) {
        throw new Error(`customerBirthDate inválida: ${raw}`);
    }

    const looksLikeIso = /^\s*\d{4}[-/]/.test(raw);

    const yyyy = looksLikeIso ? digits.slice(0, 4) : digits.slice(4, 8);
    const mm = looksLikeIso ? digits.slice(4, 6) : digits.slice(2, 4);
    const dd = looksLikeIso ? digits.slice(6, 8) : digits.slice(0, 2);

    return `${dd}/${mm}/${yyyy}`;
}

function parseDdMmYyyy(value) {
    const match = String(value || "").match(/(\d{1,2})\D+(\d{1,2})\D+(\d{4})/);
    if (!match) return null;

    return {
        day: Number(match[1]),
        month: Number(match[2]),
        year: Number(match[3]),
    };
}

async function fillBirthDateMasked(page, selector, value) {
    const expected = normalizeBirthDate(value);
    const expectedParsed = parseDdMmYyyy(expected);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        await page.waitForSelector(selector, { state: "visible", timeout: 15000 });
        await page.click(selector);
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await page.waitForTimeout(200);

        const delay = attempt === 1 ? 110 : attempt === 2 ? 160 : 220;
        await page.locator(selector).pressSequentially(expected, { delay });
        await page.locator(selector).press("Tab").catch(() => { });
        await page.waitForTimeout(400);

        const got = await page.locator(selector).inputValue().catch(() => "");
        if (/[y]/i.test(got)) continue;

        const gotParsed = parseDdMmYyyy(got);

        if (
            expectedParsed &&
            gotParsed &&
            expectedParsed.day === gotParsed.day &&
            expectedParsed.month === gotParsed.month &&
            expectedParsed.year === gotParsed.year
        ) {
            return got;
        }
    }

    const lastValue = await page.locator(selector).inputValue().catch(() => "");
    throw new Error(
        `No se pudo setear fecha. Final: "${lastValue}" | Esperado: "${expected}"`
    );
}



async function esperarYSeleccionar(page, selector, value) {
    const desired = normalizeString(value);

    await page.waitForSelector(selector, { state: "visible", timeout: 15000 });

    await page.waitForFunction(
        ({ selector, value }) => {
            const el = document.querySelector(selector);
            if (!el) return false;
            return Array.from(el.options).some(opt => opt.value === value);
        },
        { selector, value: desired },
        { timeout: 30000 }
    );

    await page.selectOption(selector, desired);
    await page.waitForTimeout(1000);
}

async function esperarYLlenar(page, selector, value) {
    await page.waitForSelector(selector, { state: "visible", timeout: 15000 });
    await page.fill(selector, normalizeString(value));
    await page.waitForTimeout(1000);
}

async function esperarYLlenarUpper(page, selector, value) {
    await page.waitForSelector(selector, { state: "visible", timeout: 15000 });
    await page.fill(selector, normalizeUppercase(value));
    await page.waitForTimeout(1000);
}

async function esperarYCheck(page, selector, desiredValue) {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: "attached", timeout: 15000 });

    const checked = await locator.isChecked().catch(() => false);
    const desired = normalizeCheckbox(desiredValue);

    if (checked !== desired) {
        await locator.click().catch(() => { });
    }

    await page.waitForTimeout(1000);
}

async function esperarYRadio(page, selector) {
    await page.waitForSelector(selector, { state: "visible", timeout: 15000 });
    await page.locator(selector).first().check().catch(async () => {
        await page.locator(selector).first().click().catch(() => { });
    });
    await page.waitForTimeout(1000);
}
async function esperarYSeleccionarAseguradora(page, aseguradora, timeout = 120000) {
    const key = normalizeUppercase(aseguradora);
    const selector = `#insuranceRadio_${key}`;

    await page.waitForSelector(selector, { state: "attached", timeout });

    await page.waitForFunction(
        (selector) => {
            const el = document.querySelector(selector);
            return !!el && !el.disabled;
        },
        selector,
        { timeout }
    );

    await page.locator(selector).check().catch(async () => {
        await page.locator(selector).click({ force: true });
    });

    await page.waitForTimeout(1500);
}
async function obtenerOpcionesSeguro(page, timeout = 120000) {
    await page.waitForSelector('input[type="radio"][name="insuranceOption"]', {
        state: "attached",
        timeout,
    });

    const opciones = await page.locator('input[type="radio"][name="insuranceOption"]').evaluateAll((els) => {
        return els.map((el) => {
            const id = el.id || "";
            const aseguradora = id.replace(/^insuranceRadio_/, "").trim();

            const label = document.querySelector(`label[for="${el.id}"]`);
            const monto = (label?.textContent || "").trim();

            return {
                aseguradora,
                monto,
            };
        });
    });

    return opciones;
}
async function esperarTablaSeguroCargada(page, timeout = 30000, pollMs = 1000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const opciones = await obtenerOpcionesSeguro(page, 5000).catch(() => []);
        if (tablaSeguroValida(opciones)) {
            return opciones.filter(x => x.monto && x.monto !== "0.00");
        }

        await page.waitForTimeout(pollMs);
    }

    return null;
}
async function esperarTablaSeguroConRecarga(page, selectorRecarga, valorCorrecto, options = {}) {
    const timeoutInicial = options.timeoutInicial ?? 15000;
    const timeoutRecarga = options.timeoutRecarga ?? 30000;

    let tabla = await esperarTablaSeguroCargada(page, timeoutInicial);

    if (tabla) {
        return tabla;
    }

    console.log(`Tabla de seguro no cargó. Fuerzo recarga desde ${selectorRecarga}...`);

    tabla = await recargarTablaSeguroDesdeSelector(
        page,
        selectorRecarga,
        valorCorrecto,
        timeoutRecarga
    );

    if (tabla) {
        return tabla;
    }

    throw new Error(`La tabla de seguro no se llenó ni después de recargar desde ${selectorRecarga}`);
}

function tablaSeguroValida(opciones) {
    if (!Array.isArray(opciones) || opciones.length === 0) return false;

    const montosValidos = opciones.filter(x => x.monto && x.monto !== "0.00");
    return montosValidos.length > 0;
}
/* =========================
   ETAPA 1 - LOGIN
========================= */
async function etapaLogin(page) {
    await page.goto(LOGIN_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });

    await page.fill('input[name="userName"]', USUARIO);
    await page.locator("#btnEntrar").click();

    await page.fill('input[name="userPassword"]', PASSWORD);

    const popupPromise = page.waitForEvent("popup", { timeout: 15000 });
    await page.locator("#btnEntrar").click();

    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded", { timeout: 30000 });

    return popup;
}

/* =========================
   ETAPA 2 - IR A COTIZADOR
========================= */
async function etapaAbrirCotizador(popup) {
    await popup.waitForURL(
        "https://cck.creditoclick.com.mx/cotizador/01-cotizacion.html",
        { timeout: 30000 }
    );

    await popup.waitForLoadState("domcontentloaded");
    await popup.waitForTimeout(1500);
}

/* =========================
   ETAPA 3 - CLIENTE
========================= */
async function etapaCliente(popup) {
    const c = DATA.cliente;

    await esperarYSeleccionar(popup, "#customerType", c.customerType);
    await esperarYSeleccionar(popup, "#genero", c.genero);
    await esperarYSeleccionar(popup, "#customerTitle", c.customerTitle);

    await esperarYLlenarUpper(popup, "#customerName", c.customerName);
    await esperarYLlenarUpper(popup, "#customerAPaterno", c.customerAPaterno);

    if (!empty(c.customerAMaterno)) {
        await esperarYLlenarUpper(popup, "#customerAMaterno", c.customerAMaterno);
    }

    await fillBirthDateMasked(popup, "#customerBirthDate", c.customerBirthDate);
    await popup.waitForTimeout(1000);

    await esperarYLlenarUpper(popup, "#customerRfc", c.customerRfc);
    await popup.fill("#customerRfc", c.customerRfc);
    await popup.mouse.click(10, 10);
    await popup.waitForTimeout(1000);
}

/* =========================
   ETAPA 4 - VEHICULO
========================= */
async function etapaVehiculo(popup) {
    const v = DATA.vehiculo;

    await esperarYSeleccionar(popup, "#vehicleType", v.vehicleType);
    if (v.seminuevoCertificado === true) {
        await esperarYCheck(
            popup,
            '[id="18n_seminuevo_certificado"]',
            true
        );
    }
    await esperarYSeleccionar(popup, "#insuranceVehicleUse", v.insuranceVehicleUse);



    await esperarYSeleccionar(popup, "#vehicleBrand", v.vehicleBrand);
    await popup.waitForTimeout(1500);

    await esperarYSeleccionar(popup, "#vehicleAnio", v.vehicleAnio);
    await popup.waitForTimeout(1500);

    await esperarYSeleccionar(popup, "#vehicleModel", v.vehicleModel);
    await popup.waitForTimeout(1500);

    await esperarYSeleccionar(popup, "#vehicleVersion", v.vehicleVersion);
    await popup.waitForTimeout(1500);

    if (!empty(v.vehicleAccesories)) {
        await esperarYLlenarUpper(popup, "#vehicleAccesories", v.vehicleAccesories);
    }
    await popup.waitForTimeout(1500);

    if (!empty(v.vehicleAccesoriesAmount)) {
        await esperarYLlenar(popup, "#vehicleAccesoriesAmount", v.vehicleAccesoriesAmount);
    }
    await popup.waitForTimeout(1500);


    if (!empty(v.vehicleExtendedWarrantyOption)) {
        await esperarYRadio(
            popup,
            `input[type="radio"][name="vehicleExtendedWarrantyOption"][value="${normalizeString(v.vehicleExtendedWarrantyOption)}"]`
        );
    }

    if (!empty(v.gapInsurance)) {
        await esperarYRadio(
            popup,
            `input[type="radio"][name="gapInsurance"][value="${normalizeUppercase(v.gapInsurance)}"]`
        );
    }

    if (!empty(v.gapInsurancePlan)) {
        await esperarYSeleccionar(popup, "#gapInsurancePlan", v.gapInsurancePlan);
    }

    if (!empty(v.gapInsuranceType)) {
        await esperarYRadio(
            popup,
            `input[type="radio"][name="gapInsuranceType"][value="${normalizeUppercase(v.gapInsuranceType)}"]`
        );
    }
}

/* =========================
   ETAPA 5 - RECUPERAR PRECIO
========================= */
async function etapaRecuperarPrecioVehiculo(popup) {
    await popup.waitForTimeout(3000);

    const price = await popup.locator("#vehiclePriceTax").inputValue().catch(() => "");

    console.log("vehiclePriceTax recuperado:", price);

    return price;
}

/* =========================
   ETAPA 6 - CREDITO
========================= */
async function etapaCredito(popup) {
    const c = DATA.credito;

    if (!empty(c.creditDepositAmount)) {
        await esperarYLlenar(popup, "#creditDepositAmount", c.creditDepositAmount);
        await popup.mouse.click(10, 10);
        await popup.waitForTimeout(1000);
    }

    if (!empty(c.creditDepositPlan)) {
        await esperarYSeleccionar(popup, "#creditDepositPlan", c.creditDepositPlan);
    }

    if (!empty(c.creditDepositTerm)) {
        await esperarYSeleccionar(popup, "#creditDepositTerm", c.creditDepositTerm);
    }
}

/* =========================
   ETAPA 7 - SEGURO
========================= */
async function etapaSeguro(popup) {
    const s = DATA.seguro;

    await esperarYLlenar(popup, "#insuranceCP", s.insuranceCP);
    await popup.mouse.click(10, 10);
    await popup.waitForTimeout(2000);

    await esperarYSeleccionar(popup, "#insuranceRecruitment", s.insuranceRecruitment);
    await esperarYSeleccionar(popup, "#insuranceType", s.insuranceType);
    await esperarYSeleccionar(popup, "#insurancePaymentTermRemnant", s.insurancePaymentTermRemnant);
    await esperarYSeleccionar(popup, "#insuranceCoverageLorant", normalizeUppercase(s.insuranceCoverageLorant));

    const opcionesSeguro = await esperarTablaSeguroConRecarga(
        popup,
        "#insuranceCoverageLorant",
        normalizeUppercase(s.insuranceCoverageLorant),
        {
            timeoutInicial: 15000,
            timeoutRecarga: 30000,
        }
    );

    if (empty(s.insuranceOption)) {
        return opcionesSeguro;
    }

    await esperarYSeleccionarAseguradora(popup, s.insuranceOption, 120000);

    const aseguradoraSeleccionada = normalizeUppercase(s.insuranceOption);
    const seleccionada = opcionesSeguro.find(
        (x) => normalizeUppercase(x.aseguradora) === aseguradoraSeleccionada
    );

    if (!seleccionada) {
        throw new Error(`No encontré monto para la aseguradora seleccionada: ${s.insuranceOption}`);
    }

    return [
        {
            aseguradora: seleccionada.aseguradora,
            monto: seleccionada.monto.replace(/,/g, ""),
        }
    ];
}

/* =========================
   ETAPA 8 - SCREENSHOT
========================= */
async function etapaScreenshot(popup) {
    const screenshotPath = path.join(
        SCREENSHOTS_DIR,
        `playwright_${Date.now()}.png`
    );

    await popup.screenshot({
        path: screenshotPath,
        type: "png",
        fullPage: true,
    });

    return screenshotPath;
}

/* =========================
   FLUJO PRINCIPAL
========================= */
async function runCetelemFlowSecuencialHardcode() {
    const browser = await BrowserManager.getBrowser();
    const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
    });

    const page = await context.newPage();
    let popup;

    try {
        console.log("PASO 1: LOGIN");
        popup = await etapaLogin(page);

        console.log("PASO 2: ABRIR COTIZADOR");
        await etapaAbrirCotizador(popup);

        console.log("PASO 3: CLIENTE");
        await etapaCliente(popup);

        console.log("PASO 4: VEHICULO");
        await etapaVehiculo(popup);

        console.log("PASO 5: RECUPERAR PRECIO");
        const vehiclePriceTax = await etapaRecuperarPrecioVehiculo(popup);

        console.log("PASO 6: CREDITO");
        await etapaCredito(popup);

        console.log("PASO 7: SEGURO");
        const seguroResult = await etapaSeguro(popup);

        console.log("PASO 8: SCREENSHOT");
        const screenshotPath = await etapaScreenshot(popup);

        return {
            ok: true,
            //screenshotPath,
            //vehiclePriceTax,
            result: seguroResult,
            //data: DATA,
        };
    } finally {
        if (popup) await popup.close().catch(() => { });
        await page.close().catch(() => { });
        await context.close().catch(() => { });
    }
}

async function runCetelemFlowWithRetries() {
    return runCetelemFlowSecuencialHardcode();
}

module.exports = {
    runCetelemFlowSecuencialHardcode,
    runCetelemFlowWithRetries,
};

if (require.main === module) {
    runCetelemFlowSecuencialHardcode()
        .then((result) => {
            console.log("RESULTADO:", result);
            process.exit(0);
        })
        .catch((error) => {
            console.error("ERROR:", error);
            process.exit(1);
        });
}