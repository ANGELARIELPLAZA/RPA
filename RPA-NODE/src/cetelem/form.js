const { CLIENTE_BASE_FIELDS, CLIENTE_FIELDS_BY_TYPE, CREDITO_FIELDS, SEGURO_FIELDS, VEHICULO_FIELDS } = require("./fields");
const logger = require("../core/logger");

const INSURANCE_CARRIER_ALIASES = {
    CHUBB: "ABA",
    ABA: "ABA",
    QUALITAS: "QUALITAS",
    MAPFRE: "MAPFRE",
    GNP: "GNP",
    ZURICH: "ZURICH",
    HDI: "HDI",
    INBURSA: "INBURSA",
};

function getNestedValue(object, key) {
    return key.split(".").reduce((current, part) => current?.[part], object);
}

function isEmptyValue(value) {
    return value === undefined || value === null || String(value).trim() === "";
}

function normalizeMoneyValue(value) {
    return String(value ?? "")
        .trim()
        .replace(/[^0-9.-]/g, "");
}

function parseMoneyValue(value) {
    const normalized = normalizeMoneyValue(value);
    if (!normalized) {
        return null;
    }

    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : null;
}

async function resolveFieldSelector(page, field) {
    if (field.selector) {
        return field.selector;
    }

    const timeout = field.timeout ?? 15000;

    if (field.labelFor) {
        const label = page.locator(`label[for="${field.labelFor}"]`).first();
        await label.waitFor({ state: "visible", timeout });

        const targetId = await label.getAttribute("for");
        if (!targetId) {
            throw new Error(`El label de ${field.key} no tiene atributo "for"`);
        }

        return `#${targetId}`;
    }

    if (field.labelText) {
        const label = page.locator("label", { hasText: field.labelText }).first();
        await label.waitFor({ state: "visible", timeout });

        const targetId = await label.getAttribute("for");
        if (!targetId) {
            throw new Error(`El label "${field.labelText}" no tiene atributo "for"`);
        }

        return `#${targetId}`;
    }

    throw new Error(`El campo ${field.key} no tiene selector, labelFor ni labelText`);
}

async function waitForSelectReady(page, selector, expectedValue, options = {}) {
    const timeout = options.timeout ?? 15000;
    const waitOptionsLoaded = options.waitOptionsLoaded ?? true;

    await page.waitForSelector(selector, {
        state: "visible",
        timeout,
    });

    await page.waitForFunction(
        ({ selector: currentSelector, expectedValue: currentValue, waitOptionsLoaded: shouldWaitOptions }) => {
            const element = document.querySelector(currentSelector);
            if (!element || element.tagName !== "SELECT" || element.disabled) {
                return false;
            }

            const options = Array.from(element.options || []);
            if (options.length === 0) {
                return false;
            }

            if (shouldWaitOptions && options.length <= 1) {
                return false;
            }

            return options.some(
                (option) =>
                    String(option.value) === String(currentValue) ||
                    String(option.textContent || "").trim().toLowerCase() === String(currentValue).trim().toLowerCase()
            );
        },
        { selector, expectedValue: String(expectedValue), waitOptionsLoaded },
        { timeout }
    );
}

async function resolveSelectOptionValue(page, selector, expectedValue, options = {}) {
    const timeout = options.timeout ?? 15000;

    await waitForSelectReady(page, selector, expectedValue, {
        timeout,
        waitOptionsLoaded: options.waitOptionsLoaded,
    });

    return page.locator(selector).evaluate((element, currentValue) => {
        const normalizedValue = String(currentValue).trim().toLowerCase();
        const option = Array.from(element.options || []).find((currentOption) => {
            const value = String(currentOption.value).trim().toLowerCase();
            const text = String(currentOption.textContent || "").trim().toLowerCase();

            return value === normalizedValue || text === normalizedValue;
        });

        return option ? option.value : null;
    }, String(expectedValue));
}

