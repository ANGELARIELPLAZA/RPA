const BrowserManager = require("./core/browser-manager");
const { CETELEM_URL, MAX_REINTENTOS, resolveCredentialsForAgencia } = require("./config");
const logger = require("./core/logger");
const { isNonEmptyObject } = require("./services/flowPlan.service");

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
        const selectors = [
            selector,
            ".blockUI.blockOverlay",
            ".window-mask",
        ];

        for (const sel of selectors) {
            await page.locator(sel).waitFor({ state: "hidden", timeout });
        }
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
        await clickConOverlay(page, selector, { timeout: 30000 });
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await page.waitForTimeout(200);

        const delay = attempt === 1 ? 110 : attempt === 2 ? 160 : 220;
        await page.locator(selector).pressSequentially(expected, { delay });
        await page.locator(selector).press("Tab").catch(() => { });
        await esperarOverlayCarga(page, { timeout: 30000 });
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
    const tryLocators = [
        page.locator(`${selector}:visible:not([disabled])`).first(),
        page.locator(`${selector}:not([disabled])`).first(),
        page.locator(`${selector}:visible`).first(),
        page.locator(selector).first(),
    ];

    for (const loc of tryLocators) {
        const count = await loc.count().catch(() => 0);
        if (count > 0) return loc;
    }

    return page.locator(selector).first();
}

