const path = require("path");
const BrowserManager = require("../../../RPA-NODE-V2/core/browser-manager");
const { LOGIN_URL, SCREENSHOTS_DIR, USUARIO, PASSWORD } = require("../../../RPA-NODE-V2/config");

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

function normalizeString(value) {
    return String(value).trim();
}

function normalizeUppercase(value) {
    return normalizeString(value).toUpperCase();
}

function normalizeCheckbox(value) {
    if (typeof value === "boolean") {
        return value;
    }

    const normalized = normalizeString(value).toLowerCase();
    return ["1", "true", "si", "sí", "y", "yes", "on"].includes(normalized);
}

function normalizeBirthDate(value) {
    const raw = normalizeString(value);
    const digits = raw.match(/\d/g)?.join("") || "";

    if (digits.length !== 8) {
        throw new Error(`customerBirthDate invalida (se esperan 8 digitos): ${raw}`);
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

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
    return { day, month, year };
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

        if (/[y]/i.test(got)) {
            continue;
        }

        const gotParsed = parseDdMmYyyy(got);

        if (expectedParsed && gotParsed) {
            if (
                expectedParsed.day === gotParsed.day
                && expectedParsed.month === gotParsed.month
                && expectedParsed.year === gotParsed.year
            ) {
                return got;
            }
        }
    }

    const lastValue = await page.locator(selector).inputValue().catch(() => "");
    throw new Error(
        `No se pudo setear fecha de nacimiento. Valor final: "${lastValue}" (esperado: "${normalizeBirthDate(value)}")`
    );
}

async function setInputValueOnce(page, selector, value) {
    await page.waitForSelector(selector, { state: "visible", timeout: 15000 });

    await page.$eval(
        selector,
        (el, nextValue) => {
            el.value = "";
            el.value = String(nextValue ?? "");
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
        },
        value
    );
}

async function ensureSelectValue(page, selector, value) {
    const desired = normalizeString(value);

    await page.waitForSelector(selector, { state: "visible", timeout: 20000 });

    await page.waitForFunction(
        (selector) => {
            const el = document.querySelector(selector);
            return !!el && !el.disabled && el.options.length > 1;
        },
        selector,
        { timeout: 30000 }
    );

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

    await page.waitForFunction(
        ({ selector, value }) => {
            const el = document.querySelector(selector);
            return !!el && el.value === value;
        },
        { selector, value: desired },
        { timeout: 10000 }
    );
}



async function dismissRfcErrorDialog(page) {
    const dialog = page.locator("div.messager-body.window-body", { hasText: "Error al generar RFC" }).first();

    const isVisible = await dialog.isVisible().catch(() => false);

    if (!isVisible) {
        await dialog.waitFor({ state: "visible", timeout: 1500 }).catch(() => { });
    }

    if (!(await dialog.isVisible().catch(() => false))) {
        return false;
    }

    const okButton = dialog.locator("a.l-btn", { hasText: "Ok" }).first();
    await okButton.click({ timeout: 5000 }).catch(() => { });
    await page.waitForTimeout(500);

    return true;
}

