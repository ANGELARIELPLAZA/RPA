const BrowserManager = require("./core/browser-manager");
const { CETELEM_URL, USUARIO, PASSWORD, MAX_REINTENTOS } = require("./config");
const logger = require("./core/logger");

const DEFAULT_DATA = {
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

async function esperarOverlayCarga(page, { selector = "#contenedor_carga", timeout = 90000 } = {}) {
    try {
        await page.locator(selector).waitFor({ state: "hidden", timeout });
    } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes("Execution context was destroyed") || msg.includes("Target closed") || msg.includes("Page closed")) {
            return;
        }
        throw e;
    }
}

async function clickConOverlay(page, selector, { timeout = 90000 } = {}) {
    await esperarOverlayCarga(page, { timeout: Math.min(timeout, 30000) });

    const locator = page.locator(selector);
    await locator.waitFor({ state: "visible", timeout });

    await locator.click({ timeout });

    await esperarOverlayCarga(page, { timeout });
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



async function getBestSelectLocator(page, selector) {
    const visible = page.locator(`${selector}:visible`).first();
    if (await visible.count().catch(() => 0)) return visible;
    return page.locator(selector).first();
}

async function snapshotSelect(locator) {
    return locator.evaluate((el) => {
        const select = el;
        const options = Array.from(select.options || []).map((o) => ({
            value: String(o.value ?? ""),
            label: String(o.label ?? o.textContent ?? "").trim(),
            selected: Boolean(o.selected),
        }));
        const selected = options.find((o) => o.selected) || null;
        return {
            disabled: Boolean(select.disabled),
            optionsCount: options.length,
            value: String(select.value ?? ""),
            selectedLabel: selected?.label || "",
            options,
        };
    }).catch(() => ({
        disabled: null,
        optionsCount: 0,
        value: "",
        selectedLabel: "",
        options: [],
    }));
}

function findOptionMatch(selectSnapshot, desiredRaw) {
    const desired = normalizeString(desiredRaw);
    const desiredLower = desired.toLowerCase();

    const byValue = selectSnapshot.options.find((o) => String(o.value) === desired);
    if (byValue) return { kind: "value", value: desired };

    const byLabel = selectSnapshot.options.find((o) => String(o.label || "").toLowerCase() === desiredLower);
    if (byLabel) return { kind: "label", value: desired };

    // ya seleccionado (por value o label)
    if (
        String(selectSnapshot.value) === desired
        || String(selectSnapshot.selectedLabel || "").toLowerCase() === desiredLower
    ) {
        return { kind: "already", value: desired };
    }

    return null;
}

function formatOptionsList(selectSnapshot, { limit = 80 } = {}) {
    const options = Array.isArray(selectSnapshot?.options) ? selectSnapshot.options : [];
    const slice = options.slice(0, Math.max(0, limit));
    const lines = slice.map((o) => `${String(o.value)}="${String(o.label || "").trim()}"`);
    const suffix = options.length > slice.length ? ` ... (+${options.length - slice.length})` : "";
    return lines.join(", ") + suffix;
}

async function esperarYSeleccionar(page, selector, value, timeout = 30000) {
    const desired = normalizeString(value);
    const hooks = page?.__rpaHooks;

    if (empty(desired)) {
        if (hooks?.onProgress) {
            await hooks.onProgress({ page, message: `Falta valor para seleccionar ${selector}` }).catch(() => { });
        }
        throw new Error(`Falta valor para seleccionar ${selector}`);
    }

    const locator = await getBestSelectLocator(page, selector);
    await locator.waitFor({ state: "attached", timeout });

    if (hooks?.onProgress) {
        await hooks.onProgress({ page, message: `Esperando ${selector} (deseado=${desired})` }).catch(() => { });
    }

    // Espera a que el select tenga opciones cargadas (sin esperar el "deseado" indefinidamente)
    await page.waitForFunction(
        (sel) => {
            const nodes = Array.from(document.querySelectorAll(sel));
            const select = nodes.find((n) => n && n.tagName === "SELECT" && !n.disabled);
            if (!select) return false;
            return (select.options?.length || 0) > 0;
        },
        selector,
        { timeout }
    );

    const snap = await snapshotSelect(locator);
    const match = findOptionMatch(snap, desired);

    if (!match) {
        const optionsList = formatOptionsList(snap, { limit: selector === "#gapInsurancePlan" ? 200 : 80 });

        // Caso especial: plan GAP. Tomar evidencia antes de fallar.
        if (selector === "#gapInsurancePlan") {
            if (hooks?.onProgress) {
                await hooks.onProgress({ page, message: `No se encontró opción en ${selector} (deseado=${desired}). Capturando evidencia...` }).catch(() => { });
            }

            await locator.scrollIntoViewIfNeeded().catch(() => { });
            await locator.click({ timeout: 2000 }).catch(() => { });
            await page.waitForTimeout(250);

            if (hooks?.onErrorScreenshot) {
                await hooks.onErrorScreenshot({ page }).catch(() => { });
            }
        }

        throw new Error(
            `Opción no encontrada para ${selector} (deseado="${desired}", actual="${snap.value}" label="${snap.selectedLabel}", opciones=${snap.optionsCount}): ${optionsList}`
        );
    }

    if (match.kind === "already") {
        if (hooks?.onProgress) {
            await hooks.onProgress({ page, message: `Ya seleccionado ${selector}=${desired}` }).catch(() => { });
        }
        await page.waitForTimeout(250);
        return;
    }

    if (hooks?.onProgress) {
        await hooks.onProgress({ page, message: `Seleccionando ${selector}=${desired}` }).catch(() => { });
    }

    if (match.kind === "label") {
        await locator.selectOption({ label: desired }, { timeout });
    } else {
        await locator.selectOption(desired, { timeout });
    }

    await page.waitForTimeout(1000);
}

async function esperarOpcionesORecargar(page, selector, { timeout = 8000, maxReloads = 2 } = {}) {
    const hooks = page?.__rpaHooks;
    for (let attempt = 1; attempt <= maxReloads + 1; attempt += 1) {
        if (hooks?.onProgress) {
            await hooks.onProgress({ page, message: `Esperando opciones ${selector} (intento ${attempt}/${maxReloads + 1})` }).catch(() => { });
        }

        const ok = await page.waitForFunction(
            (sel) => {
                const nodes = Array.from(document.querySelectorAll(sel));
                const select = nodes.find((n) => n && n.tagName === "SELECT" && !n.disabled);
                if (!select) return false;
                const count = select.options?.length || 0;
                // "0" o "1" suele ser placeholder, esperamos 2+
                return count > 1;
            },
            selector,
            { timeout }
        ).then(() => true).catch(() => false);

        if (ok) return true;

        if (attempt <= maxReloads) {
            if (hooks?.onProgress) {
                await hooks.onProgress({ page, message: `Recargando página: opciones vacías en ${selector}` }).catch(() => { });
            }
            await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => { });
            await page.waitForTimeout(1500);
            continue;
        }

        return false;
    }

    return false;
}