async function resolveFirstExistingSelector(page, selectors, { timeout = 8000 } = {}) {
    const list = Array.isArray(selectors) ? selectors : [selectors].filter(Boolean);
    const started = Date.now();

    while (Date.now() - started < timeout) {
        for (const selector of list) {
            if (!selector) continue;
            const loc = page.locator(selector).first();
            const count = await loc.count().catch(() => 0);
            if (count <= 0) continue;

            const visible = await loc.isVisible().catch(() => false);
            if (!visible) continue;

            const disabled = await loc.isDisabled().catch(() => false);
            if (disabled) continue;

            return selector;
        }

        await page.waitForTimeout(250);
    }

    // Fallback: devolver el primero que exista aunque estÃ© oculto/disabled, para un error mÃ¡s explicativo despuÃ©s.
    for (const selector of list) {
        if (!selector) continue;
        const count = await page.locator(selector).count().catch(() => 0);
        if (count > 0) return selector;
    }

    throw new Error(`No encontrÃ© ninguno de los selectores: ${list.join(", ")}`);
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

function stripDiacritics(value) {
    try {
        return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch {
        return String(value ?? "");
    }
}

function normalizeCompareText(value) {
    return stripDiacritics(String(value ?? "")).replace(/\s+/g, " ").trim().toLowerCase();
}

function getMeaningfulSelectOptions(selector, optionsRaw) {
    const options = Array.isArray(optionsRaw) ? optionsRaw : [];
    if (selector !== "#gapInsurancePlan") return options;

    // "-1 → Seleccione" no cuenta como opción real para GAP Plan (solo es placeholder).
    return options.filter((o) => {
        const value = normalizeString(o?.value);
        const label = normalizeCompareText(o?.label);
        if (value === "-1" || value === "0" || value === "") {
            if (label.includes("seleccione") || label.includes("seleccion")) return false;
        }
        return true;
    });
}

function formatOptionsArrows(optionsRaw, { limit = 200 } = {}) {
    const options = Array.isArray(optionsRaw) ? optionsRaw : [];
    const slice = options.slice(0, Math.max(0, limit));
    const lines = slice.map((o) => `${normalizeString(o.value)} -> ${normalizeString(o.label)}`);
    const suffix = options.length > slice.length ? ` ... (+${options.length - slice.length})` : "";
    return lines.join("\n") + suffix;
}

function resolveSelectOption(selectSnapshot, selector, desiredRaw) {
    const desired = normalizeString(desiredRaw);
    const desiredLower = desired.toLowerCase();
    const desiredNorm = normalizeCompareText(desired);

    const options = getMeaningfulSelectOptions(selector, selectSnapshot?.options);
    const selectedValue = normalizeString(selectSnapshot?.value);
    const selectedLabel = normalizeString(selectSnapshot?.selectedLabel);
    const selectedLabelNorm = normalizeCompareText(selectedLabel);

    // ya seleccionado (por value o label)
    if (selectedValue === desired || selectedLabel.toLowerCase() === desiredLower || selectedLabelNorm === desiredNorm) {
        const selectedOption = options.find((o) => normalizeString(o.value) === selectedValue) || {
            value: selectedValue,
            label: selectedLabel,
            selected: true,
        };
        return { already: true, option: selectedOption, requested: desired, resolved: normalizeString(selectedOption.value), reason: "already" };
    }

    // match exacto por value
    const byValue = options.find((o) => normalizeString(o.value) === desired);
    if (byValue) return { already: false, option: byValue, requested: desired, resolved: normalizeString(byValue.value), reason: "value" };

    // match exacto por label (con y sin diacríticos)
    const byLabel = options.find((o) => normalizeCompareText(o.label) === desiredNorm);
    if (byLabel) return { already: false, option: byLabel, requested: desired, resolved: normalizeString(byLabel.value), reason: "label" };

    // Fallbacks específicos (GAP Plan): aceptar payloads legacy como "EE"/"PP" o "4E" cuando el portal cambia prefijos.
    if (selector === "#gapInsurancePlan") {
        const desiredUpper = stripDiacritics(desired).replace(/\s+/g, "").trim().toUpperCase();
        const lastChar = desiredUpper.slice(-1);
        const parsed = desiredUpper.match(/^(\d+)([EP])$/);
        const desiredNumber = parsed ? parsed[1] : "";

        let wantedSuffix = "";
        if (desiredUpper === "EE" || desiredUpper === "E") wantedSuffix = "E";
        if (desiredUpper === "PP" || desiredUpper === "P") wantedSuffix = "P";
        if (!wantedSuffix && desiredUpper.includes("ESTANDAR")) wantedSuffix = "E";
        if (!wantedSuffix && desiredUpper.includes("PLUS")) wantedSuffix = "P";
        if (!wantedSuffix && (lastChar === "E" || lastChar === "P")) wantedSuffix = lastChar;

        if (wantedSuffix) {
            const bySuffixAll = options.filter((o) =>
                stripDiacritics(normalizeString(o.value)).toUpperCase().endsWith(wantedSuffix)
            );

            if (desiredNumber) {
                const exact = bySuffixAll.find((o) =>
                    stripDiacritics(normalizeString(o.value)).toUpperCase() === `${desiredNumber}${wantedSuffix}`
                );
                if (exact) {
                    return { already: false, option: exact, requested: desired, resolved: normalizeString(exact.value), reason: "suffix-exact" };
                }
            }

            if (bySuffixAll.length === 1) {
                return { already: false, option: bySuffixAll[0], requested: desired, resolved: normalizeString(bySuffixAll[0].value), reason: "suffix-unique" };
            }

            // Desambiguar por keyword en label (ESTANDAR/PLUS)
            const keyword = wantedSuffix === "E" ? "estandar" : "plus";
            const byKeyword = bySuffixAll.filter((o) => normalizeCompareText(o.label).includes(keyword));
            if (byKeyword.length === 1) {
                return { already: false, option: byKeyword[0], requested: desired, resolved: normalizeString(byKeyword[0].value), reason: "suffix-keyword" };
            }

            // Si las etiquetas son idénticas, el prefijo numérico suele ser irrelevante (p.ej. 2E/3E con mismo label).
            const uniqueLabels = Array.from(new Set(bySuffixAll.map((o) => normalizeCompareText(o.label))));
            if (bySuffixAll.length > 0 && uniqueLabels.length === 1) {
                return { already: false, option: bySuffixAll[0], requested: desired, resolved: normalizeString(bySuffixAll[0].value), reason: "suffix-same-label" };
            }
        }
    }

    return null;
}

function getMeaningfulSelectOptionsGeneric(optionsRaw) {
    const options = Array.isArray(optionsRaw) ? optionsRaw : [];
    return options.filter((o) => {
        const value = normalizeString(o?.value);
        const label = normalizeCompareText(o?.label);
        if (value === "" || value === "-1" || value === "0") {
            if (label.includes("seleccione") || label.includes("seleccion")) return false;
        }
        return true;
    });
}

async function waitForMeaningfulSelectOptions(page, locator, selector, timeout) {
    const hooks = page?.__rpaHooks;
    const start = Date.now();
    let triedKick = false;
    let lastSnap = null;

    while (Date.now() - start < timeout) {
        const snap = await snapshotSelect(locator);
        lastSnap = snap;
        const meaningful =
            selector === "#gapInsurancePlan"
                ? getMeaningfulSelectOptions(selector, snap.options)
                : getMeaningfulSelectOptionsGeneric(snap.options);

        if (meaningful.length > 0) return snap;

        // A veces el portal no dispara el ajax hasta que se hace foco/click en el select.
        if (!triedKick && Date.now() - start > 1500) {
            triedKick = true;
            if (hooks?.onProgress) {
                await hooks.onProgress({ page, message: `Opciones vacÃ­as en ${selector}; forzando foco/click para disparar carga...` }).catch(() => { });
            }
            await locator.scrollIntoViewIfNeeded().catch(() => { });
            await locator.click({ timeout: 1500 }).catch(() => { });
            await page.mouse.click(10, 10).catch(() => { });
            await esperarOverlayCarga(page, { timeout: 5000 }).catch(() => { });
        }

        await page.waitForTimeout(250);
    }

    if (hooks?.onErrorScreenshot) {
        await hooks.onErrorScreenshot({ page }).catch(() => { });
    }

    const formSnap = await readFormErrorSnapshot(page).catch(() => ({ content: "", field: "" }));
    const formMessage = normalizeString(formSnap?.content);

    const optionsList = lastSnap
        ? formatOptionsList(lastSnap, { limit: 80 })
        : "(sin snapshot)";

    const lines = [
        `Sin opciones cargadas en ${selector} dentro de ${timeout}ms.`,
        lastSnap ? `Estado actual: value="${normalizeString(lastSnap.value)}" label="${normalizeString(lastSnap.selectedLabel)}" opciones=${lastSnap.optionsCount}` : "",
        "",
        "Opciones visibles en el select:",
        optionsList || "(sin opciones)",
    ].filter(Boolean);

    if (formMessage) {
        lines.push("", "Mensaje del formulario:", formMessage);
    }

    throw new Error(lines.join("\n"));
}

async function esperarYSeleccionar(page, selector, value, timeout = 30000, options = {}) {
    const desired = normalizeString(value);
    const hooks = page?.__rpaHooks;
    const force = Boolean(options?.force);

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

    // Espera a que el select (este locator) tenga opciones cargadas.
    let snap = await waitForMeaningfulSelectOptions(page, locator, selector, timeout);
    const meaningfulOptions = getMeaningfulSelectOptions(selector, snap.options);
    let match = resolveSelectOption(snap, selector, desired);

    if (!match) {
        const optionsList = selector === "#gapInsurancePlan"
            ? meaningfulOptions.map((o) => `${normalizeString(o.value)}="${normalizeString(o.label)}"`).join(", ")
            : formatOptionsList(snap, { limit: 80 });

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

            const formSnap = await readFormErrorSnapshot(page).catch(() => ({ content: "", field: "" }));
            const formMessage = normalizeString(formSnap?.content);

            const technical = {
                detalle: `No se encontró la opción solicitada en ${selector}.`,
                mensaje_formulario: formMessage || "",
                campo: selector,
                valor_solicitado: desired,
                opciones_disponibles: meaningfulOptions.map((o) => ({
                    value: normalizeString(o.value),
                    label: normalizeString(o.label),
                })),
            };

            const prettyOptions = formatOptionsArrows(meaningfulOptions, { limit: 200 });
            const messageLines = [
                `Error detectado en ${selector}`,
                "",
                `No se encontró la opción solicitada con valor ${desired} en el campo ${selector}.`,
                "",
                "Detalle del error:",
                "",
                `Valor solicitado: ${desired}`,
                `Total de opciones disponibles: ${meaningfulOptions.length}`,
                "",
                "Opciones disponibles en el selector:",
                prettyOptions || "(sin opciones)",
            ];

            if (formMessage) {
                messageLines.push("", "Mensaje del formulario:", formMessage);
            }

            messageLines.push("", "Si lo quieres más técnico para log, te lo dejo así:", JSON.stringify(technical, null, 2));
            throw new Error(messageLines.join("\n"));
        }

        throw new Error(
            `Opción no encontrada para ${selector} (deseado="${desired}", actual="${snap.value}" label="${snap.selectedLabel}", opciones=${meaningfulOptions.length || snap.optionsCount}): ${optionsList}`
        );
    }

    const targetValue = normalizeString(match?.option?.value ?? match?.resolved ?? "");

    if (match.already) {
        if (hooks?.onProgress) {
            const msg = targetValue && targetValue !== desired
                ? `Ya seleccionado ${selector}=${targetValue} (solicitado=${desired})`
                : `Ya seleccionado ${selector}=${desired}`;
            await hooks.onProgress({ page, message: msg }).catch(() => { });
        }
        if (force && !empty(targetValue || desired)) {
            const desiredValue = targetValue || desired;
            await locator.evaluate(
                (el, val) => {
                    const select = el;
                    select.value = String(val);
                    select.dispatchEvent(new Event("input", { bubbles: true }));
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                },
                desiredValue
            ).catch(() => { });
            await page.waitForTimeout(500);
            return;
        }
        await page.waitForTimeout(250);
        return;
    }

    if (hooks?.onProgress) {
        const msg = targetValue && targetValue !== desired
            ? `Seleccionando ${selector}=${targetValue} (solicitado=${desired})`
            : `Seleccionando ${selector}=${desired}`;
        await hooks.onProgress({ page, message: msg }).catch(() => { });
    }

    try {
        await locator.selectOption(targetValue || desired, { timeout });
    } catch (error) {
        // Fallback: setear por JS + disparar eventos (útil si el select está oculto o hay plugins).
        const desiredValue = targetValue || desired;

        if (!empty(desiredValue)) {
            await locator.evaluate(
                (el, val) => {
                    const select = el;
                    select.value = String(val);
                    select.dispatchEvent(new Event("input", { bubbles: true }));
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                },
                desiredValue
            ).catch(() => { });
        } else {
            throw error;
        }
    }

    await page.waitForTimeout(1000);

    // Verifica que quedó seleccionado; si no, reintenta una vez sobre un locator visible/enabled.
    snap = await snapshotSelect(locator);
    const currentValue = normalizeString(snap?.value);
    if (!targetValue || currentValue !== targetValue) {
        const retryLocator = page.locator(`${selector}:visible:not([disabled])`).first();
        const retryCount = await retryLocator.count().catch(() => 0);
        if (retryCount > 0) {
            if (hooks?.onProgress) {
                await hooks.onProgress({ page, message: `Reintentando selección en ${selector} (visible/enabled)` }).catch(() => { });
            }
            await retryLocator.selectOption(targetValue || desired, { timeout }).catch(() => { });
            await page.waitForTimeout(500);
        }
    }
}

async function reintentarSelectDependiente(page, { dependeDe, objetivo, timeout = 60000, reintentos = 2 } = {}) {
    const hooks = page?.__rpaHooks;
    const dependencias = Array.isArray(dependeDe) ? dependeDe : [dependeDe].filter(Boolean);
    const attemptTimeout = Math.min(timeout, 12000);

    for (let attempt = 1; attempt <= Math.max(1, reintentos + 1); attempt += 1) {
        try {
            await esperarYSeleccionar(page, objetivo.selector, objetivo.value, attemptTimeout);
            return;
        } catch (error) {
            if (attempt > reintentos) throw error;

            if (hooks?.onProgress) {
                await hooks.onProgress({
                    page,
                    message: `No se pudo seleccionar ${objetivo.selector} (intento ${attempt}/${reintentos + 1}). Reintentando campo(s) anterior(es)...`,
                }).catch(() => { });
            }

            // Re-disparar el onchange del/los campo(s) anterior(es) (aunque ya estÃ©n seleccionados) para forzar recarga de opciones.
            for (const dep of dependencias) {
                if (!dep?.selector) continue;
                await esperarYSeleccionar(page, dep.selector, dep.value, attemptTimeout, { force: true }).catch(() => { });
                await page.waitForTimeout(400);
            }
            await page.mouse.click(10, 10).catch(() => { });
            await esperarOverlayCarga(page, { timeout: Math.min(timeout, 15000) }).catch(() => { });
            await page.waitForTimeout(1200);
        }
    }
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
    // Los radios pueden existir pero estar hidden; los montos normalmente viven en los labels.
    await page.waitForSelector('label[for^="insuranceRadio_"]', {
        state: "attached",
        timeout,
    });

    const opciones = await page.locator('label[for^="insuranceRadio_"]').evaluateAll((els) => {
        return els
            .map((label) => {
                const forId = label.getAttribute("for") || "";
                const aseguradora = forId.replace(/^insuranceRadio_/, "").trim();
                const monto = (label.textContent || "").trim();
                return { aseguradora, monto };
            })
            .filter((x) => x.aseguradora);
    });

    return Array.isArray(opciones) ? opciones : [];
}

// Espera a que la tabla exista y (si aplica) a que al menos una prima sea > 0,
// sin "recargar/togglear" selects (eso suele reiniciar el cálculo del portal).
// Regresa temprano si detecta una prima > 0, pero si no, devuelve el último snapshot (posiblemente $0.00).
async function esperarTablaSeguroLista(page, timeoutMs = 60000, pollMs = 1000) {
    const start = Date.now();
    let last = [];

    while (Date.now() - start < timeoutMs) {
        const opciones = await obtenerOpcionesSeguro(page, 5000).catch(() => null);
        if (Array.isArray(opciones) && opciones.length) last = opciones;

        // Aunque siga el overlay, si ya hay primas (>0) devolvemos.
        if (tablaSeguroValida(last)) return last;

        await page.waitForTimeout(pollMs);
    }

    return last;
}
function parseMontoSeguro(raw) {
    const text = String(raw || "").trim();
    if (!text) return 0;
    const normalized = text.replace(/,/g, "");
    const numberLike = normalized.replace(/[^0-9.]/g, "");
    const n = Number(numberLike);
    return Number.isFinite(n) ? n : 0;
}

function signatureOpcionesSeguro(opciones) {
    if (!Array.isArray(opciones)) return "";
    return opciones
        .map((o) => `${normalizeUppercase(o.aseguradora)}=${String(o.monto || "").trim()}`)
        .join("|");
}

async function esperarTablaSeguroCargada(page, timeout = 30000, pollMs = 1000, previousSignature = "") {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        // En esta etapa el portal suele poner overlays (blockUI / contenedor_carga).
        // No fallamos aquí: solo damos chance a que libere la UI antes de leer la tabla.
        await esperarOverlayCarga(page, { timeout: Math.min(5000, pollMs * 5) }).catch(() => { });

        const opciones = await obtenerOpcionesSeguro(page, 5000).catch(() => []);
        const sig = signatureOpcionesSeguro(opciones);
        const changed = !previousSignature || sig !== previousSignature;

        if (changed && tablaSeguroValida(opciones)) {
            // Regresamos TODAS las aseguradoras; la validez solo exige que al menos una tenga monto > 0.
            return opciones;
        }

        await page.waitForTimeout(pollMs);
    }

    return null;
}