async function selectAndVerify(page, selector, value, options = {}) {
    const timeout = options.timeout ?? 15000;
    const retries = options.retries ?? 3;
    const settleMs = options.settleMs ?? 300;
    const fieldName = options.fieldName ?? selector;
    const expectedValue = String(value);
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            const optionValue = await resolveSelectOptionValue(page, selector, expectedValue, { timeout });
            if (optionValue === null || optionValue === undefined) {
                throw new Error(`No existe opcion con value/texto=${expectedValue}`);
            }

            await page.selectOption(selector, String(optionValue));
            await page.waitForTimeout(settleMs);

            const selectedValue = await page.locator(selector).inputValue();
            if (String(selectedValue) !== String(optionValue)) {
                throw new Error(`El portal no conservo el valor. Esperado=${optionValue}, actual=${selectedValue}`);
            }

            return;
        } catch (error) {
            lastError = error;
            logger.debug(`${fieldName} intento ${attempt}/${retries}: ${error.message}`);

            if (attempt < retries) {
                await page.waitForTimeout(500);
            }
        }
    }

    throw new Error(`No se pudo seleccionar ${fieldName}=${expectedValue}. Ultimo error: ${lastError?.message || "desconocido"}`);
}

async function fillAndVerify(page, selector, value, options = {}) {
    const timeout = options.timeout ?? 15000;
    const retries = options.retries ?? 3;
    const settleMs = options.settleMs ?? 500;
    const fieldName = options.fieldName ?? selector;
    const expectedValue = String(value).trim();
    const expectedMoneyValue = parseMoneyValue(expectedValue);
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            await page.waitForSelector(selector, { state: "visible", timeout });

            const locator = page.locator(selector);
            const isDateField = fieldName.toLowerCase().includes("birthdate") || selector.toLowerCase().includes("birthdate") || selector.toLowerCase().includes("fecha");

            await locator.click({ timeout });
            await locator.press("Control+A").catch(() => {});
            await locator.press("Meta+A").catch(() => {});
            await locator.press("Delete").catch(() => {});
            await locator.fill("").catch(() => {});

            if (isDateField) {
                await locator.pressSequentially(expectedValue, { delay: 120 });
            } else {
                await locator.fill(expectedValue);
            }

            await locator.dispatchEvent("input").catch(() => {});
            await locator.dispatchEvent("change").catch(() => {});
            await locator.blur();
            await page.waitForTimeout(settleMs);

            const currentValue = (await locator.inputValue()).trim();
            const isMoneyField = [
                "vehicleAccesoriesAmount",
                "vehicleChargeStationAmount",
                "creditDepositAmount",
            ].includes(fieldName);

            if (isMoneyField) {
                const currentMoneyValue = parseMoneyValue(currentValue);
                if (currentMoneyValue !== expectedMoneyValue) {
                    throw new Error(`Esperado=${expectedValue}, actual=${currentValue}`);
                }
            } else if (currentValue !== expectedValue) {
                throw new Error(`Esperado=${expectedValue}, actual=${currentValue}`);
            }

            return;
        } catch (error) {
            lastError = error;
            logger.debug(`${fieldName} intento ${attempt}/${retries}: ${error.message}`);

            if (attempt < retries) {
                await page.waitForTimeout(700);
            }
        }
    }

    throw new Error(`No se pudo llenar ${fieldName}=${expectedValue}. Ultimo error: ${lastError?.message || "desconocido"}`);
}

async function isFieldVisible(page, selector, timeout = 1500) {
    try {
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: "attached", timeout });
        return await locator.isVisible();
    } catch {
        return false;
    }
}

