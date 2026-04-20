const { CLIENTE_BASE_FIELDS, CLIENTE_FIELDS_BY_TYPE, CREDITO_FIELDS, SEGURO_FIELDS, VEHICULO_FIELDS } = require("./fields");
const logger = require("../core/logger");

const FLOW_SECTION_TIMEOUT_MS = 300000;
const FIELD_STEP_MAX_TIMEOUT_MS = 180000;
const DEPENDENT_SELECT_KEYS = new Set([
    "vehicleBrand",
    "vehicleAnio",
    "vehicleModel",
    "vehicleVersion",
]);

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

function elapsedSecondsSince(startTime) {
    return Number(((performance.now() - startTime) / 1000).toFixed(2));
}

function maskLogValue(value) {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    const raw = String(value);
    const trimmed = raw.trim();

    if (!trimmed) {
        return "";
    }

    if (trimmed.length <= 4) {
        return "****";
    }

    return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

function buildFieldTimeout(field) {
    const timeout = field.timeout ?? 15000;
    const retries = field.retries ?? 3;
    const budget = timeout * Math.max(1, retries) + 7000;
    return Math.min(Math.max(15000, budget), FIELD_STEP_MAX_TIMEOUT_MS);
}

async function runWithTimeout(label, action, timeoutMs) {
    const startTime = performance.now();
    logger.info(`[substep:${label}] start`, { timeoutMs });

    try {
        const result = await Promise.race([
            Promise.resolve().then(action),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout en substep "${label}" tras ${timeoutMs}ms`)), timeoutMs)),
        ]);

        logger.info(`[substep:${label}] end`, { elapsedSeconds: elapsedSecondsSince(startTime) });
        return result;
    } catch (error) {
        logger.warn(`[substep:${label}] failed`, { elapsedSeconds: elapsedSecondsSince(startTime), error: error.message });
        throw error;
    }
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
    const fieldName = options.fieldName ?? selector;

    await page.waitForSelector(selector, {
        state: "visible",
        timeout,
    });

    const shouldLogFine = DEPENDENT_SELECT_KEYS.has(fieldName);
    const normalizedExpectedValue = String(expectedValue).trim().toLowerCase();
    const startedAt = performance.now();
    const deadline = Date.now() + timeout;
    let lastSnapshot = null;

    while (Date.now() < deadline) {
        const snapshot = await page.evaluate(({ selector: currentSelector, expectedValue: currentValue }) => {
            const element = document.querySelector(currentSelector);
            if (!element || element.tagName !== "SELECT") {
                return {
                    ok: false,
                    reason: "missing",
                    disabled: null,
                    optionsCount: 0,
                    placeholderOnly: false,
                    hasExpectedOption: false,
                    value: null,
                    loadingHints: [],
                };
            }

            const options = Array.from(element.options || []);
            const normalizedExpected = String(currentValue).trim().toLowerCase();
            const hasExpectedOption = options.some((option) => {
                const value = String(option.value || "").trim().toLowerCase();
                const text = String(option.textContent || "").trim().toLowerCase();
                return value === normalizedExpected || text === normalizedExpected;
            });

            const placeholderOnly = options.length <= 1;

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

            const loadingHints = [];
            const busy = document.querySelector('[aria-busy="true"]');
            if (busy && isVisible(busy)) loadingHints.push("aria-busy=true");

            const masks = Array.from(document.querySelectorAll(".window-mask,.datagrid-mask,.panel-mask,.loading-mask,.loading-overlay,[class*=\"mask\"],[id*=\"mask\"]"))
                .filter(isVisible);
            if (masks.length > 0) loadingHints.push(`mask_visible=${masks.length}`);

            const loaders = Array.from(document.querySelectorAll(".panel-loading,.datagrid-mask-msg,[class*=\"loading\"],[id*=\"loading\"]"))
                .filter(isVisible);
            if (loaders.length > 0) loadingHints.push(`loading_visible=${loaders.length}`);

            return {
                ok: true,
                reason: "present",
                disabled: Boolean(element.disabled),
                optionsCount: options.length,
                placeholderOnly,
                hasExpectedOption,
                value: String(element.value || ""),
                loadingHints,
            };
        }, { selector, expectedValue: normalizedExpectedValue });

        lastSnapshot = snapshot;

        const hasOptions = snapshot.ok && snapshot.optionsCount > 0;
        const loadedEnough = !waitOptionsLoaded || (hasOptions && !snapshot.placeholderOnly);
        const selectable = snapshot.ok && snapshot.disabled === false;
        const ready = selectable && loadedEnough && snapshot.hasExpectedOption;

        if (shouldLogFine) {
            logger.info("[select] wait", {
                key: fieldName,
                selector,
                expectedValue: normalizedExpectedValue,
                elapsedSeconds: elapsedSecondsSince(startedAt),
                disabled: snapshot.disabled,
                optionsCount: snapshot.optionsCount,
                placeholderOnly: snapshot.placeholderOnly,
                hasExpectedOption: snapshot.hasExpectedOption,
                value: snapshot.value,
                loadingHints: snapshot.loadingHints,
            });
        }

        if (ready) {
            return;
        }

        await page.waitForTimeout(600);
    }

    const details = lastSnapshot
        ? ` disabled=${lastSnapshot.disabled} options=${lastSnapshot.optionsCount} placeholderOnly=${lastSnapshot.placeholderOnly} hasExpected=${lastSnapshot.hasExpectedOption} loading=${(lastSnapshot.loadingHints || []).join(",")}`
        : " sin snapshot";
    throw new Error(`Timeout esperando opciones para ${fieldName}. ${details}`);
}

async function resolveSelectOptionValue(page, selector, expectedValue, options = {}) {
    const timeout = options.timeout ?? 15000;

    await waitForSelectReady(page, selector, expectedValue, {
        timeout,
        waitOptionsLoaded: options.waitOptionsLoaded,
        fieldName: options.fieldName,
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
            if (DEPENDENT_SELECT_KEYS.has(fieldName)) {
                logger.info("[select] resolve start", { key: fieldName, selector, expectedValue, attempt, timeout });
            }

            const optionValue = await resolveSelectOptionValue(page, selector, expectedValue, { timeout, fieldName });
            if (optionValue === null || optionValue === undefined) {
                throw new Error(`No existe opcion con value/texto=${expectedValue}`);
            }

            const selectStartTime = performance.now();
            await page.selectOption(selector, String(optionValue));
            await page.waitForTimeout(settleMs);

            const selectedValue = await page.locator(selector).inputValue();
            if (String(selectedValue) !== String(optionValue)) {
                throw new Error(`El portal no conservo el valor. Esperado=${optionValue}, actual=${selectedValue}`);
            }

            if (DEPENDENT_SELECT_KEYS.has(fieldName)) {
                logger.info("[select] selected", {
                    key: fieldName,
                    selector,
                    optionValue,
                    elapsedSeconds: elapsedSecondsSince(selectStartTime),
                });

                await logVehicleDependentSelects(page, `after_${fieldName}`).catch(() => {});
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

async function logVehicleDependentSelects(page, stage) {
    const selectors = {
        vehicleBrand: "#vehicleBrand",
        vehicleAnio: "#vehicleAnio",
        vehicleModel: "#vehicleModel",
        vehicleVersion: "#vehicleVersion",
    };

    const snapshot = await page.evaluate((sel) => {
        const read = (selector) => {
            const element = document.querySelector(selector);
            if (!element || element.tagName !== "SELECT") {
                return { present: false };
            }

            const options = Array.from(element.options || []);
            const placeholderOnly = options.length <= 1;
            return {
                present: true,
                disabled: Boolean(element.disabled),
                optionsCount: options.length,
                placeholderOnly,
                value: String(element.value || ""),
            };
        };

        return Object.fromEntries(Object.entries(sel).map(([key, selector]) => [key, read(selector)]));
    }, selectors);

    logger.info("[vehicle-selects] snapshot", { stage, snapshot });
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
        const attemptStartTime = performance.now();
        const stepTimings = {};
        const mark = async (step, action) => {
            const stepStartTime = performance.now();
            try {
                return await action();
            } finally {
                stepTimings[step] = elapsedSecondsSince(stepStartTime);
            }
        };

        try {
            const isDateField = fieldName.toLowerCase().includes("birthdate")
                || selector.toLowerCase().includes("birthdate")
                || selector.toLowerCase().includes("fecha");
            const isMoneyField = [
                "vehicleAccesoriesAmount",
                "vehicleChargeStationAmount",
                "creditDepositAmount",
            ].includes(fieldName);
            const shouldForceEvents = isDateField || isMoneyField;
            const shouldClearWithKeys = isDateField;
            const shouldBlur = shouldForceEvents;

            await mark("wait_visible", async () => {
                await page.waitForSelector(selector, { state: "visible", timeout });
            });

            const locator = page.locator(selector);

            await mark("click", async () => {
                if (shouldClearWithKeys) {
                    await locator.click({ timeout });
                }
            });

            await mark("clear", async () => {
                if (shouldClearWithKeys) {
                    await locator.press("Control+A").catch(() => {});
                    await locator.press("Meta+A").catch(() => {});
                    await locator.press("Delete").catch(() => {});
                    await locator.fill("").catch(() => {});
                }
            });

            await mark("fill", async () => {
                if (shouldClearWithKeys) {
                    await locator.pressSequentially(expectedValue, { delay: 120 });
                    return;
                }

                await locator.fill(expectedValue);
            });

            if (shouldForceEvents) {
                await mark("dispatch_events", async () => {
                    await locator.dispatchEvent("input").catch(() => {});
                    await locator.dispatchEvent("change").catch(() => {});
                });
            }

            if (shouldBlur) {
                await mark("blur", async () => {
                    await locator.blur();
                });
            }

            await mark("settle", async () => {
                await page.waitForTimeout(settleMs);
            });

            const currentValue = await mark("verify_read", async () => (
                (await locator.inputValue()).trim()
            ));

            if (isMoneyField) {
                const currentMoneyValue = parseMoneyValue(currentValue);
                if (currentMoneyValue !== expectedMoneyValue) {
                    throw new Error(`Esperado=${expectedValue}, actual=${currentValue}`);
                }
            } else if (currentValue !== expectedValue) {
                throw new Error(`Esperado=${expectedValue}, actual=${currentValue}`);
            }

            logger.info("[input] ok", {
                key: fieldName,
                attempt,
                elapsedSeconds: elapsedSecondsSince(attemptStartTime),
                steps: stepTimings,
            });
            return;
        } catch (error) {
            lastError = error;
            logger.debug(`${fieldName} intento ${attempt}/${retries}: ${error.message}`);
            logger.warn("[input] failed", {
                key: fieldName,
                attempt,
                elapsedSeconds: elapsedSecondsSince(attemptStartTime),
                steps: stepTimings,
                error: error.message,
            });

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
        const fieldTimeoutMs = buildFieldTimeout(field);
        const stepStartTime = performance.now();
        logger.info("[field] start", {
            key: field.key,
            type: field.type,
            timeoutMs: fieldTimeoutMs,
            value: field.type === "input" ? maskLogValue(value) : String(value).trim(),
        });

        try {
            if (field.type === "select") {
                await runWithTimeout(`field:${field.key}`, async () => {
                    const selector = await resolveFieldSelector(page, field);
                    await selectAndVerify(page, selector, value, {
                        fieldName: field.key,
                        retries: field.retries,
                        timeout: field.timeout,
                        settleMs: 300,
                    });
                }, fieldTimeoutMs);
                logger.info("[field] end", { key: field.key, elapsedSeconds: elapsedSecondsSince(stepStartTime) });
                continue;
            }

            if (field.type === "input") {
                await runWithTimeout(`field:${field.key}`, async () => {
                    const selector = await resolveFieldSelector(page, field);

                    if (field.skipIfHidden && !(await isFieldVisible(page, selector, 2000))) {
                        logger.warn(`Campo ${field.key} omitido porque existe oculto o no visible. selector=${selector}`);
                        return;
                    }

                    await fillAndVerify(page, selector, value, {
                        fieldName: field.key,
                        retries: field.retries,
                        timeout: field.timeout,
                        settleMs: 400,
                    });
                }, fieldTimeoutMs);
                logger.info("[field] end", { key: field.key, elapsedSeconds: elapsedSecondsSince(stepStartTime) });
                continue;
            }

            if (field.type === "checkbox") {
                await runWithTimeout(`field:${field.key}`, async () => {
                    const selector = await resolveFieldSelector(page, field);
                    await setCheckboxValue(page, selector, value, {
                        fieldName: field.key,
                        retries: field.retries,
                        timeout: field.timeout,
                    });
                }, fieldTimeoutMs);
                logger.info("[field] end", { key: field.key, elapsedSeconds: elapsedSecondsSince(stepStartTime) });
                continue;
            }

            if (field.type === "radio") {
                await runWithTimeout(`field:${field.key}`, async () => {
                    await setRadioValue(page, field.radioName, value, {
                        fieldName: field.key,
                        retries: field.retries,
                        timeout: field.timeout,
                    });
                }, fieldTimeoutMs);
                logger.info("[field] end", { key: field.key, elapsedSeconds: elapsedSecondsSince(stepStartTime) });
                continue;
            }

            throw new Error(`Tipo de campo no soportado: ${field.type}`);
        } catch (error) {
            logger.warn("[field] failed", {
                key: field.key,
                elapsedSeconds: elapsedSecondsSince(stepStartTime),
                error: error.message,
            });
            throw error;
        }
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

    await runWithTimeout("cliente-base-fields", async () => {
        await applyFieldSet(page, cliente, CLIENTE_BASE_FIELDS);
    }, FLOW_SECTION_TIMEOUT_MS);

    await page.waitForTimeout(800);

    await runWithTimeout(`cliente-fields-type-${customerType}`, async () => {
        await applyFieldSet(page, cliente, fieldsByType);
    }, FLOW_SECTION_TIMEOUT_MS);
}

async function fillVehicleData(page, payload) {
    const vehiculo = payload?.vehiculo;

    if (!vehiculo) {
        return;
    }

    if (typeof vehiculo !== "object") {
        throw new Error("El objeto vehiculo debe ser un JSON valido");
    }

    if (isEmptyValue(vehiculo.vehicleAccesories)) {
        delete vehiculo.vehicleAccesories;
    }

    if (isEmptyValue(vehiculo.vehicleAccesoriesAmount)) {
        delete vehiculo.vehicleAccesoriesAmount;
    }

    await runWithTimeout("vehiculo-fields", async () => {
        await applyFieldSet(page, vehiculo, VEHICULO_FIELDS);
    }, FLOW_SECTION_TIMEOUT_MS);
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

    const depositMode = hasDepositPercent
        ? "percent"
        : hasDepositAmount
            ? "amount"
            : "none";

    if (hasDepositPercent && hasDepositAmount) {
        logger.warn("[credito] payload trae percent y amount; se prioriza percent y se omite amount", {
            creditDepositPercent: maskLogValue(credito.creditDepositPercent),
            creditDepositAmount: maskLogValue(credito.creditDepositAmount),
        });
    }

    logger.info("[credito] deposit mode", {
        mode: depositMode,
        hasPercent: hasDepositPercent,
        hasAmount: hasDepositAmount,
    });

    const creditoToFill = { ...credito };

    if (depositMode === "percent") {
        delete creditoToFill.creditDepositAmount;
    } else if (depositMode === "amount") {
        delete creditoToFill.creditDepositPercent;
    } else {
        delete creditoToFill.creditDepositPercent;
        delete creditoToFill.creditDepositAmount;
    }

    const fields = CREDITO_FIELDS.filter((field) => {
        if (field.key === "creditDepositPercent") {
            return depositMode === "percent";
        }

        if (field.key === "creditDepositAmount") {
            return depositMode === "amount";
        }

        return true;
    });

    logger.info("[credito] fields", { keys: fields.map((field) => field.key) });
    await applyFieldSet(page, creditoToFill, fields);
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