async function esperarTablaSeguroActualizada(page, previousSignature, timeout = 60000, pollMs = 1000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        await esperarOverlayCarga(page, { timeout: Math.min(5000, pollMs * 5) }).catch(() => { });

        const opciones = await obtenerOpcionesSeguro(page, 5000).catch(() => []);
        const sig = signatureOpcionesSeguro(opciones);

        if (sig && sig !== previousSignature && tablaSeguroValida(opciones)) {
            // Regresamos TODAS las aseguradoras; la validez solo exige que al menos una tenga monto > 0.
            return opciones;
        }

        await page.waitForTimeout(pollMs);
    }

    return null;
}

async function recargarTablaSeguroDesdeSelector(page, selectorRecarga, valorCorrecto, timeout = 30000) {
    const before = await obtenerOpcionesSeguro(page, 2000).catch(() => []);
    const beforeSig = signatureOpcionesSeguro(before);

    const desired = normalizeString(valorCorrecto);
    await esperarYSeleccionar(page, selectorRecarga, desired, Math.min(60000, timeout));
    await page.waitForTimeout(500);
    await esperarOverlayCarga(page, { timeout: Math.min(60000, timeout) }).catch(() => { });

    // Si el portal termina de cargar durante la ventana, regresamos sin forzar toggles.
    const updated = await esperarTablaSeguroActualizada(page, beforeSig, Math.min(60000, timeout), 1000);
    if (updated) return updated;

    const options = await page
        .locator(selectorRecarga)
        .first()
        .evaluate((el) => {
            const sel = el;
            return Array.from(sel.options || []).map((o) => String(o.value || ""));
        })
        .catch(() => []);

    const alt = options.find((v) => v && String(v) !== String(desired));
    if (alt) {
        await esperarYSeleccionar(page, selectorRecarga, alt, Math.min(60000, timeout)).catch(() => { });
        await page.waitForTimeout(500);
        await esperarOverlayCarga(page, { timeout: Math.min(60000, timeout) }).catch(() => { });
    }

    // Re-selecciona el valor correcto para forzar recarga.
    await esperarYSeleccionar(page, selectorRecarga, desired, Math.min(60000, timeout)).catch(async () => {
        await page
            .locator(selectorRecarga)
            .first()
            .evaluate((el, val) => {
                const select = el;
                select.value = String(val);
                select.dispatchEvent(new Event("input", { bubbles: true }));
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }, desired)
            .catch(() => { });
    });

    await page.waitForTimeout(500);
    await esperarOverlayCarga(page, { timeout: Math.min(60000, timeout) }).catch(() => { });

    return esperarTablaSeguroActualizada(page, beforeSig, timeout, 1000);
}
async function esperarTablaSeguroConRecarga(page, selectorRecarga, valorCorrecto, options = {}) {
    const timeoutInicial = options.timeoutInicial ?? 15000;
    const timeoutRecarga = options.timeoutRecarga ?? 30000;

    const before = await obtenerOpcionesSeguro(page, 2000).catch(() => []);
    const beforeSig = signatureOpcionesSeguro(before);

    // Evita recargar demasiado rápido: deja al portal terminar primero, pero retorna temprano si ya cargó.
    const timeoutInicialEfectivo = Math.max(25000, timeoutInicial);
    let tabla = await esperarTablaSeguroCargada(page, timeoutInicialEfectivo, 1000, beforeSig);

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

    const montosValidos = opciones.filter((x) => parseMontoSeguro(x.monto) > 0);
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
async function etapaLogin(page, { usuario, password } = {}) {
    if (empty(usuario) || empty(password)) {
        throw new Error("Faltan credenciales (usuario/password).");
    }
    await page.goto(CETELEM_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });

    await page.fill('input[name="userName"]', usuario);
    await clickConOverlay(page, "#btnEntrar", { timeout: 90000 });

    await page.fill('input[name="userPassword"]', password);

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
    // A veces el portal muestra un popup con boton "Ok" despues de capturar la fecha.
    await cerrarPopupOkGenericoSiExiste(popup).catch(() => { });

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
    const nivelDetalle = normalizeString(data?.nivel_detalle ?? data?.nivelDetalle).toLowerCase();
    const isPlanesDisponibles = nivelDetalle === "planes_disponibles";

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

    // En modo `planes_disponibles` no se selecciona plan: se consulta la lista.
    if (!isPlanesDisponibles && !empty(c.creditDepositPlan)) {
        await esperarYSeleccionar(popup, "#creditDepositPlan", c.creditDepositPlan);
    }

    if (!isPlanesDisponibles && !empty(c.creditDepositTerm)) {
        await esperarYSeleccionar(popup, "#creditDepositTerm", c.creditDepositTerm);
    }
}

/* =========================
   ETAPA 6.1 - PLANES DISPONIBLES
========================= */
async function etapaPlanesDisponibles(popup) {
    const hooks = popup?.__rpaHooks;

    const waitForSelectOptions = async (selector, { timeout = 60000 } = {}) => {
        try {
            await popup.waitForFunction(
                (sel) => {
                    const nodes = Array.from(document.querySelectorAll(sel));
                    const select = nodes.find((n) => n && n.tagName === "SELECT" && !n.disabled);
                    if (!select) return false;
                    return (select.options?.length || 0) > 1;
                },
                selector,
                { timeout }
            );
            return true;
        } catch {
            return false;
        }
    };

    const mapOptions = (snap) => {
        const options = Array.isArray(snap?.options) ? snap.options : [];
        return options
            .map((o) => ({
                value: String(o?.value ?? "").trim(),
                label: String(o?.label ?? "").trim(),
                selected: o?.selected === true,
            }))
            .filter((o) => o.label);
    };

    if (hooks?.onProgress) {
        await hooks.onProgress({ page: popup, message: "Consultando planes disponibles (#creditDepositPlan)" }).catch(() => { });
    }

    await esperarOverlayCarga(popup, { timeout: 60000 }).catch(() => { });

    await waitForSelectOptions("#creditDepositPlan", { timeout: 60000 });
    const planLocator = await getBestSelectLocator(popup, "#creditDepositPlan");
    const planSnap = await snapshotSelect(planLocator);
    const planes = mapOptions(planSnap);

    const planesFiltrados = planes.filter((p) => {
        const v = String(p.value || "").trim();
        const l = String(p.label || "").trim().toLowerCase();
        if (!v) return false;
        if (v === "-1") return false;
        if (l.includes("seleccione")) return false;
        return true;
    });

    if (!planesFiltrados.length) {
        return {
            estatus_code: 0,
            nivel_detalle: "planes_disponibles",
            mensaje_det: "No se encontraron planes disponibles en el portal.",
            planes: [],
        };
    }

    return {
        estatus_code: 1,
        nivel_detalle: "planes_disponibles",
        mensaje_det: `${planesFiltrados.length} planes obtenidos correctamente.`,
        planes: planesFiltrados.map((p) => ({
            id: String(p.value || "").trim(),
            nombre: String(p.label || "").trim(),
        })),
    };
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
    await popup.waitForTimeout(3000);

    await waitUntilEnabled(popup, "#insuranceRecruitment", { timeout: 60000, pollMs: 300 });
    await esperarYSeleccionar(popup, "#insuranceRecruitment", s.insuranceRecruitment);
    await popup.waitForTimeout(3000);

    await waitUntilEnabled(popup, "#insuranceType", { timeout: 60000, pollMs: 300 });
    await esperarYSeleccionar(popup, "#insuranceType", s.insuranceType);
    await popup.waitForTimeout(3000);

    const paymentTermSelector = await resolveFirstExistingSelector(
        popup,
        [
            "#insurancePaymentTermRemnant",
            "#insuranceTermRemnant",
            "select[name='insurancePaymentTermRemnant']",
            "select[name='insuranceTermRemnant']",
        ],
        { timeout: 15000 }
    );

    await waitUntilEnabled(popup, paymentTermSelector, { timeout: 60000, pollMs: 300 });
    await reintentarSelectDependiente(popup, {
        dependeDe: [
            { selector: "#insuranceType", value: s.insuranceType },
            { selector: "#insuranceRecruitment", value: s.insuranceRecruitment },
        ],
        objetivo: { selector: paymentTermSelector, value: s.insurancePaymentTermRemnant },
        timeout: 60000,
        reintentos: 2,
    });
    await popup.waitForTimeout(3000);

    await waitUntilEnabled(popup, "#insuranceCoverageLorant", { timeout: 60000, pollMs: 300 });
    await esperarYSeleccionar(
        popup,
        "#insuranceCoverageLorant",
        normalizeUppercase(s.insuranceCoverageLorant)
    );

    await popup.mouse.click(10, 10).catch(() => {});
    // El portal a veces deja el overlay visible aunque la tabla ya estÃ© en DOM.
    // No bloqueamos 60s aquÃ­; la funciÃ³n de espera de tabla hara polling y regresara temprano si ya hay primas.
    await esperarOverlayCarga(popup, { timeout: 5000 }).catch(() => {});

    const opcionesSeguro = await esperarTablaSeguroLista(popup, 60000);

    if (!Array.isArray(opcionesSeguro) || opcionesSeguro.length === 0) {
        throw new Error("No se obtuvieron primas de seguro (tabla vacía).");
    }

    if (soloListaAseguradoras || empty(s.insuranceOption)) {
        // En modo "seguros" devolvemos solo aquellas con prima > 0.
        return opcionesSeguro.filter((x) => parseMontoSeguro(x?.monto) > 0);
    }

    await esperarYSeleccionarAseguradora(popup, s.insuranceOption, 120000);
    await popup.waitForTimeout(3000);

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

function inferIsVehiculoNuevo(data) {
    const v = data?.vehiculo || {};
    const raw = normalizeUppercase(v.vehicleType ?? v.tipo_vehiculo ?? "");
    if (!raw) return true;
    if (raw === "N") return true;
    if (raw === "S") return false;
    if (raw.includes("SEMINUEVO")) return false;
    if (raw.includes("NUEVO")) return true;
    return true;
}

async function tryFillSeguroUbicacion(popup, { isNuevo, cp, estado }) {
    const cpValue = normalizeString(cp);
    const estadoValue = normalizeUppercase(estado);

    if (isNuevo) {
        await waitUntilEnabled(popup, "#insuranceCP", { timeout: 60000, pollMs: 300 });
        await esperarYLlenar(popup, "#insuranceCP", cpValue);
        await popup.mouse.click(10, 10);
        await popup.waitForTimeout(3000);
        return;
    }

    // Seminuevo: normalmente el portal pide estado (no CP). Intentar select/inputs conocidos.
    const candidates = [
        "#insuranceState",
        "#insuranceEstado",
        "select[name='insuranceState']",
        "select[name='estado']",
        "#estado",
    ];

    for (const sel of candidates) {
        const count = await popup.locator(sel).count().catch(() => 0);
        if (count <= 0) continue;

        // Si es select, seleccionar; si es input, llenar.
        const tag = await popup.locator(sel).first().evaluate((el) => el?.tagName || "").catch(() => "");
        if (String(tag).toUpperCase() === "SELECT") {
            await waitUntilEnabled(popup, sel, { timeout: 60000, pollMs: 300 });
            await esperarYSeleccionar(popup, sel, estadoValue);
        } else {
            await waitUntilEnabled(popup, sel, { timeout: 60000, pollMs: 300 });
            await esperarYLlenarUpper(popup, sel, estadoValue);
        }

        await popup.mouse.click(10, 10);
        await popup.waitForTimeout(3000);
        return;
    }

    // Fallback: si no existe campo de estado, intentar CP si viene informado.
    if (!empty(cpValue)) {
        await waitUntilEnabled(popup, "#insuranceCP", { timeout: 60000, pollMs: 300 });
        await esperarYLlenar(popup, "#insuranceCP", cpValue);
        await popup.mouse.click(10, 10);
        await popup.waitForTimeout(3000);
        return;
    }

    throw new Error("No encontrÃ© campo de ubicaciÃ³n del seguro para seminuevo (estado/CP).");
}

async function seleccionarAseguradoraSeguro(page, aseguradora, timeout = 120000) {
    const key = normalizeUppercase(aseguradora);
    const selector = `#insuranceRadio_${key}`;

    await page.waitForSelector(selector, { state: "attached", timeout });

    const disabled = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const disabledProp = Boolean(el.disabled);
        const disabledAttr = el.getAttribute?.("disabled") !== null;
        const ariaDisabled = String(el.getAttribute?.("aria-disabled") || "").toLowerCase() === "true";
        return disabledProp || disabledAttr || ariaDisabled;
    }, selector).catch(() => null);

    if (disabled === true) {
        return { ok: false, selector, aseguradora: key, reason: "disabled" };
    }

    await page.locator(selector).check().catch(async () => {
        await page.locator(selector).click({ force: true });
    });

    await page.waitForTimeout(1500);
    return { ok: true, selector, aseguradora: key };
}