async function applyFieldSet(page, source, fields) {
    for (const field of fields) {
        const rawValue = getNestedValue(source, field.key);

        if (isEmptyValue(rawValue)) {
            if (field.required) {
                throw new Error(`Falta el campo requerido: ${field.key}`);
            }

            continue;
        }

        const value = field.transform ? field.transform(rawValue) : rawValue;

        if (field.type === "select") {
            const selector = await resolveFieldSelector(page, field);
            await selectAndVerify(page, selector, value, {
                fieldName: field.key,
                retries: field.retries,
                timeout: field.timeout,
                settleMs: 300,
            });
            continue;
        }

        if (field.type === "input") {
            const selector = await resolveFieldSelector(page, field);

            if (field.skipIfHidden && !(await isFieldVisible(page, selector, 2000))) {
                logger.warn(`Campo ${field.key} omitido porque existe oculto o no visible. selector=${selector}`);
                continue;
            }

            await fillAndVerify(page, selector, value, {
                fieldName: field.key,
                retries: field.retries,
                timeout: field.timeout,
                settleMs: 400,
            });
            continue;
        }

        if (field.type === "checkbox") {
            const selector = await resolveFieldSelector(page, field);
            await setCheckboxValue(page, selector, value, {
                fieldName: field.key,
                retries: field.retries,
                timeout: field.timeout,
            });
            continue;
        }

        if (field.type === "radio") {
            await setRadioValue(page, field.radioName, value, {
                fieldName: field.key,
                retries: field.retries,
                timeout: field.timeout,
            });
            continue;
        }

        throw new Error(`Tipo de campo no soportado: ${field.type}`);
    }
}

async function setCheckboxValue(page, selector, value, options = {}) {
    const timeout = options.timeout ?? 15000;
    const retries = options.retries ?? 3;
    const fieldName = options.fieldName ?? selector;
    const expectedChecked = Boolean(value);
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            const locator = page.locator(selector).first();
            await locator.waitFor({ state: "attached", timeout });

            const isVisible = await locator.isVisible().catch(() => false);
            const isEnabled = await locator.isEnabled().catch(() => false);

            if (!isVisible || !isEnabled) {
                if (!expectedChecked) {
                    return;
                }

                throw new Error(`El checkbox no esta disponible. visible=${isVisible} enabled=${isEnabled}`);
            }

            const currentChecked = await locator.isChecked();
            if (currentChecked !== expectedChecked) {
                await locator.click({ timeout });
            }

            if ((await locator.isChecked()) !== expectedChecked) {
                throw new Error(`Esperado=${expectedChecked}, actual=${await locator.isChecked()}`);
            }

            return;
        } catch (error) {
            lastError = error;
            logger.debug(`${fieldName} intento ${attempt}/${retries}: ${error.message}`);

            if (attempt < retries) {
                await page.waitForTimeout(500);
            }
        }
    }

    throw new Error(`No se pudo definir ${fieldName}=${expectedChecked}. Ultimo error: ${lastError?.message || "desconocido"}`);
}

async function setRadioValue(page, radioName, value, options = {}) {
    const timeout = options.timeout ?? 15000;
    const retries = options.retries ?? 3;
    const fieldName = options.fieldName ?? radioName;
    const expectedValue = String(value);
    const selector = `input[type="radio"][name="${radioName}"][value="${expectedValue}"]`;
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            await page.waitForSelector(selector, { state: "visible", timeout });
            const locator = page.locator(selector).first();

            if (!(await locator.isEnabled())) {
                throw new Error("El radio esta deshabilitado");
            }

            await locator.check({ timeout });
            await page.waitForTimeout(300);

            if (!(await locator.isChecked())) {
                throw new Error(`El portal no selecciono ${expectedValue}`);
            }

            return;
        } catch (error) {
            lastError = error;
            logger.debug(`${fieldName} intento ${attempt}/${retries}: ${error.message}`);

            if (attempt < retries) {
                await page.waitForTimeout(500);
            }
        }
    }

    throw new Error(`No se pudo seleccionar ${fieldName}=${expectedValue}. Ultimo error: ${lastError?.message || "desconocido"}`);
}

async function fillClientData(page, payload) {
    const cliente = payload?.cliente;
    if (!cliente || typeof cliente !== "object") {
        throw new Error("No viene el objeto cliente en el JSON");
    }

    const customerTypeRaw = getNestedValue(cliente, "customerType");
    if (isEmptyValue(customerTypeRaw)) {
        throw new Error("Falta el campo requerido: customerType");
    }

    const customerType = String(customerTypeRaw).trim();
    const fieldsByType = CLIENTE_FIELDS_BY_TYPE[customerType];

    if (!fieldsByType) {
        throw new Error(`customerType no soportado: ${customerType}`);
    }

    await applyFieldSet(page, cliente, CLIENTE_BASE_FIELDS);
    await page.waitForTimeout(800);
    await applyFieldSet(page, cliente, fieldsByType);
}

