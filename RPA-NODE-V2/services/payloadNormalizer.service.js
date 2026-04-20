function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNivelDetalle(value) {
    const raw = String(value ?? "").trim();
    return raw ? raw.toLowerCase() : "";
}

function pick(obj, keys) {
    const out = {};
    for (const key of keys) {
        if (obj[key] !== undefined) out[key] = obj[key];
    }
    return out;
}

function normalizeFormatoA(body) {
    return {
        ...(body.nivel_detalle !== undefined || body.nivelDetalle !== undefined
            ? { nivel_detalle: normalizeNivelDetalle(body.nivel_detalle ?? body.nivelDetalle) }
            : {}),
        cliente: isObject(body.cliente) ? body.cliente : {},
        vehiculo: isObject(body.vehiculo) ? body.vehiculo : {},
        credito: isObject(body.credito) ? body.credito : {},
        seguro: isObject(body.seguro) ? body.seguro : {},
    };
}

function normalizeFormatoB(body) {
    const clienteKeys = [
        "customerType",
        "genero",
        "customerTitle",
        "customerName",
        "customerAPaterno",
        "customerAMaterno",
        "customerBirthDate",
        "customerRfc",
        "customerNumUnidades",
        "customerFirstCredit",
    ];

    const vehiculoKeys = [
        "vehicleType",
        "seminuevoCertificado",
        "insuranceVehicleUse",
        "tipoCarga",
        "servicio",
        "vehicleBrand",
        "vehicleAnio",
        "vehicleModel",
        "vehicleVersion",
        // vehiclePriceTax NO se exige: se recupera desde el portal
        "vehicleAccesories",
        "vehicleAccesoriesAmount",
        "vehicleChargeStationAmount",
        "vehicleIsConverted",
        "vehicleExtendedWarrantyOption",
        "gapInsurance",
        "gapInsurancePlan",
        "gapInsuranceType",
    ];

    const creditoKeys = ["creditDepositAmount", "creditDepositPlan", "creditDepositTerm"];

    const seguroKeys = [
        "insuranceCP",
        "insuranceRecruitment",
        "insuranceType",
        "insurancePaymentTermRemnant",
        "insuranceCoverageLorant",
        "insuranceOption",
    ];

    return {
        ...(body.nivel_detalle !== undefined || body.nivelDetalle !== undefined
            ? { nivel_detalle: normalizeNivelDetalle(body.nivel_detalle ?? body.nivelDetalle) }
            : {}),
        cliente: pick(body, clienteKeys),
        vehiculo: pick(body, vehiculoKeys),
        credito: pick(body, creditoKeys),
        seguro: pick(body, seguroKeys),
    };
}

function normalizeCotizacionPayload(body) {
    if (!isObject(body)) {
        throw new Error("Body inválido: se esperaba JSON objeto");
    }

    const looksLikeA =
        isObject(body.cliente) || isObject(body.vehiculo) || isObject(body.credito) || isObject(body.seguro);

    return looksLikeA ? normalizeFormatoA(body) : normalizeFormatoB(body);
}

module.exports = {
    normalizeCotizacionPayload,
};