function extractPrimasPorPlazoFromMultiterm(multitermJson, aseguradoraUpper) {
    const aseguradora = normalizeUppercase(aseguradoraUpper);
    const out = {};
    if (!multitermJson || typeof multitermJson !== "object") return out;

    const seen = new Set();
    const stack = [multitermJson];
    let visited = 0;
    const maxNodes = 8000;

    const normalizeTerm = (t) => {
        const m = String(t ?? "").match(/\d+/);
        return m ? String(Number(m[0])) : "";
    };

    const consider = (term, premium) => {
        const k = normalizeTerm(term);
        const p = parseMoneyNumber(premium);
        if (!k) return;
        if (!Number.isFinite(p) || p <= 0) return;
        out[k] = p;
    };

    while (stack.length && visited < maxNodes) {
        const node = stack.pop();
        visited += 1;

        if (!node) continue;
        if (typeof node !== "object") continue;

        if (seen.has(node)) continue;
        seen.add(node);

        if (Array.isArray(node)) {
            for (const item of node) stack.push(item);
            continue;
        }

        const obj = node;

        const insurerKeys = ["aseguradora", "insurer", "carrier", "company", "insuranceOption", "nombre", "name"];
        const matchedInsurer = insurerKeys.some((k) => normalizeUppercase(obj[k] ?? "") === aseguradora)
            || Object.values(obj).some((v) => typeof v === "string" && normalizeUppercase(v) === aseguradora);

        if (matchedInsurer) {
            consider(obj.plazo ?? obj.term ?? obj.months ?? obj.meses ?? obj.periodo ?? obj.period ?? obj.installments, obj.prima ?? obj.premium ?? obj.amount ?? obj.totalPremium ?? obj.primaTotal ?? obj.total);

            const arrayKeys = ["plazos", "terms", "multiterm", "primas", "premiums", "opciones", "options", "cotizaciones", "quotes"];
            for (const k of arrayKeys) {
                if (Array.isArray(obj[k])) {
                    for (const row of obj[k]) stack.push(row);
                }
            }
        }

        for (const v of Object.values(obj)) {
            if (v && typeof v === "object") stack.push(v);
        }
    }

    return out;
}

async function readSelectedValue(page, selector) {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: "attached", timeout: 15000 });
    return await loc.evaluate((el) => {
        if (!el) return "";
        const tag = String(el.tagName || "").toUpperCase();
        if (tag === "SELECT") return String(el.value || "");
        return String(el.value || el.getAttribute?.("value") || "");
    }).catch(() => "");
}

async function etapaSeleccionSeguro(popup, data) {
    const s = data?.seguro || {};
    const c = data?.credito || {};

    const aseguradoraElegida = normalizeUppercase(s.insuranceOption);
    if (empty(aseguradoraElegida)) {
        return {
            aseguradora: null,
            prima_seleccionada: null,
            anualidad_requerida: false,
            rango_anualidad: { minimo: null, maximo: null },
            estatus_code: 0,
            mensaje_det: "Falta campo requerido: aseguradora_seleccionada",
        };
    }

    const isNuevo = inferIsVehiculoNuevo(data);
    const cp = s.insuranceCP ?? s.codigo_postal ?? "";
    const estado = s.insuranceState ?? s.estado ?? "";

    const collector = createApiJsonCollector(popup, { urlIncludes: "calculateMultiterm" });

    try {
        await tryFillSeguroUbicacion(popup, { isNuevo, cp, estado });

        await waitUntilEnabled(popup, "#insuranceRecruitment", { timeout: 60000, pollMs: 300 });
        await esperarYSeleccionar(popup, "#insuranceRecruitment", s.insuranceRecruitment);
        await popup.waitForTimeout(3000);

        await waitUntilEnabled(popup, "#insuranceType", { timeout: 60000, pollMs: 300 });
        await esperarYSeleccionar(popup, "#insuranceType", s.insuranceType);
        await popup.waitForTimeout(3000);

        await waitUntilEnabled(popup, "#insurancePaymentTermRemnant", { timeout: 60000, pollMs: 300 });
        await esperarYSeleccionar(popup, "#insurancePaymentTermRemnant", s.insurancePaymentTermRemnant);
        await popup.waitForTimeout(3000);

        await waitUntilEnabled(popup, "#insuranceCoverageLorant", { timeout: 60000, pollMs: 300 });
        await esperarYSeleccionar(popup, "#insuranceCoverageLorant", normalizeUppercase(s.insuranceCoverageLorant));

        await popup.mouse.click(10, 10).catch(() => { });
        await esperarOverlayCarga(popup, { timeout: 5000 }).catch(() => { });

        const opcionesSeguro = await esperarTablaSeguroLista(popup, 60000);
        if (!Array.isArray(opcionesSeguro) || opcionesSeguro.length === 0) {
            return {
                aseguradora: aseguradoraElegida,
                prima_seleccionada: null,
                anualidad_requerida: false,
                rango_anualidad: { minimo: null, maximo: null },
                estatus_code: 0,
                mensaje_det: "No se obtuvieron primas de seguro (tabla vacÃ­a).",
            };
        }

        const sel = await seleccionarAseguradoraSeguro(popup, aseguradoraElegida, 120000);
        if (!sel.ok) {
            return {
                aseguradora: aseguradoraElegida,
                prima_seleccionada: null,
                anualidad_requerida: false,
                rango_anualidad: { minimo: null, maximo: null },
                estatus_code: 0,
                mensaje_det: `Aseguradora no esta disponible: ${aseguradoraElegida}`,
            };
        }

        await popup.waitForTimeout(3000);

        const plazoActual = normalizeString(await readSelectedValue(popup, "#creditDepositTerm")) || normalizeString(c.creditDepositTerm);

        // Intenta leer calculateMultiterm (puede venir antes o despuÃ©s de seleccionar aseguradora).
        await collector.waitForFirst(15000).catch(() => { });
        const multitermJson = collector.getLatest()?.json ?? null;
        const primasPorPlazo = extractPrimasPorPlazoFromMultiterm(multitermJson, aseguradoraElegida);

        let primaSeleccionada = null;
        if (plazoActual && primasPorPlazo && primasPorPlazo[String(Number(plazoActual))] !== undefined) {
            primaSeleccionada = primasPorPlazo[String(Number(plazoActual))];
        }

        if (primaSeleccionada === null) {
            const seleccionada = opcionesSeguro.find((x) => normalizeUppercase(x?.aseguradora) === aseguradoraElegida);
            const monto = seleccionada ? parseMontoSeguro(seleccionada.monto) : 0;
            if (monto > 0) primaSeleccionada = monto;
        }

        // Mensaje de anualidad: el portal suele pintarlo en el bloque con id "18n_customer_anualidad_maxmin".
        // Se espera a que sea visible y se lee con innerText(); si no aparece, se intenta un fallback (best-effort).
        const anualidadLocator = popup.locator("[id='18n_customer_anualidad_maxmin']").first();
        const anualidadVisible = await anualidadLocator
            .waitFor({ state: "visible", timeout: 15000 })
            .then(() => true)
            .catch(() => false);

        const anualidadMsg = anualidadVisible
            ? await anualidadLocator.innerText().catch(() => "")
            : await readAnualidadMaxMinMessage(popup).catch(() => "");

        const anualidadMessage = String(anualidadMsg || "").trim();
        const range = anualidadMessage ? parseAnualidadRangeFromText(anualidadMessage) : null;

        return {
            aseguradora: aseguradoraElegida,
            prima_seleccionada: typeof primaSeleccionada === "number" && Number.isFinite(primaSeleccionada) ? primaSeleccionada : null,
            primas_por_plazo: primasPorPlazo && Object.keys(primasPorPlazo).length ? primasPorPlazo : null,
            anualidad_requerida: Boolean(anualidadMessage),
            rango_anualidad: {
                minimo: range?.min ?? null,
                maximo: range?.max ?? null,
            },
            estatus_code: typeof primaSeleccionada === "number" && Number.isFinite(primaSeleccionada) ? 1 : 0,
            mensaje_det: typeof primaSeleccionada === "number" && Number.isFinite(primaSeleccionada) ? "EXITOSO" : "No se pudo determinar prima seleccionada",
        };
    } finally {
        collector.dispose();
    }
}

function parseMoneyNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0.0;
    const cleaned = raw.replace(/[$\s]/g, "").replace(/,/g, "").replace(/[^\d.-]/g, "");
    const num = Number.parseFloat(cleaned);
    return Number.isFinite(num) ? num : 0.0;
}

function parseMoneyFromText(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const cleaned = raw.replace(/[$\s]/g, "").replace(/,/g, "").replace(/[^\d.-]/g, "");
    const num = Number.parseFloat(cleaned);
    return Number.isFinite(num) ? num : null;
}

function parseAnualidadRangeFromText(text) {
    const raw = String(text || "");
    // Ej: "Su importe de anualidad debe estar entre $16,237 y $32,474"
    // Se esperan 2 importes con formato moneda: $[\d,]+
    const matches = raw.match(/\$[\d,]+/g) || [];
    const nums = matches
        .map((m) => {
            const cleaned = String(m).replace(/[$\s]/g, "").replace(/,/g, "");
            const n = Number.parseInt(cleaned, 10);
            return Number.isFinite(n) ? n : null;
        })
        .filter((n) => typeof n === "number" && Number.isFinite(n));
    if (nums.length < 2) return null;
    const min = Math.min(nums[0], nums[1]);
    const max = Math.max(nums[0], nums[1]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max };
}

async function readAnualidadMaxMinMessage(page) {
    try {
        const text = await page.evaluate(() => {
            const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();

            const pick = (el) => {
                const t = normalize(el?.innerText || el?.textContent);
                return t || "";
            };

            const matchesRangeMessage = (t) => {
                const lower = String(t || "").toLowerCase();
                if (!lower) return false;
                // Mensajes típicos: "La anualidad debe estar entre $X y $Y", "debe estar entre ...", "mínimo/máximo".
                const hasBetween = lower.includes("debe estar entre") || lower.includes("entre $") || (lower.includes("entre") && lower.includes("$"));
                const hasMinMax = lower.includes("mín") || lower.includes("min") || lower.includes("máx") || lower.includes("max");
                const mentionsAnualidad = lower.includes("anualidad") || lower.includes("anualid");
                return (mentionsAnualidad && (hasBetween || hasMinMax)) || (hasBetween && mentionsAnualidad);
            };

            const candidates = [];
            candidates.push(document.querySelector("[id='18n_customer_anualidad_maxmin']"));
            candidates.push(document.querySelector('output[for="anualidadMaxMin"]'));
            candidates.push(document.querySelector('output[for*="anualidad"]'));
            candidates.push(document.querySelector('#anualidadMaxMin'));
            candidates.push(document.querySelector('[id*="anualidad"][id*="maxmin"]'));
            candidates.push(document.querySelector('[id*="anualidad"][class*="alert"]'));
            candidates.push(document.querySelector('#18n_customer_anualidad_maxmin'));

            for (const el of candidates.filter(Boolean)) {
                const t = pick(el);
                if (t) return t;
            }

            // Cerca del campo (por si el portal pinta el mensaje como helper/validation).
            const annuityEl = document.querySelector("#annuityAmount") || document.querySelector("#annuityMonth");
            if (annuityEl) {
                const group =
                    annuityEl.closest(".form-group") ||
                    annuityEl.closest(".field") ||
                    annuityEl.closest("td") ||
                    annuityEl.closest("tr") ||
                    annuityEl.parentElement;

                if (group) {
                    const near = Array.from(group.querySelectorAll("output,div,span,p,small,label"))
                        .map((el) => pick(el))
                        .filter(Boolean);
                    const found = near.find(matchesRangeMessage);
                    if (found) return found;
                }

                const sibling = annuityEl.nextElementSibling;
                if (sibling) {
                    const t = pick(sibling);
                    if (matchesRangeMessage(t)) return t;
                }
            }

            // Fallback: busca cualquier texto que parezca el mensaje.
            const all = Array.from(document.querySelectorAll("output,div,span,p,small"));
            for (const el of all) {
                const t = pick(el);
                if (!t) continue;
                if (matchesRangeMessage(t)) {
                    return t;
                }
            }

            return "";
        });

        const trimmed = String(text || "").trim();
        if (trimmed) return trimmed;

        // A veces el mensaje se pinta con un pequeño delay tras disparar onchange/validación.
        await page.waitForTimeout(250).catch(() => { });
        const retry = await page.evaluate(() => {
            const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
            const all = Array.from(document.querySelectorAll("output,div,span,p,small"));
            for (const el of all) {
                const t = normalize(el?.innerText || el?.textContent);
                if (!t) continue;
                const lower = t.toLowerCase();
                if (
                    (lower.includes("anualidad") || lower.includes("anualid")) &&
                    (lower.includes("debe estar entre") || lower.includes("entre $") || (lower.includes("entre") && lower.includes("$")))
                ) {
                    return t;
                }
            }
            return "";
        }).catch(() => "");

        return String(retry || "").trim();
    } catch {
        return "";
    }
}

async function readVisibleValidationPrompts(page) {
    if (!page) return [];

    try {
        const prompts = await page.evaluate(() => {
            const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
            const isVisible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (!style) return false;
                if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
                const rect = el.getBoundingClientRect?.();
                if (!rect) return true;
                return rect.width > 0 && rect.height > 0;
            };

            return Array.from(document.querySelectorAll(".formErrorContent, .formError .formErrorContent"))
                .filter((el) => isVisible(el))
                .map((el) => normalize(el?.innerText || el?.textContent))
                .filter(Boolean);
        });

        return Array.isArray(prompts) ? prompts : [];
    } catch {
        return [];
    }
}