async function runCetelemFlow(payload) {
    const browser = await BrowserManager.getBrowser();
    const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
    });

    const page = await context.newPage();
    let popup;

    try {
        await page.goto(LOGIN_URL, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        await page.fill('input[name="userName"]', USUARIO);
        await clickConOverlay(page, "#btnEntrar", { timeout: 90000 });

        await page.fill('input[name="userPassword"]', PASSWORD);

        const popupPromise = page.waitForEvent("popup", { timeout: 60000 });
        await clickConOverlay(page, "#btnEntrar", { timeout: 90000 });

        popup = await popupPromise;
        await popup.waitForLoadState("domcontentloaded", { timeout: 30000 });

        await popup.waitForURL("https://cck.creditoclick.com.mx/cotizador/01-cotizacion.html", {
            timeout: 30000,
        });

        const quoteBreadcrumb = '[id="18n_breadcrumbs_quote"]';

        await popup.waitForSelector(quoteBreadcrumb, {
            state: "visible",
            timeout: 15000,
        });
        await popup.locator(quoteBreadcrumb).click({ timeout: 15000, force: true });
        await popup.waitForTimeout(1000);

        const cliente = payload?.cliente;
        const vehiculo = payload?.vehiculo;
        const credito = payload?.credito;
        const seguro = payload?.seguro;

        if (cliente) {
            const customerType = normalizeString(cliente.customerType || "");

            console.log(cliente);

            if (!customerType) throw new Error("Falta customerType");
            if (empty(cliente.genero)) throw new Error("Falta campo requerido: genero");
            if (empty(cliente.customerTitle)) throw new Error("Falta campo requerido: customerTitle");
            if (empty(cliente.customerName)) throw new Error("Falta campo requerido: customerName");
            if (empty(cliente.customerAPaterno)) throw new Error("Falta campo requerido: customerAPaterno");
            if (empty(cliente.customerBirthDate)) throw new Error("Falta campo requerido: customerBirthDate");
            if (empty(cliente.customerRfc)) throw new Error("Falta campo requerido: customerRfc");

            if (customerType === "2") {
                if (empty(cliente.customerRazonSocial)) {
                    throw new Error("Falta campo requerido: customerRazonSocial");
                }
            }

            if (customerType === "3") {
                if (empty(cliente.customerNumUnidades)) {
                    throw new Error("Falta campo requerido: customerNumUnidades");
                }

                if (empty(cliente.customerFirstCredit)) {
                    throw new Error("Falta campo requerido: customerFirstCredit");
                }
            }

            console.log("Seleccionando customerType:", customerType);
            await popup.waitForSelector("#customerType", { state: "visible", timeout: 15000 });
            await popup.selectOption("#customerType", customerType);

            await popup.waitForTimeout(1000);

            console.log("Esperando #genero...");
            await popup.waitForSelector("#genero", { state: "visible", timeout: 15000 });

            console.log("Seleccionando genero:", cliente.genero);
            await popup.selectOption("#genero", normalizeString(cliente.genero));

            await popup.waitForTimeout(1000);

            console.log("Esperando #customerTitle...");
            await popup.waitForSelector("#customerTitle", { state: "visible", timeout: 15000 });

            console.log("Seleccionando customerTitle:", cliente.customerTitle);
            await popup.selectOption("#customerTitle", normalizeString(cliente.customerTitle));

            await popup.waitForTimeout(1000);

            console.log("Esperando #customerName...");
            await popup.waitForSelector("#customerName", { state: "visible", timeout: 15000 });

            console.log("Llenando customerName:", cliente.customerName);
            await popup.fill("#customerName", normalizeUppercase(cliente.customerName));

            await popup.waitForTimeout(1000);

            console.log("Esperando #customerAPaterno...");
            await popup.waitForSelector("#customerAPaterno", { state: "visible", timeout: 15000 });

            console.log("Llenando customerAPaterno:", cliente.customerAPaterno);
            await popup.fill("#customerAPaterno", normalizeUppercase(cliente.customerAPaterno));

            await popup.waitForTimeout(1000);

            if (!empty(cliente.customerAMaterno)) {
                console.log("Esperando #customerAMaterno...");
                await popup.waitForSelector("#customerAMaterno", { state: "visible", timeout: 15000 });

                console.log("Llenando customerAMaterno:", cliente.customerAMaterno);
                await popup.fill("#customerAMaterno", normalizeUppercase(cliente.customerAMaterno));

                await popup.waitForTimeout(1000);
            }

            console.log("Esperando #customerBirthDate...");
            await popup.waitForSelector("#customerBirthDate", { state: "visible", timeout: 15000 });

            console.log("Escribiendo customerBirthDate con mascara:", cliente.customerBirthDate);
            const valorFecha = await fillBirthDateMasked(popup, "#customerBirthDate", cliente.customerBirthDate);
            console.log("Fecha final en input:", valorFecha);

            await popup.waitForTimeout(1000);
            console.log("Esperando #customerRfc...");
            await popup.waitForSelector("#customerRfc", { state: "visible", timeout: 15000 });

            console.log("Llenando customerRfc:", cliente.customerRfc);
            await popup.fill("#customerRfc", normalizeUppercase(cliente.customerRfc));

            await popup.waitForTimeout(1000);

            if (customerType === "2") {
                console.log("Esperando #customerRazonSocial...");
                await popup.waitForSelector("#customerRazonSocial", { state: "visible", timeout: 15000 });

                console.log("Llenando customerRazonSocial:", cliente.customerRazonSocial);
                await popup.fill("#customerRazonSocial", normalizeUppercase(cliente.customerRazonSocial));

                await popup.waitForTimeout(1000);
            }

            if (customerType === "3") {
                console.log("Esperando #customerNumUnidades...");
                await popup.waitForSelector("#customerNumUnidades", { state: "visible", timeout: 15000 });

                console.log("Seleccionando customerNumUnidades:", cliente.customerNumUnidades);
                await popup.selectOption("#customerNumUnidades", normalizeString(cliente.customerNumUnidades));

                await popup.waitForTimeout(1000);

                console.log("Esperando #customerFirstCredit...");
                await popup.waitForSelector("#customerFirstCredit", { state: "visible", timeout: 15000 });

                console.log("Seleccionando customerFirstCredit:", cliente.customerFirstCredit);
                await popup.selectOption("#customerFirstCredit", normalizeString(cliente.customerFirstCredit));

                await popup.waitForTimeout(1000);
            }
        }
        if (vehiculo) {
            console.log(vehiculo);

            if (empty(vehiculo.vehicleType)) throw new Error("Falta campo requerido: vehicleType");
            if (empty(vehiculo.insuranceVehicleUse)) throw new Error("Falta campo requerido: insuranceVehicleUse");
            if (empty(vehiculo.vehicleBrand)) throw new Error("Falta campo requerido: vehicleBrand");
            if (empty(vehiculo.vehicleAnio)) throw new Error("Falta campo requerido: vehicleAnio");
            if (empty(vehiculo.vehicleModel)) throw new Error("Falta campo requerido: vehicleModel");
            if (empty(vehiculo.vehicleVersion)) throw new Error("Falta campo requerido: vehicleVersion");

            console.log("Esperando #vehicleType...");
            await popup.waitForSelector("#vehicleType", { state: "visible", timeout: 15000 });

            console.log("Seleccionando vehicleType:", vehiculo.vehicleType);
            await popup.selectOption("#vehicleType", normalizeString(vehiculo.vehicleType));

            await popup.waitForTimeout(1000);

            if (!empty(vehiculo.seminuevoCertificado)) {
                const desired = normalizeCheckbox(vehiculo.seminuevoCertificado);

                console.log("Esperando #18n_seminuevo_certificado...");
                const locator = popup.locator('input[type="checkbox"][id="18n_seminuevo_certificado"]').first();
                await locator.waitFor({ state: "attached", timeout: 15000 });

                const checked = await locator.isChecked().catch(() => false);
                console.log("Estado actual seminuevoCertificado:", checked, "estado deseado:", desired);

                if (checked !== desired) {
                    await locator.click().catch(() => { });
                }

                await popup.waitForTimeout(1000);
            }

            console.log("Esperando #insuranceVehicleUse...");
            await popup.waitForSelector("#insuranceVehicleUse", { state: "visible", timeout: 15000 });

            console.log("Seleccionando insuranceVehicleUse:", vehiculo.insuranceVehicleUse);
            await popup.selectOption("#insuranceVehicleUse", normalizeString(vehiculo.insuranceVehicleUse));

            await popup.waitForTimeout(1000);

            if (!empty(vehiculo.tipoCarga)) {
                console.log("Esperando #tipoCarga...");
                await popup.waitForSelector("#tipoCarga", { state: "visible", timeout: 15000 });

                console.log("Seleccionando tipoCarga:", vehiculo.tipoCarga);
                await popup.selectOption("#tipoCarga", normalizeString(vehiculo.tipoCarga));

                await popup.waitForTimeout(1000);
            }

            if (!empty(vehiculo.servicio)) {
                console.log("Esperando #servicio...");
                await popup.waitForSelector("#servicio", { state: "visible", timeout: 15000 });

                console.log("Llenando servicio:", vehiculo.servicio);
                await popup.fill("#servicio", normalizeUppercase(vehiculo.servicio));

                await popup.waitForTimeout(1000);
            }

            console.log("Esperando #vehicleBrand...");
            await popup.waitForSelector("#vehicleBrand", { state: "visible", timeout: 15000 });

            console.log("Esperando opción de vehicleBrand:", vehiculo.vehicleBrand);
            await popup.waitForFunction((value) => {
                const el = document.querySelector("#vehicleBrand");
                if (!el) return false;
                return Array.from(el.options).some(opt => opt.value === value);
            }, normalizeString(vehiculo.vehicleBrand), { timeout: 15000 });

            console.log("Seleccionando vehicleBrand:", vehiculo.vehicleBrand);
            await popup.selectOption("#vehicleBrand", normalizeString(vehiculo.vehicleBrand));

            await popup.waitForTimeout(1000);

            console.log("Esperando #vehicleAnio...");
            await popup.waitForSelector("#vehicleAnio", { state: "visible", timeout: 15000 });

            console.log("Esperando opción de vehicleAnio:", vehiculo.vehicleAnio);
            await popup.waitForFunction((value) => {
                const el = document.querySelector("#vehicleAnio");
                if (!el) return false;
                return Array.from(el.options).some(opt => opt.value === value);
            }, normalizeString(vehiculo.vehicleAnio), { timeout: 15000 });

            console.log("Seleccionando vehicleAnio:", vehiculo.vehicleAnio);
            await popup.selectOption("#vehicleAnio", normalizeString(vehiculo.vehicleAnio));

            await popup.waitForTimeout(1000);

            console.log("Esperando #vehicleModel...");
            await popup.waitForSelector("#vehicleModel", { state: "visible", timeout: 15000 });

            console.log("Esperando opción de vehicleModel:", vehiculo.vehicleModel);
            await popup.waitForFunction((value) => {
                const el = document.querySelector("#vehicleModel");
                if (!el) return false;
                return Array.from(el.options).some(opt => opt.value === value);
            }, normalizeString(vehiculo.vehicleModel), { timeout: 15000 });

            console.log("Seleccionando vehicleModel:", vehiculo.vehicleModel);
            await popup.selectOption("#vehicleModel", normalizeString(vehiculo.vehicleModel));

            let valorModelo = await popup.locator("#vehicleModel").inputValue().catch(() => null);
            console.log("vehicleModel después de seleccionar:", valorModelo);

            await popup.waitForTimeout(1000);

            valorModelo = await popup.locator("#vehicleModel").inputValue().catch(() => null);
            console.log("vehicleModel después de esperar:", valorModelo);

            console.log("Esperando #vehicleVersion...");
            await popup.waitForSelector("#vehicleVersion", { state: "visible", timeout: 15000 });

            console.log("Esperando opción de vehicleVersion:", vehiculo.vehicleVersion);
            await popup.waitForFunction((value) => {
                const el = document.querySelector("#vehicleVersion");
                if (!el) return false;
                return Array.from(el.options).some(opt => opt.value === value);
            }, normalizeString(vehiculo.vehicleVersion), { timeout: 15000 });

            console.log("Seleccionando vehicleVersion:", vehiculo.vehicleVersion);
            await popup.selectOption("#vehicleVersion", normalizeString(vehiculo.vehicleVersion));

            const valorVersion = await popup.locator("#vehicleVersion").inputValue().catch(() => null);
            console.log("vehicleVersion final:", valorVersion);

            await popup.waitForTimeout(4000);
            if (!empty(vehiculo.vehicleAccesories)) {
                console.log("Llenando #vehicleAccesories...");

                await setInputValueOnce(popup, "#vehicleAccesories", normalizeUppercase(vehiculo.vehicleAccesories));
                await popup.waitForTimeout(500);
                await popup.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => { });

                const brandNow = await popup.locator("#vehicleBrand").inputValue().catch(() => null);
                const anioNow = await popup.locator("#vehicleAnio").inputValue().catch(() => null);
                const modelNow = await popup.locator("#vehicleModel").inputValue().catch(() => null);
                const versionNow = await popup.locator("#vehicleVersion").inputValue().catch(() => null);

                if (brandNow !== normalizeString(vehiculo.vehicleBrand)) {
                    console.log("Se reseteó vehicleBrand; re-seleccionando...");
                    await ensureSelectValue(popup, "#vehicleBrand", vehiculo.vehicleBrand);
                    await popup.waitForTimeout(800);
                }

                if (anioNow !== normalizeString(vehiculo.vehicleAnio)) {
                    console.log("Se reseteó vehicleAnio; re-seleccionando...");
                    await ensureSelectValue(popup, "#vehicleAnio", vehiculo.vehicleAnio);
                    await popup.waitForTimeout(800);
                }

                if (modelNow !== normalizeString(vehiculo.vehicleModel)) {
                    console.log("Se reseteó vehicleModel; re-seleccionando...");
                    await ensureSelectValue(popup, "#vehicleModel", vehiculo.vehicleModel);
                    await popup.waitForTimeout(800);
                }

                if (versionNow !== normalizeString(vehiculo.vehicleVersion)) {
                    console.log("Se reseteó vehicleVersion; re-seleccionando...");
                    await ensureSelectValue(popup, "#vehicleVersion", vehiculo.vehicleVersion);
                    await popup.waitForTimeout(800);
                }


            }


            if (!empty(vehiculo.vehicleIsConverted)) {
                const desired = normalizeCheckbox(vehiculo.vehicleIsConverted);

                console.log("Esperando #vehicleIsConverted...");
                const locator = popup.locator("#vehicleIsConverted").first();
                await locator.waitFor({ state: "attached", timeout: 15000 });

                const checked = await locator.isChecked().catch(() => false);
                console.log("Estado actual vehicleIsConverted:", checked, "estado deseado:", desired);

                if (checked !== desired) {
                    await locator.click().catch(() => { });
                }

                await popup.waitForTimeout(1000);

                let modelValue = await popup.locator("#vehicleModel").inputValue().catch(() => null);
                let versionValue = await popup.locator("#vehicleVersion").inputValue().catch(() => null);
                console.log("Después de vehicleIsConverted -> vehicleModel:", modelValue);
                console.log("Después de vehicleIsConverted -> vehicleVersion:", versionValue);
            }

            if (!empty(vehiculo.vehicleAccesoriesAmount)) {
                console.log("Esperando #vehicleAccesoriesAmount...");
                await popup.waitForSelector("#vehicleAccesoriesAmount", { state: "visible", timeout: 15000 });

                console.log("Llenando vehicleAccesoriesAmount:", vehiculo.vehicleAccesoriesAmount);
                await popup.fill("#vehicleAccesoriesAmount", normalizeString(vehiculo.vehicleAccesoriesAmount));

                await popup.waitForTimeout(1000);

                let modelValue = await popup.locator("#vehicleModel").inputValue().catch(() => null);
                let versionValue = await popup.locator("#vehicleVersion").inputValue().catch(() => null);
                console.log("Después de vehicleAccesoriesAmount -> vehicleModel:", modelValue);
                console.log("Después de vehicleAccesoriesAmount -> vehicleVersion:", versionValue);
            }

            if (!empty(vehiculo.vehicleChargeStationAmount)) {
                console.log("Esperando #vehicleChargeStationAmount...");
                const locator = popup.locator("#vehicleChargeStationAmount").first();

                if (await locator.isVisible().catch(() => false)) {
                    console.log("Llenando vehicleChargeStationAmount:", vehiculo.vehicleChargeStationAmount);
                    await locator.fill(normalizeString(vehiculo.vehicleChargeStationAmount));
                    await popup.waitForTimeout(1000);

                    let modelValue = await popup.locator("#vehicleModel").inputValue().catch(() => null);
                    let versionValue = await popup.locator("#vehicleVersion").inputValue().catch(() => null);
                    console.log("Después de vehicleChargeStationAmount -> vehicleModel:", modelValue);
                    console.log("Después de vehicleChargeStationAmount -> vehicleVersion:", versionValue);
                }
            }

            if (!empty(vehiculo.vehicleExtendedWarrantyOption)) {
                const selector = `input[type="radio"][name="vehicleExtendedWarrantyOption"][value="${normalizeString(vehiculo.vehicleExtendedWarrantyOption)}"]`;

                console.log("Esperando radio vehicleExtendedWarrantyOption:", selector);
                await popup.waitForSelector(selector, { state: "visible", timeout: 15000 });

                console.log("Seleccionando vehicleExtendedWarrantyOption:", vehiculo.vehicleExtendedWarrantyOption);
                await popup.locator(selector).first().check().catch(async () => {
                    await popup.locator(selector).first().click().catch(() => { });
                });

                await popup.waitForTimeout(1000);

                let modelValue = await popup.locator("#vehicleModel").inputValue().catch(() => null);
                let versionValue = await popup.locator("#vehicleVersion").inputValue().catch(() => null);
                console.log("Después de vehicleExtendedWarrantyOption -> vehicleModel:", modelValue);
                console.log("Después de vehicleExtendedWarrantyOption -> vehicleVersion:", versionValue);
            }

            if (!empty(vehiculo.gapInsurance)) {
                const selector = `input[type="radio"][name="gapInsurance"][value="${normalizeUppercase(vehiculo.gapInsurance)}"]`;

                console.log("Esperando radio gapInsurance:", selector);
                await popup.waitForSelector(selector, { state: "visible", timeout: 15000 });

                console.log("Seleccionando gapInsurance:", vehiculo.gapInsurance);
                await popup.locator(selector).first().check().catch(async () => {
                    await popup.locator(selector).first().click().catch(() => { });
                });

                await popup.waitForTimeout(1000);
                await popup.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => { });

                console.log("Esperando reconstrucción de cascada después de gapInsurance...");
                await waitVehicleCascadeReady(popup);

                console.log("Reaplicando cascada después de gapInsurance...");
                await reapplyVehicleCascade(popup, vehiculo);

                let modelValue = await popup.locator("#vehicleModel").inputValue().catch(() => null);
                let versionValue = await popup.locator("#vehicleVersion").inputValue().catch(() => null);
                console.log("Después de gapInsurance -> vehicleModel:", modelValue);
                console.log("Después de gapInsurance -> vehicleVersion:", versionValue);
            }

            if (!empty(vehiculo.gapInsurancePlan)) {
                console.log("Esperando #gapInsurancePlan...");
                await popup.waitForSelector("#gapInsurancePlan", { state: "visible", timeout: 15000 });

                console.log("Seleccionando gapInsurancePlan:", vehiculo.gapInsurancePlan);
                await popup.selectOption("#gapInsurancePlan", normalizeString(vehiculo.gapInsurancePlan));

                await popup.waitForTimeout(1000);

                let modelValue = await popup.locator("#vehicleModel").inputValue().catch(() => null);
                let versionValue = await popup.locator("#vehicleVersion").inputValue().catch(() => null);
                console.log("Después de gapInsurancePlan -> vehicleModel:", modelValue);
                console.log("Después de gapInsurancePlan -> vehicleVersion:", versionValue);
            }

            if (!empty(vehiculo.gapInsuranceType)) {
                const selector = `input[type="radio"][name="gapInsuranceType"][value="${normalizeUppercase(vehiculo.gapInsuranceType)}"]`;

                console.log("Esperando radio gapInsuranceType:", selector);
                await popup.waitForSelector(selector, { state: "visible", timeout: 15000 });

                console.log("Seleccionando gapInsuranceType:", vehiculo.gapInsuranceType);
                await popup.locator(selector).first().check().catch(async () => {
                    await popup.locator(selector).first().click().catch(() => { });
                });

                await popup.waitForTimeout(1000);

                let modelValue = await popup.locator("#vehicleModel").inputValue().catch(() => null);
                let versionValue = await popup.locator("#vehicleVersion").inputValue().catch(() => null);
                console.log("Después de gapInsuranceType -> vehicleModel:", modelValue);
                console.log("Después de gapInsuranceType -> vehicleVersion:", versionValue);
            }
        }
        await popup.waitForTimeout(1000);

        if (credito) {
            if (!empty(credito.creditDepositPercent)) {
                await popup.waitForSelector("#creditDepositPercent", { state: "visible", timeout: 15000 });
                await popup.fill("#creditDepositPercent", normalizeString(credito.creditDepositPercent));
                await popup.waitForTimeout(1000);
            }

            if (!empty(credito.creditDepositAmount)) {
                await popup.waitForSelector("#creditDepositAmount", { state: "visible", timeout: 15000 });
                await popup.fill("#creditDepositAmount", normalizeString(credito.creditDepositAmount));
                await popup.waitForTimeout(1000);
            }

            if (!empty(credito.creditDepositPlan)) {
                await popup.waitForSelector("#creditDepositPlan", { state: "visible", timeout: 15000 });
                await popup.selectOption("#creditDepositPlan", { label: normalizeString(credito.creditDepositPlan) }).catch(async () => {
                    await popup.selectOption("#creditDepositPlan", normalizeString(credito.creditDepositPlan));
                });
                await popup.waitForTimeout(1000);
            }

            if (!empty(credito.creditDepositTerm)) {
                await popup.waitForSelector("#creditDepositTerm", { state: "visible", timeout: 15000 });
                await popup.selectOption("#creditDepositTerm", { label: normalizeString(credito.creditDepositTerm) }).catch(async () => {
                    await popup.selectOption("#creditDepositTerm", normalizeString(credito.creditDepositTerm));
                });
                await popup.waitForTimeout(1000);
            }
        }

        if (seguro) {
            if (!empty(seguro.insuranceCoverage)) {
                await popup.waitForSelector("#insuranceCoverage", { state: "visible", timeout: 15000 });
                await popup.selectOption("#insuranceCoverage", { label: normalizeString(seguro.insuranceCoverage) }).catch(async () => {
                    await popup.selectOption("#insuranceCoverage", normalizeString(seguro.insuranceCoverage));
                });
                await popup.waitForTimeout(1000);
            }

            if (empty(seguro.insuranceCP)) throw new Error("Falta campo requerido: insuranceCP");
            if (empty(seguro.insuranceRecruitment)) throw new Error("Falta campo requerido: insuranceRecruitment");
            if (empty(seguro.insuranceType)) throw new Error("Falta campo requerido: insuranceType");
            if (empty(seguro.insurancePaymentTermRemnant)) throw new Error("Falta campo requerido: insurancePaymentTermRemnant");
            if (empty(seguro.insuranceCoverageLorant)) throw new Error("Falta campo requerido: insuranceCoverageLorant");

            await popup.waitForSelector("#insuranceCP", { state: "visible", timeout: 15000 });
            await popup.fill("#insuranceCP", normalizeString(seguro.insuranceCP));
            await popup.waitForTimeout(1000);

            await popup.waitForSelector("#insuranceRecruitment", { state: "visible", timeout: 15000 });
            await popup.selectOption("#insuranceRecruitment", { label: normalizeString(seguro.insuranceRecruitment) }).catch(async () => {
                await popup.selectOption("#insuranceRecruitment", normalizeString(seguro.insuranceRecruitment));
            });
            await popup.waitForTimeout(1000);

            await popup.waitForSelector("#insuranceType", { state: "visible", timeout: 15000 });
            await popup.selectOption("#insuranceType", { label: normalizeString(seguro.insuranceType) }).catch(async () => {
                await popup.selectOption("#insuranceType", normalizeString(seguro.insuranceType));
            });
            await popup.waitForTimeout(1000);

            if (!empty(seguro.insuranceTermRemnant)) {
                await popup.waitForSelector("#insuranceTermRemnant", { state: "visible", timeout: 15000 });
                await popup.selectOption("#insuranceTermRemnant", { label: normalizeString(seguro.insuranceTermRemnant) }).catch(async () => {
                    await popup.selectOption("#insuranceTermRemnant", normalizeString(seguro.insuranceTermRemnant));
                });
                await popup.waitForTimeout(1000);
            }

            await popup.waitForSelector("#insurancePaymentTermRemnant", { state: "visible", timeout: 15000 });
            await popup.selectOption("#insurancePaymentTermRemnant", { label: normalizeString(seguro.insurancePaymentTermRemnant) }).catch(async () => {
                await popup.selectOption("#insurancePaymentTermRemnant", normalizeString(seguro.insurancePaymentTermRemnant));
            });
            await popup.waitForTimeout(1000);

            await popup.waitForSelector("#insuranceCoverageLorant", { state: "visible", timeout: 15000 });
            await popup.selectOption("#insuranceCoverageLorant", { label: normalizeUppercase(seguro.insuranceCoverageLorant) }).catch(async () => {
                await popup.selectOption("#insuranceCoverageLorant", normalizeUppercase(seguro.insuranceCoverageLorant));
            });
            await popup.waitForTimeout(1000);
        }

        await dismissRfcErrorDialog(popup);

        const screenshotPath = path.join(
            SCREENSHOTS_DIR,
            `playwright_${Date.now()}.png`
        );

        await popup.screenshot({
            path: screenshotPath,
            type: "png",
            fullPage: true,
        });

        return {
            ok: true,
            screenshotPath,
        };
    } finally {
        if (popup) await popup.close().catch(() => { });
        await page.close().catch(() => { });
        await context.close().catch(() => { });
    }
}

async function runCetelemFlowWithRetries(payload, options) {
    return runCetelemFlow(payload, options);
}

module.exports = { runCetelemFlow, runCetelemFlowWithRetries };