async function esperarYLlenar(page, selector, value) {
    const hooks = page?.__rpaHooks;
    if (hooks?.onProgress) {
        await hooks.onProgress({ page, message: `Esperando ${selector}` }).catch(() => { });
    }
    await page.waitForSelector(selector, { state: "visible", timeout: 15000 });
    if (hooks?.onProgress) {
        await hooks.onProgress({ page, message: `Llenando ${selector}` }).catch(() => { });
    }
    await page.fill(selector, normalizeString(value));
    await page.waitForTimeout(1000);
}

async function esperarYLlenarUpper(page, selector, value) {
    const hooks = page?.__rpaHooks;
    if (hooks?.onProgress) {
        await hooks.onProgress({ page, message: `Esperando ${selector}` }).catch(() => { });
    }
    await page.waitForSelector(selector, { state: "visible", timeout: 15000 });
    if (hooks?.onProgress) {
        await hooks.onProgress({ page, message: `Llenando ${selector}` }).catch(() => { });
    }
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

    logger.warn(`[seguro] Tabla de seguro no cargó. Fuerzo recarga desde ${selectorRecarga}...`);

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

function waitForPopupOrNewPage(openerPage, timeoutMs = 15000) {
    const context = openerPage.context();

    return new Promise((resolve) => {
        let done = false;
        let timer = null;

        const cleanup = () => {
            try { openerPage.off("popup", onPopup); } catch { }
            try { context.off("page", onPage); } catch { }
            if (timer) clearTimeout(timer);
        };

        const finish = (p) => {
            if (done) return;
            done = true;
            cleanup();
            resolve(p || null);
        };

        const onPopup = (p) => finish(p);
        const onPage = (p) => {
            try {
                if (p.opener && p.opener() === openerPage) finish(p);
            } catch { }
        };

        openerPage.on("popup", onPopup);
        context.on("page", onPage);
        timer = setTimeout(() => finish(null), timeoutMs);
    });
}
/* =========================
   ETAPA 1 - LOGIN
========================= */
async function etapaLogin(page) {
    await page.goto(CETELEM_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });

    await page.fill('input[name="userName"]', USUARIO);
    await clickConOverlay(page, "#btnEntrar", { timeout: 90000 });

    await page.fill('input[name="userPassword"]', PASSWORD);

    // El portal a veces abre el cotizador en un popup (window.open) y otras veces navega en la misma pestaña.
    const targetPromise = waitForPopupOrNewPage(page, 60000);

    await clickConOverlay(page, "#btnEntrar", { timeout: 90000 });

    const target = await targetPromise;

    if (target) {
        await target.waitForLoadState("domcontentloaded", { timeout: 30000 });
        return target;
    }

    logger.warn(`[login] No se abrió popup; continuando en la misma pestaña (url=${page.url()})`);
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => { });
    return page;
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

    await popup.goto("https://cck.creditoclick.com.mx/cotizador/01-cotizacion.html", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
    });
    await popup.waitForTimeout(1500);

    
}