async function readFormErrorSnapshot(page) {
    if (!page) return { content: "", field: "" };

    try {
        const snap = await page.evaluate(() => {
            const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();

            const isVisible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (!style) return false;
                if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
                const rect = el.getBoundingClientRect?.();
                if (!rect) return true;
                return rect.width > 0 && rect.height > 0;
            };

            const pickText = (el) => normalize(el?.innerText || el?.textContent);

            const getLabelForInput = (input) => {
                if (!input) return "";
                const id = input.getAttribute?.("id");
                if (id && window.CSS && CSS.escape) {
                    const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                    const t = pickText(l);
                    if (t) return t;
                }
                const wrapLabel = input.closest("label");
                const wt = pickText(wrapLabel);
                if (wt) return wt;
                const group = input.closest(".form-group") || input.closest(".field") || input.closest("td") || input.closest("tr");
                if (group) {
                    const lab = group.querySelector("label");
                    const t = pickText(lab);
                    if (t) return t;
                }
                return "";
            };

            const candidates = [
                document.querySelector("#formErrorContent"),
                document.querySelector(".formErrorContent"),
                document.querySelector(".messager-body:visible"),
                document.querySelector(".messager-body"),
            ].filter(Boolean);

            let content = "";
            for (const el of candidates) {
                if (!isVisible(el)) continue;
                const t = pickText(el);
                if (t) { content = t; break; }
            }
            if (!content) return { content: "", field: "" };

            const needle = "por favor seleccione";
            const errorEls = Array.from(document.querySelectorAll("div,span,small,p,li"))
                .filter((el) => isVisible(el))
                .map((el) => ({ el, t: pickText(el) }))
                .filter((x) => x.t && x.t.toLowerCase().includes(needle));

            for (const { el } of errorEls) {
                const scope = el.closest(".form-group") || el.closest(".field") || el.closest("td") || el.closest("tr") || el.parentElement;
                const input = scope?.querySelector?.("select, input, textarea");
                const label = getLabelForInput(input);
                const id = input?.getAttribute?.("id") || "";
                if (label || id) {
                    return { content, field: label ? `${label}${id ? ` (#${id})` : ""}` : (id ? `#${id}` : "") };
                }
            }

            const invalid = Array.from(document.querySelectorAll("select, input, textarea"))
                .filter((el) => isVisible(el))
                .filter((el) => {
                    const aria = String(el.getAttribute?.("aria-invalid") || "").toLowerCase() === "true";
                    const cls = String(el.className || "").toLowerCase();
                    return aria || cls.includes("invalid") || cls.includes("error");
                })[0];

            if (invalid) {
                const label = getLabelForInput(invalid);
                const id = invalid.getAttribute?.("id") || "";
                return { content, field: label ? `${label}${id ? ` (#${id})` : ""}` : (id ? `#${id}` : "") };
            }

            return { content, field: "" };
        });

        const content = String(snap?.content || "").trim();
        const field = String(snap?.field || "").trim();
        if (!content) return { content: "", field: "" };
        const clipped = content.length > 800 ? `${content.slice(0, 799)}…` : content;
        return { content: clipped, field };
    } catch {
        return { content: "", field: "" };
    }
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

    await btn.scrollIntoViewIfNeeded().catch(() => { });

    try {
        await btn.click({ timeout: 5000 });
    } catch {
        await btn.click({ force: true });
    }

    return true;
}

async function readFolioFromGuardadoPopup(page) {
    try {
        const text = await page.evaluate(() => {
            const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
            const visible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                return style && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
            };

            const bodies = Array.from(document.querySelectorAll(".messager-body, .window-body, .panel-body"))
                .filter((el) => visible(el))
                .map((el) => normalize(el.innerText || el.textContent))
                .filter(Boolean);

            return bodies.join(" | ");
        });

        const raw = String(text || "");
        if (!raw) return "";

        const m =
            raw.match(/cotizaci[oó]n\s+guardada\s+exitosamente\s+(\d+)/i) ||
            raw.match(/guardada\s+exitosamente\s+(\d+)/i) ||
            raw.match(/exitosamente\s+(\d+)/i);

        return m ? String(m[1] || "").trim() : "";
    } catch {
        return "";
    }
}

async function etapaGuardarCotizacion(popup, data) {
    const hooks = popup?.__rpaHooks;

    const cot = data?.cotizacion || {};

    function detectCreditPlanCA(label) {
        const raw = String(label || "");
        if (!raw.trim()) return false;
        // Acepta variaciones comunes: "C/A", "C / A", "CA", "C.A.", etc.
        return /(^|[^A-Z])C\s*\/?\s*A([^A-Z]|$)/i.test(raw);
    }

    // Campos de anualidad: solo aplicar si el plan de crédito seleccionado es C/A.
    // (El label del select #creditDepositPlan suele traer "C/A" cuando aplica.)
    function parseAnnuityMonthFromCreditPlanLabel(label) {
        const raw = normalizeString(label);
        if (!raw) return "";

        // Formatos observados: "C/A 04-26", "C/A 4/26", etc.
        // Nota: el label puede traer otros números antes (ej. "11.84 C/A 04-26 PF 127"),
        // por eso buscamos específicamente el mes/año después de C/A.
        const m = raw.match(/C\s*\/?\s*A\s*([0-1]?\d)\s*[-/]\s*(\d{2,4})/i);
        if (!m) return "";

        const monthNum = Number(m[1]);
        if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) return "";
        return String(monthNum).padStart(2, "0");
    }

    let creditDepositPlanLabel = "";
    try {
        const creditPlanLocator = await getBestSelectLocator(popup, "#creditDepositPlan");
        const snap = await snapshotSelect(creditPlanLocator);
        creditDepositPlanLabel = String(snap?.selectedLabel ?? "").trim();
    } catch { }

    const isCreditPlanCA = detectCreditPlanCA(creditDepositPlanLabel);
    const inferredAnnuityMonth = empty(cot.annuityMonth)
        ? parseAnnuityMonthFromCreditPlanLabel(creditDepositPlanLabel)
        : "";

    if (isCreditPlanCA && empty(cot.annuityMonth) && inferredAnnuityMonth) {
        cot.annuityMonth = inferredAnnuityMonth;
    }

    logger.info(
        `[cotizacion] anualidad: planLabel="${creditDepositPlanLabel || "N/A"}" isCA=${isCreditPlanCA} annuityMonth="${normalizeString(cot.annuityMonth)}" annuityAmount="${normalizeString(cot.annuityAmount)}" inferredMonth="${inferredAnnuityMonth}"`
    );
    if (isCreditPlanCA) {
        if (empty(cot.annuityMonth) && empty(cot.annuityAmount)) {
            logger.warn(
                `[cotizacion] anualidad: plan C/A detectado pero no se recibieron campos (annuityMonth/annuityAmount). planLabel="${creditDepositPlanLabel || "N/A"}"`
            );
        }

        if (!empty(cot.annuityMonth)) {
            const monthValue = normalizeAnnuityMonth(cot.annuityMonth);
            if (monthValue) {
                await esperarYSeleccionar(popup, "#annuityMonth", monthValue, 60000);

                // Al seleccionar el mes, el portal suele mostrar el rango permitido.
                // Si ya tenemos un importe a enviar y está fuera del rango, fallar desde aquí con evidencia.
                const desiredAmountPre = cot.annuityAmount !== undefined && cot.annuityAmount !== null ? String(cot.annuityAmount).replace(/,/g, "").trim() : "";
                const desiredNumPre = desiredAmountPre ? parseMoneyFromText(desiredAmountPre) : null;
                if (desiredAmountPre && typeof desiredNumPre === "number") {
                    const rangeMsgPre = await readAnualidadMaxMinMessage(popup).catch(() => "");
                    const rangePre = rangeMsgPre ? parseAnualidadRangeFromText(rangeMsgPre) : null;
                    if (rangeMsgPre && rangePre && (desiredNumPre < rangePre.min || desiredNumPre > rangePre.max)) {
                        const sentLine = `Anualidad enviada: ${desiredAmountPre || "?"} | Mes anualidad: ${monthValue}`;
                        const prompts = await readVisibleValidationPrompts(popup).catch(() => []);
                        const promptLine = Array.isArray(prompts) && prompts.length ? `Validación: ${prompts.join(" | ")}` : "";
                        const errorMsg = `${rangeMsgPre}\n${sentLine}${promptLine ? `\n${promptLine}` : ""}`;
                        if (hooks?.onProgress) {
                            await hooks.onProgress({ page: popup, message: errorMsg }).catch(() => { });
                        }
                        if (hooks?.onErrorScreenshot) {
                            await hooks.onErrorScreenshot({ page: popup }).catch(() => { });
                        }
                        throw new Error(errorMsg);
                    }
                }
            }
        }

        if (
            cot.annuityAmount !== undefined &&
            cot.annuityAmount !== null &&
            String(cot.annuityAmount).trim() !== ""
        ) {
            const desiredAmount = String(cot.annuityAmount).replace(/,/g, "").trim();
            const desiredNum = parseMoneyFromText(desiredAmount);

            await popup.waitForSelector("#annuityAmount", { state: "visible", timeout: 15000 });
            await popup.waitForFunction(
                (sel) => {
                    const el = document.querySelector(sel);
                    return !!el && !el.disabled;
                },
                "#annuityAmount",
                { timeout: 15000 }
            );

            // 1) fill normal
            await esperarYLlenar(popup, "#annuityAmount", desiredAmount);
            await popup.mouse.click(10, 10).catch(() => { });
            await popup.waitForTimeout(500);

            let after = await popup.locator("#annuityAmount").inputValue().catch(() => "");
            if (normalizeString(after) === "00.00" || normalizeString(after) === "0.00") {
                // 2) fallback: set value + dispatch events (algunos onchange formatean/reset)
                await popup.evaluate(({ sel, val }) => {
                    const el = document.querySelector(sel);
                    if (!el) return;
                    el.value = String(val);
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                }, { sel: "#annuityAmount", val: desiredAmount }).catch(() => { });

                await popup.mouse.click(10, 10).catch(() => { });
                await popup.waitForTimeout(500);
                after = await popup.locator("#annuityAmount").inputValue().catch(() => "");
            }

            logger.info(`[cotizacion] anualidad: annuityAmount desired="${desiredAmount}" after="${after}"`);

            // Mensaje de rango (puede variar el texto/selector). Si el monto queda fuera, falla con el mensaje.
            const rangeMsg = await readAnualidadMaxMinMessage(popup);
            if (rangeMsg) {
                const range = parseAnualidadRangeFromText(rangeMsg);
                const afterNum = parseMoneyFromText(after);

                const outOfRange =
                    typeof desiredNum === "number" &&
                    range &&
                    (desiredNum < range.min || desiredNum > range.max);

                const gotResetToZero = typeof afterNum === "number" && afterNum === 0 && desiredNum !== null && desiredNum !== 0;

                if (outOfRange || gotResetToZero) {
                    const sentLine = `Anualidad enviada: ${desiredAmount || "?"} | Capturada: ${after || "?"}`;
                    const prompts = await readVisibleValidationPrompts(popup).catch(() => []);
                    const promptLine = Array.isArray(prompts) && prompts.length ? `Validación: ${prompts.join(" | ")}` : "";
                    const errorMsg = `${rangeMsg}\n${sentLine}${promptLine ? `\n${promptLine}` : ""}`;
                    if (hooks?.onProgress) {
                        await hooks.onProgress({ page: popup, message: errorMsg }).catch(() => { });
                    }
                    if (hooks?.onErrorScreenshot) {
                        await hooks.onErrorScreenshot({ page: popup }).catch(() => { });
                    }
                    throw new Error(errorMsg);
                }
            }
        }
    } else if (!empty(cot.annuityMonth) || !empty(cot.annuityAmount)) {
        logger.info(
            `[cotizacion] anualidad omitida: creditDepositPlan no es C/A (label="${creditDepositPlanLabel || "N/A"}")`
        );
    }

    const maxWaitSeconds = 20;
    const waitIntervalMs = 500;
    const maxSaveAttempts = 2;
    const saveData = {
        folio: "",
        mensualidad_1: 0.0,
        mensualidad_13: 0.0,
        backend: null,
        request_seen: false,
        http_status: null,
        content_type: "",
        body_snippet: "",
        parse_error: "",
    };

    const routeHandler = async (route) => {
        const response = await route.fetch();

        saveData.request_seen = true;
        saveData.http_status = typeof response?.status === "function" ? response.status() : null;
        const headers = typeof response?.headers === "function" ? response.headers() : {};
        saveData.content_type = String(headers?.["content-type"] || headers?.["Content-Type"] || "").trim();

        try {
            const jsonData = await response.json().catch(() => null);

            if (jsonData && typeof jsonData === "object") {
                saveData.folio = normalizeString(
                    jsonData.folio ??
                    jsonData.numCotizacion ??
                    jsonData.num_cotizacion ??
                    ""
                );

                const mensualidad_1_Raw =
                    jsonData.mensualidad ??
                    jsonData.mensualiteAvecASM ??
                    0.0;
                const mensualidad_13_Raw =
                    jsonData.mensualidad ??
                    jsonData.mensualiteAvecASM ??
                    0.0;
                saveData.mensualidad_1 = Number(mensualidad_1_Raw) || 0.0;
                saveData.mensualidad_13 = Number(mensualidad_13_Raw) || 0.0;
                saveData.backend = jsonData;
                saveData.body_snippet = "";
                saveData.parse_error = "";
            }
        } catch {
            try {
                const text = await response.text().catch(() => "");
                const normalized = String(text || "").replace(/\s+/g, " ").trim();
                saveData.body_snippet = normalized ? `${normalized.slice(0, 600)}${normalized.length > 600 ? "…" : ""}` : "";
                saveData.parse_error = "no_json_response";
            } catch {
                saveData.parse_error = "read_response_failed";
            }
        }

        await route.fulfill({ response });
    };

    // Algunos entornos agregan querystring; el glob con sufijo `**` lo cubre.
    await popup.route("**/cotizacion/save**", routeHandler);

    let folio = null;
    let mensualidad_1 = 0.0;
    let mensualidad_13 = 0.0;
    let backendJson = null;

    try {
        for (let attempt = 1; attempt <= maxSaveAttempts; attempt += 1) {
            saveData.folio = "";
            saveData.mensualidad_1 = 0.0;
            saveData.mensualidad_13 = 0.0;
            saveData.backend = null;
            saveData.request_seen = false;
            saveData.http_status = null;
            saveData.content_type = "";
            saveData.body_snippet = "";
            saveData.parse_error = "";

            if (hooks?.onProgress) {
                await hooks.onProgress({
                    page: popup,
                    message:
                        attempt === 1
                            ? "Guardando cotizacion"
                            : `Reintentando guardar cotizacion (${attempt}/${maxSaveAttempts})`,
                }).catch(() => { });
            }

            const clicked = await clickGuardarCotizacion(popup);

            if (!clicked) {
                return {
                    folio: null,
                    rfc_calculado: null,
                    mensualidad_1: 0.0,
                    mensualidad_13: 0.0,
                    estatus_code: 0,
                    json: saveData.backend || null,
                    mensaje_det: "Error: No se encontro boton para guardar cotizacion.",
                    logs: [],
                    phase_durations: {},
                };
            }

            let gotFolioFromPopup = false;
            let waitedMs = 0;
            while (waitedMs < maxWaitSeconds * 1000 && empty(saveData.folio)) {
                await popup.waitForTimeout(waitIntervalMs);
                waitedMs += waitIntervalMs;

                if (empty(saveData.folio)) {
                    const folioPopup = await readFolioFromGuardadoPopup(popup).catch(() => "");
                    if (folioPopup) {
                        saveData.folio = normalizeString(folioPopup);
                        gotFolioFromPopup = true;
                    }
                }
            }

            if (gotFolioFromPopup && normalizeString(saveData.folio) && !saveData.backend) {
                // El portal puede mostrar el popup antes de que llegue (o se procese) el JSON de /cotizacion/save.
                // Si ya tenemos folio por UI, espera más para capturar backendJson (mensualidades, etc.).
                const extraBackendWaitSeconds = 20;
                const extraBackendWaitIntervalMs = 250;
                let extraWaitMs = 0;
                while (extraWaitMs < extraBackendWaitSeconds * 1000 && !saveData.backend) {
                    await popup.waitForTimeout(extraBackendWaitIntervalMs);
                    extraWaitMs += extraBackendWaitIntervalMs;
                }
            }

            folio = normalizeString(saveData.folio) || null;
            mensualidad_1 = Number(saveData.mensualidad_1) || 0.0;
            mensualidad_13 = Number(saveData.mensualidad_13) || 0.0;
            backendJson =
                saveData.backend && typeof saveData.backend === "object"
                    ? saveData.backend
                    : null;

            if (folio) break;

            if (attempt < maxSaveAttempts) {
                await esperarOverlayCarga(popup, { timeout: 30000 }).catch(() => { });
            }
        }
    } finally {
        await popup.unroute("**/cotizacion/save**", routeHandler).catch(() => { });
    }

    const rfc =
        normalizeString(backendJson?.rfc_calculado) ||
        normalizeString(
            await popup.locator("#customerRfc").first().inputValue().catch(() => "")
        ) ||
        null;

    const pago13Raw =
        normalizeString(backendJson?.importe_pago_13) ||
        (await popup.locator("#importe_pago_13:visible").first().inputValue().catch(() => "")) ||
        (await popup.locator("#importe_pago_13").first().inputValue().catch(() => "")) ||
        (await readValueByLabel(popup, "importe pago 13")) ||
        (await readValueByLabel(popup, "importe pago 13:"));

    const importe_pago_13 = parseMoneyNumber(pago13Raw);

    if (!folio) {
        const baseMsg = "Error: No se recibio folio del servidor tras el guardado.";
        const formSnap = await readFormErrorSnapshot(popup).catch(() => ({ content: "", field: "" }));
        const formErrorNow = String(formSnap?.content || "").trim();
        const formErrorFieldNow = String(formSnap?.field || "").trim();
        const rangeMsgNow = await readAnualidadMaxMinMessage(popup).catch(() => "");
        const parsedRangeNow = rangeMsgNow ? parseAnualidadRangeFromText(rangeMsgNow) : null;
        const rango_anualidad = parsedRangeNow
            ? { minimo: parsedRangeNow.min, maximo: parsedRangeNow.max }
            : null;

        const guardarPopupText = await popup
            .evaluate(() => {
                const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
                const visible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    return style && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
                };

                const bodies = Array.from(document.querySelectorAll(".messager-body, .window-body, .panel-body"))
                    .filter((el) => visible(el))
                    .map((el) => normalize(el.innerText || el.textContent))
                    .filter(Boolean);

                return bodies.join(" | ");
            })
            .catch(() => "");

        const extra = [];
        if (rangeMsgNow) extra.push(`Rango anualidad: ${rangeMsgNow}`);
        if (formErrorNow) extra.push(`FormError: ${formErrorNow}${formErrorFieldNow ? ` (campo: ${formErrorFieldNow})` : ""}`);
        if (saveData.request_seen) {
            extra.push(
                `save: status=${saveData.http_status ?? "?"} content-type="${saveData.content_type || "?"}"${saveData.parse_error ? ` parse=${saveData.parse_error}` : ""}`
            );
            if (saveData.body_snippet) extra.push(`save.body: ${saveData.body_snippet}`);
        } else {
            extra.push("save: no_request_intercepted (no llego **/cotizacion/save o no match)");
        }
        if (guardarPopupText) {
            extra.push(`popup: ${String(guardarPopupText).slice(0, 600)}${String(guardarPopupText).length > 600 ? "…" : ""}`);
        }

        const msg = extra.length ? `${baseMsg}\n${extra.join("\n")}` : baseMsg;

        // Genera evidencia para fallos de negocio (no necesariamente lanza excepción)
        if (hooks?.onErrorScreenshot) {
            await hooks.onErrorScreenshot({ page: popup }).catch(() => { });
        }

        if (hooks?.onProgress) {
            await hooks.onProgress({
                page: popup,
                message: msg,
            }).catch(() => { });
        }

        return {
            folio: null,
            rfc_calculado: rfc,
            mensualidad_1: mensualidad_1 || 0.0,
            mensualidad_13: mensualidad_13 || 0.0,
            estatus_code: 0,
            json: backendJson,
            mensaje_det: msg,
            form_error_content: formErrorNow ? String(formErrorNow) : null,
            form_error_field: formErrorFieldNow ? String(formErrorFieldNow) : null,
            anualidad_range_message: rangeMsgNow ? String(rangeMsgNow) : null,
            rango_anualidad,
            logs: Array.isArray(backendJson?.logs) ? backendJson.logs : [],
            phase_durations:
                backendJson?.phase_durations &&
                    typeof backendJson.phase_durations === "object"
                    ? backendJson.phase_durations
                    : {},
        };
    }

    const rangeMsgNow = await readAnualidadMaxMinMessage(popup).catch(() => "");
    const parsedRangeNow = rangeMsgNow ? parseAnualidadRangeFromText(rangeMsgNow) : null;
    const rango_anualidad = parsedRangeNow
        ? { minimo: parsedRangeNow.min, maximo: parsedRangeNow.max }
        : null;

    // Cierra popup de "Cotizacion guardada exitosamente" si aparece.
    await cerrarPopupGuardadoSiExiste(popup).catch(() => { });

    // Si hay folio, abrir impresión (best-effort)
    await popup
        .locator('a:has-text("Imprimir")')
        .first()
        .click({ timeout: 8000 })
        .catch(() => { });

    await popup.waitForTimeout(500);

    await popup
        .locator('a:has-text("Imprimir Cotización"), a:has-text("Imprimir Cotizacion")')
        .first()
        .click({ timeout: 8000 })
        .catch(() => { });

    return {
        folio,
        rfc_calculado: rfc,
        mensualidad_1: mensualidad_1 || 0.0,
        mensualidad_13: mensualidad_13 || 0.0,
        estatus_code: 1,
        json: backendJson,
        mensaje_det: "EXITOSO",
        ...(rangeMsgNow ? { anualidad_range_message: String(rangeMsgNow) } : {}),
        ...(rango_anualidad ? { rango_anualidad } : {}),
        logs: Array.isArray(backendJson?.logs) ? backendJson.logs : [],
        phase_durations:
            backendJson?.phase_durations &&
                typeof backendJson.phase_durations === "object"
                ? backendJson.phase_durations
                : {},
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

async function cerrarPopupOkGenericoSiExiste(page) {
    const okBtn = page
        .locator(
            [
                '.messager-body:visible .messager-button a:has-text("Ok")',
                '.messager-body:visible .messager-button a:has-text("OK")',
                '.messager-body:visible .messager-button a:has-text("Aceptar")',
                '.messager-body:visible .messager-button a.l-btn:has(span.l-btn-text:has-text("Ok"))',
                '.messager-body:visible .messager-button a.l-btn:has(span.l-btn-text:has-text("OK"))',
                '.messager-body:visible .messager-button a.l-btn:has(span.l-btn-text:has-text("Aceptar"))',
                '.window:visible a.l-btn:has(span.l-btn-text:has-text("Ok"))',
                '.window:visible a.l-btn:has(span.l-btn-text:has-text("OK"))',
                '.window:visible a.l-btn:has(span.l-btn-text:has-text("Aceptar"))',
            ].join(", ")
        )
        .first();

    const visible = await okBtn.isVisible().catch(() => false);
    if (visible) {
        await okBtn.click({ timeout: 2000 }).catch(async () => {
            await okBtn.click({ timeout: 2000, force: true }).catch(() => { });
        });
        await page.waitForTimeout(300);
        return true;
    }

    const messagerVisible = await page.locator(".messager-body:visible").first().isVisible().catch(() => false);
    if (messagerVisible) {
        return await cerrarPopupGuardadoSiExiste(page, { timeout: 1500 });
    }

    return false;
}

function normalizeAnnuityMonth(value) {
    const raw = normalizeString(value);
    if (!raw) return "";
    const lowered = raw.toLowerCase();
    if (["-1", "seleccione", "selecciona", "select", "seleccionar"].includes(lowered)) return "";

    const numericToken = raw.match(/-?\d+/)?.[0] ?? "";
    if (numericToken) {
        const monthNum = Number(numericToken);
        if (Number.isFinite(monthNum) && monthNum >= 1 && monthNum <= 12) {
            return String(monthNum).padStart(2, "0");
        }
        return "";
    }

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

    return map[key] || "";
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

function createApiJsonCollector(page, { urlIncludes, urlRegex } = {}) {
    let disposed = false;
    const hits = [];
    let resolver = null;

    const matches = (url) => {
        const u = String(url || "");
        if (urlRegex && urlRegex.test(u)) return true;
        if (urlIncludes && u.toLowerCase().includes(String(urlIncludes).toLowerCase())) return true;
        return false;
    };

    const onResponse = async (resp) => {
        if (disposed) return;
        try {
            const url = resp.url();
            if (!matches(url)) return;
            const status = resp.status();
            if (status < 200 || status >= 400) return;

            const ct = String(resp.headers()?.["content-type"] || "");
            if (!ct.toLowerCase().includes("application/json")) {
                // Aun asÃ­ intentamos parsear, algunos backends mandan JSON con ct incorrecto.
            }

            const json = await resp.json().catch(() => null);
            if (!json) return;

            const entry = { url, status, at: Date.now(), json };
            hits.push(entry);
            if (resolver) {
                const r = resolver;
                resolver = null;
                r(entry);
            }
        } catch { }
    };

    page.on("response", onResponse);

    const waitForFirst = (timeoutMs = 45000) => {
        if (hits.length) return Promise.resolve(hits[0]);
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => {
                if (resolver) resolver = null;
                reject(new Error("Timeout esperando respuesta API"));
            }, timeoutMs);
            resolver = (entry) => {
                clearTimeout(t);
                resolve(entry);
            };
        });
    };

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        page.off("response", onResponse);
        resolver = null;
    };

    return {
        getAll: () => hits.slice(),
        getLatest: () => (hits.length ? hits[hits.length - 1] : null),
        waitForFirst,
        dispose,
    };
}