async function fillVehicleData(page, payload) {
    const vehiculo = payload?.vehiculo;

    if (!vehiculo) {
        return;
    }

    if (typeof vehiculo !== "object") {
        throw new Error("El objeto vehiculo debe ser un JSON valido");
    }

    await applyFieldSet(page, vehiculo, VEHICULO_FIELDS);
}

async function fillCreditData(page, payload) {
    const credito = payload?.credito;

    if (!credito) {
        return;
    }

    if (typeof credito !== "object") {
        throw new Error("El objeto credito debe ser un JSON valido");
    }

    await page.locator("#credit_data").scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});

    const hasDepositPercent = !isEmptyValue(credito.creditDepositPercent);
    const hasDepositAmount = !isEmptyValue(credito.creditDepositAmount);
    const shouldUseDepositAmount = !hasDepositPercent && hasDepositAmount;
    const fields = CREDITO_FIELDS.filter((field) => {
        if (field.key === "creditDepositPercent") {
            return hasDepositPercent;
        }

        if (field.key === "creditDepositAmount") {
            return shouldUseDepositAmount;
        }

        return true;
    });

    logger.debug(`Campos de credito a llenar: ${fields.map((field) => field.key).join(", ") || "ninguno"}`);
    await applyFieldSet(page, credito, fields);
    await assertNoCreditDepositMinimumError(page);
}

async function fillInsuranceData(page, payload) {
    const seguro = payload?.seguro;

    if (!seguro) {
        return;
    }

    if (typeof seguro !== "object") {
        throw new Error("El objeto seguro debe ser un JSON valido");
    }

    await page.locator("#insurance_data").scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
    await applyFieldSet(page, seguro, SEGURO_FIELDS);

    const insuranceOption = seguro.insuranceOption || seguro.aseguradora || seguro.insuranceCarrier;
    await selectInsuranceOption(page, insuranceOption);
}

function normalizeInsuranceCarrier(value) {
    if (isEmptyValue(value)) {
        return null;
    }

    const normalized = String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return INSURANCE_CARRIER_ALIASES[normalized] || normalized;
}

async function readInsuranceQuotes(page) {
    return page.locator("#trAseguradoras_radios").evaluate((row) => {
        return Array.from(row.querySelectorAll('input[type="radio"][name="insuranceOption"]')).map((radio) => {
            const rawId = radio.id || "";
            const carrier = rawId.replace(/^insuranceRadio_/, "");
            const label = row.querySelector(`label[for="${rawId}"]`) || document.querySelector(`label[for="${rawId}"]`);
            const rawAmount = String(label?.textContent || "").trim();
            const amount = Number(rawAmount.replace(/[^0-9.-]/g, ""));

            return {
                carrier,
                disabled: Boolean(radio.disabled),
                checked: Boolean(radio.checked),
                rawAmount,
                amount: Number.isFinite(amount) ? amount : 0,
            };
        });
    }).catch(() => []);
}

async function readInsuranceOptions(page) {
    const quotes = await readInsuranceQuotes(page);

    return quotes
        .filter((quote) => quote.amount > 0)
        .map((quote) => ({
            name: quote.carrier,
            rawAmount: quote.rawAmount,
            amount: quote.amount,
            disabled: quote.disabled,
            selected: quote.checked,
        }));
}

function hasValidInsuranceQuote(quotes, carrier = null) {
    const targetCarrier = normalizeInsuranceCarrier(carrier);
    return quotes.some((quote) => {
        const carrierMatches = !targetCarrier || quote.carrier === targetCarrier;
        return carrierMatches && !quote.disabled && quote.amount > 0;
    });
}

async function waitForInsuranceQuotes(page, carrier = null, timeout = 45000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
        const quotes = await readInsuranceQuotes(page);

        if (hasValidInsuranceQuote(quotes, carrier)) {
            return quotes;
        }

        await page.waitForTimeout(1000);
    }

    return readInsuranceQuotes(page);
}

