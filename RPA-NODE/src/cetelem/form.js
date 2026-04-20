const {
    CLIENTE_BASE_FIELDS,
    CLIENTE_FIELDS_BY_TYPE,
    VEHICULO_FIELDS,
    CREDITO_FIELDS,
    SEGURO_FIELDS,
} = require("./fields");

function getValue(obj, key) {
    return key.split(".").reduce((acc, part) => acc?.[part], obj);
}

function empty(value) {
    return value === undefined || value === null || String(value).trim() === "";
}

function delay() {
    return Math.floor(Math.random() * 4000) + 1000; // 1 a 5 seg
}

async function waitStep(page) {
    await page.waitForTimeout(delay());
}

async function getSelector(page, field) {
    if (field.selector) return field.selector;

    if (field.labelFor) {
        return `#${field.labelFor}`;
    }

    if (field.labelText) {
        const label = page.locator("label", { hasText: field.labelText }).first();
        await label.waitFor({ state: "visible", timeout: 15000 });

        const id = await label.getAttribute("for");
        if (!id) throw new Error(`No se encontró selector para ${field.key}`);

        return `#${id}`;
    }

    throw new Error(`Campo sin selector: ${field.key}`);
}

async function fillInput(page, selector, value) {
    await page.waitForSelector(selector, {
        state: "visible",
        timeout: 15000,
    });

    await page.fill(selector, String(value));
    await waitStep(page);
}

async function fillSelect(page, selector, value) {
    await page.waitForSelector(selector, {
        state: "visible",
        timeout: 15000,
    });

    await page.selectOption(selector, { label: String(value) }).catch(async () => {
        await page.selectOption(selector, String(value));
    });

    await waitStep(page);
}

async function fillCheckbox(page, selector, value) {
    await page.waitForSelector(selector, {
        state: "attached",
        timeout: 15000,
    });

    const locator = page.locator(selector).first();
    const checked = await locator.isChecked().catch(() => false);

    if (checked !== Boolean(value)) {
        await locator.click().catch(() => {});
    }

    await waitStep(page);
}

async function fillRadio(page, name, value) {
    const selector = `input[type="radio"][name="${name}"][value="${value}"]`;

    await page.waitForSelector(selector, {
        state: "visible",
        timeout: 15000,
    });

    await page.locator(selector).first().check().catch(async () => {
        await page.locator(selector).first().click().catch(() => {});
    });

    await waitStep(page);
}

async function runFields(page, source, fields) {
    for (const field of fields) {
        const raw = getValue(source, field.key);

        if (empty(raw)) {
            if (field.required) {
                throw new Error(`Falta campo requerido: ${field.key}`);
            }
            continue;
        }

        const value = field.transform ? field.transform(raw) : raw;
        const selector = field.type !== "radio"
            ? await getSelector(page, field)
            : null;

        if (field.type === "input") {
            await fillInput(page, selector, value);
            continue;
        }

        if (field.type === "select") {
            await fillSelect(page, selector, value);
            continue;
        }

        if (field.type === "checkbox") {
            await fillCheckbox(page, selector, value);
            continue;
        }

        if (field.type === "radio") {
            await fillRadio(page, field.radioName, value);
            continue;
        }
    }
}

async function fillClientData(page, payload) {
    const cliente = payload?.cliente;

    if (!cliente) return;

    const customerType = String(cliente.customerType || "").trim();

    if (!customerType) {
        throw new Error("Falta customerType");
    }

    const extraFields = CLIENTE_FIELDS_BY_TYPE[customerType];

    if (!extraFields) {
        throw new Error(`customerType no soportado: ${customerType}`);
    }

    await runFields(page, cliente, CLIENTE_BASE_FIELDS);
    await waitStep(page);
    await runFields(page, cliente, extraFields);
}

async function fillVehicleData(page, payload) {
    const vehiculo = payload?.vehiculo;
    if (!vehiculo) return;

    await runFields(page, vehiculo, VEHICULO_FIELDS);
}

async function fillCreditData(page, payload) {
    const credito = payload?.credito;
    if (!credito) return;

    await runFields(page, credito, CREDITO_FIELDS);
}

async function fillInsuranceData(page, payload) {
    const seguro = payload?.seguro;
    if (!seguro) return;

    await runFields(page, seguro, SEGURO_FIELDS);
}

module.exports = {
    fillClientData,
    fillVehicleData,
    fillCreditData,
    fillInsuranceData,
};