/* =========================
   FLUJO PRINCIPAL (PARAMETRIZABLE)
========================= */
async function runCetelemFlow(payload, hooks = {}) {
    const data = payload || DEFAULT_DATA;

    const nivelDetalleRaw = normalizeString(data?.nivel_detalle ?? data?.nivelDetalle).toLowerCase();
    const allowedNivelDetalle = ["seguros", "seleccion_seguro", "guardar_cotizacion", "planes_disponibles"];
    if (!allowedNivelDetalle.includes(nivelDetalleRaw)) {
        throw new Error(`nivel_detalle no permitido: "${nivelDetalleRaw || "N/A"}"`);
    }

    function parsePositiveNumber(value) {
        if (value === undefined || value === null) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        const num = Number(raw.replace(/,/g, ""));
        if (!Number.isFinite(num)) return null;
        return num;
    }

    function validatePlanesDisponiblesInput() {
        const agencia = String(data?.agencia ?? "").trim();
        if (!agencia) throw new Error("Falta campo requerido: agencia");

        const v = data?.vehiculo || {};
        if (empty(v.vehicleType) && empty(v.tipo_vehiculo)) throw new Error("Falta campo requerido: tipo_vehiculo");
        if (empty(v.insuranceVehicleUse) && empty(v.uso_vehicular)) throw new Error("Falta campo requerido: uso_vehicular");
        if (empty(v.vehicleBrand) && empty(v.marca)) throw new Error("Falta campo requerido: marca");
        if (empty(v.vehicleAnio) && empty(v.anio)) throw new Error("Falta campo requerido: anio");
        if (empty(v.vehicleModel) && empty(v.modelo)) throw new Error("Falta campo requerido: modelo");
        if (empty(v.vehicleVersion) && empty(v.version)) throw new Error("Falta campo requerido: version");

        const c = data?.credito || {};
        const percent = parsePositiveNumber(c.creditDepositPercent ?? c.enganche_porcentaje ?? c.enganchePorcentaje);
        const amount = parsePositiveNumber(c.creditDepositAmount ?? c.enganche_monto ?? c.engancheMonto);

        const hasPercent = percent !== null;
        const hasAmount = amount !== null;
        if (!hasPercent && !hasAmount) {
            throw new Error("Falta campo requerido: enganche_porcentaje o enganche_monto");
        }
        if (hasPercent && percent <= 0) throw new Error("Falta campo requerido: enganche_porcentaje (debe ser > 0)");
        if (hasAmount && amount <= 0) throw new Error("Falta campo requerido: enganche_monto (debe ser > 0)");
    }

    const isSeguros = nivelDetalleRaw === "seguros";
    const isSeleccionSeguro = nivelDetalleRaw === "seleccion_seguro";
    const isPlanesDisponibles = nivelDetalleRaw === "planes_disponibles";
    const isGuardarCotizacion = nivelDetalleRaw === "guardar_cotizacion";

    if (isPlanesDisponibles) {
        validatePlanesDisponiblesInput();
    }

    const credentials = resolveCredentialsForAgencia(data?.agencia);

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
            const pop = await etapaLogin(page, credentials);
            await etapaAbrirCotizador(pop);
            return pop;
        });

        // Hacer hooks accesibles desde helpers (esperarYSeleccionar/esperarYLlenar/etc.)
        page.__rpaHooks = hooks;
        popup.__rpaHooks = hooks;

        // Cambia el watcher al popup ya que es donde vive el cotizador.
        badGatewayWatcher.dispose();
        badGatewayWatcher = createBadGatewayWatcher(popup, () => currentStage);

        const skipCliente = isSeguros || isSeleccionSeguro || isPlanesDisponibles;

        if (!skipCliente && isNonEmptyObject(data?.cliente)) {
            await stage("cliente", async () => etapaCliente(popup, data));
        }

        if (isNonEmptyObject(data?.vehiculo)) {
            await stage("vehiculo", async () => {
                await etapaVehiculo(popup, data);
                await etapaRecuperarPrecioVehiculo(popup);
            });
        }

        // En algunos casos, el portal habilita campos de seguro (como CP) solo después de definir crédito.
        // Por eso, en modo "seguros" no se omite crédito si viene payload.
        if (isNonEmptyObject(data?.credito)) {
            await stage("credito", async () => etapaCredito(popup, data));
        }

        let planesResult = null;
        if (isPlanesDisponibles) {
            planesResult = await stage("planes_disponibles", async () => {
                const result = await etapaPlanesDisponibles(popup);
                return {
                    ...result,
                    request_data: { agencia: normalizeString(data?.agencia) },
                };
            });
        }

        let seguroResult = null;
        if (!isPlanesDisponibles && (isSeguros || isSeleccionSeguro || isNonEmptyObject(data?.seguro))) {
            seguroResult = await stage("seguro", async () => {
                if (isSeleccionSeguro) return etapaSeleccionSeguro(popup, data);
                return etapaSeguro(popup, data);
            });
        }

        let guardarResult = null;
        if (isGuardarCotizacion) {
            guardarResult = await stage("guardar_cotizacion", async () => etapaGuardarCotizacion(popup, data));
        }

        await stage("finalizando", async () => { });

        return {
            ok: true,
            result: isGuardarCotizacion ? guardarResult : (isPlanesDisponibles ? planesResult : seguroResult),
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