async function refreshInsuranceQuotes(page) {
    const triggerSelectors = [
        "#insuranceCoverageLorant",
        "#insurancePaymentTermRemnant",
        "#insuranceType",
        "#insuranceRecruitment",
    ];

    for (const selector of triggerSelectors) {
        const refreshed = await page.locator(selector).evaluate((select) => {
            if (!select || select.tagName !== "SELECT" || select.disabled) {
                return false;
            }

            const currentValue = select.value;
            const options = Array.from(select.options || [])
                .map((option) => option.value)
                .filter((value) => value && value !== "-1");

            const alternateValue = options.find((value) => value !== currentValue);

            if (alternateValue) {
                select.value = alternateValue;
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }

            setTimeout(() => {
                select.value = currentValue;
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }, 500);

            return true;
        }).catch(() => false);

        if (refreshed) {
            logger.debug(`Recargando tabla de aseguradoras con ${selector}`);
            await page.waitForTimeout(2500);
            return;
        }
    }

    logger.warn("No se encontro combo disponible para recargar aseguradoras.");
}

async function selectInsuranceOption(page, requestedCarrier) {
    const targetCarrier = normalizeInsuranceCarrier(requestedCarrier);
    let quotes = [];

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        quotes = await waitForInsuranceQuotes(page, targetCarrier, 45000);

        if (hasValidInsuranceQuote(quotes, targetCarrier)) {
            break;
        }

        logger.debug(`Tabla de aseguradoras sin datos validos intento ${attempt}/3.`);
        if (attempt < 3) {
            await refreshInsuranceQuotes(page);
        }
    }

    const validQuotes = quotes.filter((quote) => !quote.disabled && quote.amount > 0);
    if (validQuotes.length === 0) {
        throw new Error("No se cargaron opciones validas de aseguradora.");
    }

    const selectedQuote = targetCarrier
        ? validQuotes.find((quote) => quote.carrier === targetCarrier)
        : validQuotes.sort((left, right) => left.amount - right.amount)[0];

    if (!selectedQuote) {
        throw new Error(`No se cargo una opcion valida para la aseguradora ${targetCarrier}.`);
    }

    const radioSelector = `#insuranceRadio_${selectedQuote.carrier}`;
    await page.locator(radioSelector).check({ timeout: 10000 });
    await page.waitForTimeout(1000);

    logger.debug(`Aseguradora seleccionada: ${selectedQuote.carrier} ${selectedQuote.rawAmount}`);
}

async function assertNoCreditDepositMinimumError(page) {
    await page.waitForTimeout(500);

    const errorContent = page
        .locator(".creditDepositPercentformError .formErrorContent", {
            hasText: "Favor de validar que el enganche sea de un mínimo del 15%",
        })
        .first();

    const isVisible = await errorContent.isVisible().catch(() => false);
    if (!isVisible) {
        return;
    }

    const message = (await errorContent.innerText().catch(() => "")).replace(/^\*\s*/, "").trim()
        || "Favor de validar que el enganche sea de un mínimo del 15%";

    throw new Error(message);
}

async function readVehicleTotalAmount(page) {
    return readMoneyField(page, "#vehicleTotalAmount");
}

async function readVehiclePriceTax(page) {
    return readMoneyField(page, "#vehiclePriceTax");
}

async function readInsuranceMonthlyFee(page) {
    return readMoneyField(page, "#insuranceMonthlyFee");
}

async function readMoneyField(page, selector) {
    await page.waitForSelector(selector, { state: "attached", timeout: 15000 });
    await page.waitForFunction((currentSelector) => {
        const input = document.querySelector(currentSelector);
        if (!input) {
            return false;
        }

        const rawValue = String(input.value || "").trim();
        return rawValue.length > 0;
    }, selector, { timeout: 15000 });

    const raw = (await page.locator(selector).inputValue()).trim();
    const normalized = raw.replace(/[^0-9.-]/g, "");
    const amount = normalized ? Number(normalized) : null;

    return {
        raw,
        amount: Number.isFinite(amount) ? amount : null,
    };
}

module.exports = {
    fillClientData,
    fillCreditData,
    fillInsuranceData,
    fillVehicleData,
    readInsuranceOptions,
    readInsuranceMonthlyFee,
    readVehiclePriceTax,
    readVehicleTotalAmount,
};
