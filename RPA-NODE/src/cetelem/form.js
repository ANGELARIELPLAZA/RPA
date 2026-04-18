const { CLIENTE_BASE_FIELDS, CLIENTE_FIELDS_BY_TYPE, VEHICULO_FIELDS } = require("./fields");

function getNestedValue(object, key) {
    return key.split(".").reduce((current, part) => current?.[part], object);
}

function isEmptyValue(value) {
    return value === undefined || value === null || String(value).trim() === "";
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

            return options.some((option) => String(option.value) === String(currentValue));
        },
        { selector, expectedValue: String(expectedValue), waitOptionsLoaded },
        { timeout }
    );
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
            await waitForSelectReady(page, selector, expectedValue, { timeout });
            await page.selectOption(selector, expectedValue);
            await page.waitForTimeout(settleMs);

            const selectedValue = await page.locator(selector).inputValue();
            if (String(selectedValue) !== expectedValue) {
                throw new Error(`El portal no conservo el valor. Esperado=${expectedValue}, actual=${selectedValue}`);
            }

            return;
        } catch (error) {
            lastError = error;
            console.log(`[WARN] ${fieldName} intento ${attempt}/${retries}: ${error.message}`);

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
            if (currentValue !== expectedValue) {
                throw new Error(`Esperado=${expectedValue}, actual=${currentValue}`);
            }

            return;
        } catch (error) {
            lastError = error;
            console.log(`[WARN] ${fieldName} intento ${attempt}/${retries}: ${error.message}`);

            if (attempt < retries) {
                await page.waitForTimeout(700);
            }
        }
    }

    throw new Error(`No se pudo llenar ${fieldName}=${expectedValue}. Ultimo error: ${lastError?.message || "desconocido"}`);
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
            await page.waitForSelector(selector, { state: "visible", timeout });
            const locator = page.locator(selector).first();

            if (!(await locator.isEnabled())) {
                throw new Error("El checkbox esta deshabilitado");
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
            console.log(`[WARN] ${fieldName} intento ${attempt}/${retries}: ${error.message}`);

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
            console.log(`[WARN] ${fieldName} intento ${attempt}/${retries}: ${error.message}`);

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

async function readVehicleTotalAmount(page) {
    const selector = "#vehicleTotalAmount";

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
    fillVehicleData,
    readVehicleTotalAmount,
};