/* =========================
   ETAPA 3 - CLIENTE
========================= */
async function etapaCliente(popup, data) {
    const c = data?.cliente || {};

    //const opcionesOk = await esperarOpcionesORecargar(popup, "#customerType", { timeout: 8000, maxReloads: 2 });

    if (empty(c.customerName)) throw new Error("Falta campo requerido: customerName");
    if (empty(c.customerAPaterno)) throw new Error("Falta campo requerido: customerAPaterno");
    if (empty(c.customerBirthDate)) throw new Error("Falta campo requerido: customerBirthDate");
    
    await esperarYSeleccionar(popup, "#customerType", c.customerType, 60000);
    await esperarYSeleccionar(popup, "#genero", c.genero);
    await esperarYSeleccionar(popup, "#customerTitle", c.customerTitle);

    await esperarYLlenarUpper(popup, "#customerName", c.customerName);
    await esperarYLlenarUpper(popup, "#customerAPaterno", c.customerAPaterno);

    if (!empty(c.customerAMaterno)) {
        await esperarYLlenarUpper(popup, "#customerAMaterno", c.customerAMaterno);
    }

    await fillBirthDateMasked(popup, "#customerBirthDate", c.customerBirthDate);
    await popup.waitForTimeout(1000);

    if (!empty(c.customerRfc)) {
        await esperarYLlenarUpper(popup, "#customerRfc", c.customerRfc);
        await popup.mouse.click(10, 10);
        await popup.waitForTimeout(1000);
    }
}

/* =========================
   ETAPA 4 - VEHICULO
========================= */
async function etapaVehiculo(popup, data) {
    const v = data?.vehiculo || {};
    const nivelDetalle = normalizeString(data?.nivel_detalle ?? data?.nivelDetalle).toLowerCase();

    // Para pruebas: si solo se requiere llegar a seguros, permitir un default mínimo.
    if (nivelDetalle === "seguros" && empty(v.vehicleType)) {
        v.vehicleType = "1";
    }

    if (empty(v.vehicleType)) throw new Error("Falta campo requerido: vehicleType");
    if (empty(v.insuranceVehicleUse)) throw new Error("Falta campo requerido: insuranceVehicleUse");
    if (empty(v.vehicleBrand)) throw new Error("Falta campo requerido: vehicleBrand");
    if (empty(v.vehicleAnio)) throw new Error("Falta campo requerido: vehicleAnio");
    if (empty(v.vehicleModel)) throw new Error("Falta campo requerido: vehicleModel");
    if (empty(v.vehicleVersion)) throw new Error("Falta campo requerido: vehicleVersion");

    // Si el primer select del vehículo tarda, recarga rápido para no quemar timeout largos.
    const vehicleTypeOk = await esperarOpcionesORecargar(popup, "#vehicleType", { timeout: 3000, maxReloads: 1 });
    if (!vehicleTypeOk) {
        throw new Error("No cargaron opciones para #vehicleType después de recargar la página");
    }

    await esperarYSeleccionar(popup, "#vehicleType", v.vehicleType);
    await popup.mouse.click(10, 10).catch(() => { });
    await popup.waitForTimeout(500);
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
        const raw = normalizeString(v.vehicleAccesoriesAmount).replace(/,/g, "");
        const asNumber = Number(raw);
        const isZeroLike = Number.isFinite(asNumber) && asNumber === 0;
        if (!isZeroLike) {
            await esperarYLlenar(popup, "#vehicleAccesoriesAmount", v.vehicleAccesoriesAmount);
        }
    }
    await popup.waitForTimeout(1500);


    if (!empty(v.vehicleExtendedWarrantyOption)) {
        await esperarYRadio(
            popup,
            `input[type="radio"][name="vehicleExtendedWarrantyOption"][value="${normalizeString(v.vehicleExtendedWarrantyOption)}"]`
        );
    }

    const gapInsuranceValue = !empty(v.gapInsurance) ? normalizeUppercase(v.gapInsurance) : "";

    if (gapInsuranceValue) {
        await esperarYRadio(
            popup,
            `input[type="radio"][name="gapInsurance"][value="${gapInsuranceValue}"]`
        );
    }

    // Si no hay GAP (N), no se busca plan/tipo aunque vengan en payload.
    if (gapInsuranceValue !== "N") {
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
}

/* =========================
   ETAPA 5 - RECUPERAR PRECIO
========================= */
async function etapaRecuperarPrecioVehiculo(popup) {
    await popup.waitForTimeout(3000);

    const price = await popup.locator("#vehiclePriceTax").inputValue().catch(() => "");

    logger.info(`[vehiculo] vehiclePriceTax recuperado: ${price}`);

    return price;
}

/* =========================
   ETAPA 6 - CREDITO
========================= */
async function etapaCredito(popup, data) {
    const c = data?.credito || {};

    // Enganche: usar solo uno (prioridad: porcentaje, luego monto)
    if (!empty(c.creditDepositPercent)) {
        await esperarYLlenar(popup, "#creditDepositPercent", c.creditDepositPercent);
        await popup.mouse.click(10, 10);
        await popup.waitForTimeout(1000);
    } else if (!empty(c.creditDepositAmount)) {
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
async function etapaSeguro(popup, data) {
    const s = data?.seguro || {};
    const nivelDetalle = normalizeString(data?.nivel_detalle ?? data?.nivelDetalle).toLowerCase();
    const soloListaAseguradoras = nivelDetalle === "seguros";

    await waitUntilEnabled(popup, "#insuranceCP", { timeout: 60000, pollMs: 300 });
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

    if (soloListaAseguradoras || empty(s.insuranceOption)) {
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

function parseMoneyNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0.0;
    const cleaned = raw.replace(/[$\s]/g, "").replace(/,/g, "").replace(/[^\d.-]/g, "");
    const num = Number.parseFloat(cleaned);
    return Number.isFinite(num) ? num : 0.0;
}

async function readValueByLabel(page, labelText) {
    const desired = String(labelText || "").trim().toLowerCase();
    if (!desired) return "";

    return page.evaluate((labelLower) => {
        const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

        const candidates = Array.from(document.querySelectorAll("label,td,th,span,div"))
            .map((el) => ({ el, text: normalize(el.textContent) }))
            .filter((x) => x.text && (x.text === labelLower || x.text.startsWith(labelLower)));

        const pickValueFrom = (root) => {
            if (!root) return "";
            const input = root.querySelector("input,textarea,select");
            if (input) {
                if ("value" in input) return String(input.value || "").trim();
                return String(input.textContent || "").trim();
            }
            const maybeText = root.querySelector("span,strong,b");
            return String(maybeText?.textContent || "").trim();
        };

        for (const c of candidates) {
            const el = c.el;
            if (!el) continue;

            if (el.tagName === "LABEL") {
                const htmlFor = el.getAttribute("for");
                if (htmlFor) {
                    const target = document.getElementById(htmlFor);
                    const v = target && ("value" in target) ? String(target.value || "").trim() : "";
                    if (v) return v;
                }
            }

            const parent = el.parentElement;
            const sibling = el.nextElementSibling;

            const v1 = pickValueFrom(sibling);
            if (v1) return v1;

            const v2 = pickValueFrom(parent);
            if (v2 && normalize(v2) !== c.text) return v2;

            const row = el.closest("tr");
            const v3 = pickValueFrom(row);
            if (v3 && normalize(v3) !== c.text) return v3;
        }

        return "";
    }, desired).catch(() => "");
}


/* =========================
   ETAPA 8 - Guardar cotizacion
========================= */
async function clickGuardarCotizacion(popup) {
    const btn = popup.locator('#buttonSave').first();

    await btn.waitFor({
        state: 'visible',
        timeout: 10000
    });

    await btn.scrollIntoViewIfNeeded().catch(() => {});

    try {
        await btn.click({ timeout: 5000 });
    } catch {
        await btn.click({ force: true });
    }

    return true;
}

async function etapaGuardarCotizacion(popup, data) {
    const hooks = popup?.__rpaHooks;

    const cot = data?.cotizacion || {};

    // Campos de anualidad (si existen)
    if (!empty(cot.annuityMonth)) {
        const monthValue = normalizeAnnuityMonth(cot.annuityMonth);
        await esperarYSeleccionar(popup, "#annuityMonth", monthValue, 60000);
    }

    if (cot.annuityAmount !== undefined && cot.annuityAmount !== null && String(cot.annuityAmount).trim() !== "") {
        await esperarYLlenar(popup, "#annuityAmount", cot.annuityAmount);
        await popup.mouse.click(10, 10).catch(() => { });
        await popup.waitForTimeout(500);
    }

    const maxWaitSeconds = 20;
    const waitIntervalMs = 500;
    const maxSaveAttempts = 2;
    const saveData = {};

    const routeHandler = async (route) => {
        const response = await route.fetch();
        try {
            const jsonData = await response.json().catch(() => null);
            if (jsonData && typeof jsonData === "object") {
                saveData.folio = normalizeString(jsonData.folio ?? jsonData.numCotizacion ?? jsonData.num_cotizacion ?? "");
                const mensualidadRaw = jsonData.mensualidad ?? jsonData.mensualiteAvecASM ?? 0.0;
                saveData.mensualidad = Number(mensualidadRaw) || 0.0;
                saveData.backend = jsonData;
            }
        } catch {
            // noop
        }
        await route.fulfill({ response });
    };

    await popup.route("**/cotizacion/save", routeHandler);

    let folio = null;
    let mensualidad = 0.0;
    let backendJson = null;

    try {
        for (let attempt = 1; attempt <= maxSaveAttempts; attempt += 1) {
            saveData.folio = "";
            saveData.mensualidad = 0.0;
            saveData.backend = null;

            if (hooks?.onProgress) {
                await hooks.onProgress({
                    page: popup,
                    message: attempt === 1 ? "Guardando cotizacion" : `Reintentando guardar cotizacion (${attempt}/${maxSaveAttempts})`,
                }).catch(() => { });
            }

            const clicked = await clickGuardarCotizacion(popup);
            if (!clicked) {
                return {
                    folio: null,
                    rfc_calculado: null,
                    mensualidad: 0.0,
                    importe_pago_13: 0.0,
                    estatus_code: 0,
                    mensaje_det: "Error: No se encontro boton para guardar cotizacion.",
                    logs: [],
                    phase_durations: {},
                };
            }

            let waitedMs = 0;
            while (waitedMs < maxWaitSeconds * 1000 && empty(saveData.folio)) {
                await popup.waitForTimeout(waitIntervalMs);
                waitedMs += waitIntervalMs;
            }

            folio = normalizeString(saveData.folio) || null;
            mensualidad = Number(saveData.mensualidad) || 0.0;
            backendJson = saveData.backend && typeof saveData.backend === "object" ? saveData.backend : null;

            if (folio) break;

            if (attempt < maxSaveAttempts) {
                await esperarOverlayCarga(popup, { timeout: 30000 }).catch(() => { });
            }
        }
    } finally {
        await popup.unroute("**/cotizacion/save", routeHandler).catch(() => { });
    }

    const rfc =
        normalizeString(backendJson?.rfc_calculado) ||
        normalizeString(await popup.locator("#customerRfc").first().inputValue().catch(() => "")) ||
        null;

    const pago13Raw =
        normalizeString(backendJson?.importe_pago_13) ||
        (await popup.locator("#importe_pago_13:visible").first().inputValue().catch(() => "")) ||
        (await popup.locator("#importe_pago_13").first().inputValue().catch(() => "")) ||
        (await readValueByLabel(popup, "importe pago 13")) ||
        (await readValueByLabel(popup, "importe pago 13:"));

    const importe_pago_13 = parseMoneyNumber(pago13Raw);

    if (!folio) {
        const msg = "Error: No se recibio folio del servidor tras el guardado.";
        if (hooks?.onProgress) {
            await hooks.onProgress({ page: popup, message: msg }).catch(() => { });
        }

        return {
            folio: null,
            rfc_calculado: rfc,
            mensualidad: mensualidad || 0.0,
            importe_pago_13: importe_pago_13 || 0.0,
            estatus_code: 0,
            mensaje_det: msg,
            logs: Array.isArray(backendJson?.logs) ? backendJson.logs : [],
            phase_durations: backendJson?.phase_durations && typeof backendJson.phase_durations === "object" ? backendJson.phase_durations : {},
        };
    }

    // Cierra popup de "Cotizacion guardada exitosamente" si aparece.
    await cerrarPopupGuardadoSiExiste(popup).catch(() => { });

    // Si hay folio, abrir impresión (best-effort)
    await popup.locator('a:has-text("Imprimir")').first().click({ timeout: 8000 }).catch(() => { });
    await popup.waitForTimeout(500);
    await popup.locator('a:has-text("Imprimir Cotización"), a:has-text("Imprimir Cotizacion")').first().click({ timeout: 8000 }).catch(() => { });

    return {
        folio,
        rfc_calculado: rfc,
        mensualidad: mensualidad || 0.0,
        importe_pago_13: importe_pago_13 || 0.0,
        estatus_code: 1,
        mensaje_det: "EXITOSO",
        logs: Array.isArray(backendJson?.logs) ? backendJson.logs : [],
        phase_durations: backendJson?.phase_durations && typeof backendJson.phase_durations === "object" ? backendJson.phase_durations : {},
    };
}

async function cerrarPopupGuardadoSiExiste(page, { timeout = 8000 } = {}) {
    const popup = page.locator(".messager-body:visible").first();
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const visible = await popup.isVisible().catch(() => false);
        if (!visible) return false;

        const okBtn = popup.locator('.messager-button a:has-text("Ok"), .messager-button a:has-text("OK"), .messager-button a:has-text("Aceptar")').first();
        const okVisible = await okBtn.isVisible().catch(() => false);
        if (okVisible) {
            await okBtn.click({ timeout: 3000 }).catch(async () => {
                await okBtn.click({ timeout: 3000, force: true }).catch(() => { });
            });
            await page.waitForTimeout(300);
        } else {
            // Si no hay botón detectable, intenta Escape.
            await page.keyboard.press("Escape").catch(() => { });
            await page.waitForTimeout(300);
        }

        const still = await popup.isVisible().catch(() => false);
        if (!still) return true;

        await page.waitForTimeout(250);
    }

    return false;
}

function normalizeAnnuityMonth(value) {
    const raw = normalizeString(value);
    if (!raw) return "";
    const digits = raw.match(/\d+/)?.[0] || "";
    if (digits) return String(Number(digits)).padStart(2, "0");

    const key = raw.toLowerCase();
    const map = {
        enero: "01",
        febrero: "02",
        marzo: "03",
        abril: "04",
        mayo: "05",
        junio: "06",
        julio: "07",
        agosto: "08",
        septiembre: "09",
        setiembre: "09",
        octubre: "10",
        noviembre: "11",
        diciembre: "12",
    };

    return map[key] || raw;
}

function isBadGatewayText(value) {
    const text = String(value || "").toLowerCase();
    return text.includes("502 bad gateway") || text.includes("bad gateway");
}

async function waitUntilEnabled(page, selector, { timeout = 15000, pollMs = 250 } = {}) {
    const hooks = page?.__rpaHooks;

    const progressMessage = `Esperando ${selector} habilitado`;
    const started = Date.now();
    let lastProgressAt = 0;

    const emitProgress = async () => {
        if (!hooks?.onProgress) return;
        const now = Date.now();
        if (now - lastProgressAt < 1000) return;
        lastProgressAt = now;
        await hooks.onProgress({ page, message: progressMessage }).catch(() => { });
    };

    await emitProgress();

    const isEnabled = (sel) => {
        const candidates = Array.from(document.querySelectorAll(sel));
        const visible = candidates.find((el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
            // offsetParent null puede ser fixed/absolute; aún así sirve como señal rápida
            return true;
        });
        if (!visible) return { ok: false, reason: "not_found" };

        const disabledProp = Boolean(visible.disabled);
        const disabledAttr = visible.getAttribute?.("disabled") !== null;
        const ariaDisabled = String(visible.getAttribute?.("aria-disabled") || "").toLowerCase() === "true";
        const readOnly = Boolean(visible.readOnly) || visible.getAttribute?.("readonly") !== null;

        const ok = !disabledProp && !disabledAttr && !ariaDisabled && !readOnly;
        return {
            ok,
            disabledProp,
            disabledAttr,
            ariaDisabled,
            readOnly,
            tag: visible.tagName,
        };
    };

    try {
        await page.waitForFunction(isEnabled, selector, { timeout, polling: pollMs });
        return true;
    } catch (e) {
        const state = await page.evaluate(isEnabled, selector).catch(() => null);
        throw new Error(
            `Timeout esperando ${selector} habilitado (${timeout}ms). Estado: ${state ? JSON.stringify(state) : "n/a"}`
        );
    } finally {
        if (Date.now() - started > 900) {
            await emitProgress();
        }
    }
}

function createBadGatewayWatcher(page, getStage) {
    let done = false;
    let rejectFn;

    const promise = new Promise((_, reject) => {
        rejectFn = reject;
    });

    const fail = (message) => {
        if (done) return;
        done = true;
        const stage = typeof getStage === "function" ? getStage() : "";
        const url = page && typeof page.url === "function" ? page.url() : "";
        rejectFn(new Error(`${message}${stage ? ` | etapa=${stage}` : ""}${url ? ` | URL: ${url}` : ""}`));
    };

    const onResponse = (resp) => {
        try {
            const status = resp.status();
            if (status === 502) {
                fail(`502 Bad Gateway detectado en respuesta: ${resp.url()}`);
            }
        } catch { }
    };

    const onDomContentLoaded = async () => {
        try {
            const title = await page.title().catch(() => "");
            if (isBadGatewayText(title)) {
                fail(`502 Bad Gateway detectado (title)`);
                return;
            }

            const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
            if (isBadGatewayText(bodyText)) {
                fail(`502 Bad Gateway detectado (body)`);
            }
        } catch { }
    };

    page.on("response", onResponse);
    page.on("domcontentloaded", onDomContentLoaded);

    const dispose = () => {
        if (done) return;
        done = true;
        page.off("response", onResponse);
        page.off("domcontentloaded", onDomContentLoaded);
    };

    return { promise, dispose };
}

/* =========================
   FLUJO PRINCIPAL (PARAMETRIZABLE)
========================= */
async function runCetelemFlow(payload, hooks = {}) {
    const data = payload || DEFAULT_DATA;

    const browser = await BrowserManager.getBrowser();
    const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
    });

    const page = await context.newPage();
    let popup;
    let currentStage = "inicializando";
    let badGatewayWatcher = createBadGatewayWatcher(page, () => currentStage);

    const stage = async (name, fn) => {
        currentStage = name;
        if (hooks.onStage) {
            await hooks.onStage({ name });
        }
        return Promise.race([Promise.resolve().then(fn), badGatewayWatcher.promise]);
    };

    try {
        popup = await stage("login", async () => {
            const pop = await etapaLogin(page);
            await etapaAbrirCotizador(pop);
            return pop;
        });

        // Hacer hooks accesibles desde helpers (esperarYSeleccionar/esperarYLlenar/etc.)
        page.__rpaHooks = hooks;
        popup.__rpaHooks = hooks;

        // Cambia el watcher al popup ya que es donde vive el cotizador.
        badGatewayWatcher.dispose();
        badGatewayWatcher = createBadGatewayWatcher(popup, () => currentStage);

        const nivelDetalle = normalizeString(data?.nivel_detalle ?? data?.nivelDetalle).toLowerCase();
        const isSeguros = nivelDetalle === "seguros";
        const isGuardarCotizacion = nivelDetalle === "guardar_cotizacion";
        const skipCliente = isSeguros;

        if (!skipCliente && data?.cliente && Object.keys(data.cliente).length) {
            await stage("cliente", async () => etapaCliente(popup, data));
        }

        if (data?.vehiculo && Object.keys(data.vehiculo).length) {
            await stage("vehiculo", async () => {
                await etapaVehiculo(popup, data);
                await etapaRecuperarPrecioVehiculo(popup);
            });
        }

        // En algunos casos, el portal habilita campos de seguro (como CP) solo después de definir crédito.
        // Por eso, en modo "seguros" no se omite crédito si viene payload.
        if (data?.credito && Object.keys(data.credito).length) {
            await stage("credito", async () => etapaCredito(popup, data));
        }

        let seguroResult = null;
        if (isSeguros || (data?.seguro && Object.keys(data.seguro).length)) {
            seguroResult = await stage("seguro", async () => etapaSeguro(popup, data));
        }

        let guardarResult = null;
        if (isGuardarCotizacion) {
            guardarResult = await stage("guardar_cotizacion", async () => etapaGuardarCotizacion(popup, data));
        }

        await stage("finalizando", async () => { });

        return {
            ok: true,
            result: isGuardarCotizacion ? guardarResult : seguroResult,
        };
    } catch (error) {
        if (hooks.onErrorScreenshot) {
            try {
                await hooks.onErrorScreenshot({ page: popup || page, stage: currentStage });
            } catch { }
        }
        throw error;
    } finally {
        badGatewayWatcher.dispose();
        if (popup && popup !== page) await popup.close().catch(() => { });
        await page.close().catch(() => { });
        await context.close().catch(() => { });
    }
}

async function runCetelemFlowWithRetries(payload, hooks = {}) {
    const max = Number.isInteger(MAX_REINTENTOS) && MAX_REINTENTOS > 0 ? MAX_REINTENTOS : 1;

    let lastError = null;
    for (let attempt = 1; attempt <= max; attempt += 1) {
        try {
            if (attempt > 1) {
                logger.warn(`[flow] reintento ${attempt}/${max}`);
            }
            return await runCetelemFlow(payload, hooks);
        } catch (error) {
            lastError = error;
            logger.warn(`[flow] fallo intento ${attempt}/${max}: ${error?.message || error}`);
            if (attempt < max) {
                await BrowserManager.restart().catch(() => { });
                await new Promise((r) => setTimeout(r, 500 * attempt));
                continue;
            }
        }
    }

    throw lastError;
}

module.exports = {
    DEFAULT_DATA,
    runCetelemFlow,
    runCetelemFlowWithRetries,
};

if (require.main === module) {
    runCetelemFlow(DEFAULT_DATA)
        .then((result) => {
            console.log("RESULTADO:", result);
            process.exit(0);
        })
        .catch((error) => {
            console.error("ERROR:", error);
            process.exit(1);
        });
}
