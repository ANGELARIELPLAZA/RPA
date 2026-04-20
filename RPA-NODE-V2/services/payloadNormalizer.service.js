function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNivelDetalle(value) {
    const raw = String(value ?? "").trim();
    return raw ? raw.toLowerCase() : "";
}

function normalizeVehiculo(value) {
    const vehiculo = isObject(value) ? { ...value } : {};

    // Aliases comunes (payload externo)
    if (vehiculo.vehicleType === undefined && vehiculo.tipo_vehiculo !== undefined) {
        const raw = String(vehiculo.tipo_vehiculo ?? "").trim().toUpperCase();
        // "N" suele venir como "Nuevo"
        vehiculo.vehicleType = raw === "N" ? "Nuevo" : vehiculo.tipo_vehiculo;
    }

    if (vehiculo.insuranceVehicleUse === undefined && vehiculo.uso_vehicular !== undefined) {
        vehiculo.insuranceVehicleUse = vehiculo.uso_vehicular;
    }

    if (vehiculo.vehicleBrand === undefined && vehiculo.marca !== undefined) {
        vehiculo.vehicleBrand = vehiculo.marca;
    }

    if (vehiculo.vehicleAnio === undefined && vehiculo.anio !== undefined) {
        vehiculo.vehicleAnio = vehiculo.anio;
    }

    if (vehiculo.vehicleModel === undefined && vehiculo.modelo !== undefined) {
        vehiculo.vehicleModel = vehiculo.modelo;
    }

    if (vehiculo.vehicleVersion === undefined && vehiculo.version !== undefined) {
        vehiculo.vehicleVersion = vehiculo.version;
    }

    if (vehiculo.vehicleAccesories === undefined && vehiculo.accesorios_nombre !== undefined) {
        vehiculo.vehicleAccesories = vehiculo.accesorios_nombre;
    }

    if (vehiculo.vehicleAccesoriesAmount === undefined && vehiculo.accesorios_importe !== undefined) {
        vehiculo.vehicleAccesoriesAmount = vehiculo.accesorios_importe;
    }

    if (vehiculo.vehicleChargeStationAmount === undefined && vehiculo.importe_estacion_carga !== undefined) {
        vehiculo.vehicleChargeStationAmount = vehiculo.importe_estacion_carga;
    }

    if (vehiculo.vehicleExtendedWarrantyOption === undefined && vehiculo.garantia_extendida !== undefined) {
        vehiculo.vehicleExtendedWarrantyOption = vehiculo.garantia_extendida;
    }

    if (vehiculo.gapInsurance === undefined && vehiculo.seguro_gap !== undefined) {
        vehiculo.gapInsurance = vehiculo.seguro_gap;
    }

    if (vehiculo.gapInsurancePlan === undefined && vehiculo.plan_gap !== undefined) {
        vehiculo.gapInsurancePlan = vehiculo.plan_gap;
    }

    if (vehiculo.gapInsuranceType === undefined && vehiculo.tipo_pago_gap !== undefined) {
        vehiculo.gapInsuranceType = vehiculo.tipo_pago_gap;
    }

    // Normaliza tipos esperados (selects/inputs suelen comparar strings)
    for (const key of [
        "vehicleType",
        "insuranceVehicleUse",
        "vehicleBrand",
        "vehicleAnio",
        "vehicleModel",
        "vehicleVersion",
        "vehicleAccesories",
        "vehicleAccesoriesAmount",
        "vehicleChargeStationAmount",
        "vehicleExtendedWarrantyOption",
        "gapInsurance",
        "gapInsurancePlan",
        "gapInsuranceType",
    ]) {
        if (vehiculo[key] !== undefined && vehiculo[key] !== null) {
            vehiculo[key] = String(vehiculo[key]).trim();
        }
    }

    return vehiculo;
}

function normalizeSeguro(value) {
    const seguro = isObject(value) ? { ...value } : {};

    if (seguro.insuranceCP === undefined && seguro.codigo_postal !== undefined) {
        seguro.insuranceCP = seguro.codigo_postal;
    }

    if (seguro.insuranceRecruitment === undefined && seguro.contratacion_seguro !== undefined) {
        seguro.insuranceRecruitment = seguro.contratacion_seguro;
    }

    if (seguro.insuranceType === undefined && seguro.tipo_seguro !== undefined) {
        seguro.insuranceType = seguro.tipo_seguro;
    }

    if (seguro.insurancePaymentTermRemnant === undefined && seguro.forma_pago !== undefined) {
        seguro.insurancePaymentTermRemnant = seguro.forma_pago;
    }

    if (seguro.insuranceCoverageLorant === undefined && seguro.paquete_seguro !== undefined) {
        seguro.insuranceCoverageLorant = seguro.paquete_seguro;
    }

    if (seguro.insuranceOption === undefined && seguro.aseguradora_seleccionada !== undefined) {
        seguro.insuranceOption = seguro.aseguradora_seleccionada;
    }

    for (const key of [
        "insuranceCP",
        "insuranceRecruitment",
        "insuranceType",
        "insurancePaymentTermRemnant",
        "insuranceCoverageLorant",
        "insuranceOption",
    ]) {
        if (seguro[key] !== undefined && seguro[key] !== null) {
            seguro[key] = String(seguro[key]).trim();
        }
    }

    return seguro;
}

function normalizeCredito(value) {
    const credito = isObject(value) ? { ...value } : {};

    if (credito.creditDepositPlan === undefined && credito.plan_credito !== undefined) {
        credito.creditDepositPlan = credito.plan_credito;
    }

    if (credito.creditDepositTerm === undefined && credito.plazo_credito !== undefined) {
        credito.creditDepositTerm = credito.plazo_credito;
    }

    if (credito.creditDepositPercent === undefined && credito.enganche_porcentaje !== undefined) {
        credito.creditDepositPercent = credito.enganche_porcentaje;
    }

    if (credito.creditDepositAmount === undefined && credito.enganche_monto !== undefined) {
        credito.creditDepositAmount = credito.enganche_monto;
    }

    for (const key of ["creditDepositPercent", "creditDepositAmount", "creditDepositPlan", "creditDepositTerm"]) {
        if (credito[key] !== undefined && credito[key] !== null) {
            credito[key] = String(credito[key]).trim();
        }
    }

    return credito;
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
        vehiculo: normalizeVehiculo(body.vehiculo),
        credito: normalizeCredito(body.credito),
        seguro: normalizeSeguro(body.seguro),
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
        "tipo_vehiculo",
        "vehicleType",
        "seminuevoCertificado",
        "insuranceVehicleUse",
        "uso_vehicular",
        "tipoCarga",
        "servicio",
        "marca",
        "vehicleBrand",
        "anio",
        "vehicleAnio",
        "modelo",
        "vehicleModel",
        "version",
        "vehicleVersion",
        // vehiclePriceTax NO se exige: se recupera desde el portal
        "accesorios_nombre",
        "vehicleAccesories",
        "accesorios_importe",
        "vehicleAccesoriesAmount",
        "importe_estacion_carga",
        "vehicleChargeStationAmount",
        "vehicleIsConverted",
        "garantia_extendida",
        "vehicleExtendedWarrantyOption",
        "seguro_gap",
        "gapInsurance",
        "plan_gap",
        "gapInsurancePlan",
        "tipo_pago_gap",
        "gapInsuranceType",
    ];

    const creditoKeys = [
        "enganche_monto",
        "creditDepositAmount",
        "enganche_porcentaje",
        "creditDepositPercent",
        "plan_credito",
        "creditDepositPlan",
        "plazo_credito",
        "creditDepositTerm",
    ];

    const seguroKeys = [
        "codigo_postal",
        "insuranceCP",
        "contratacion_seguro",
        "insuranceRecruitment",
        "tipo_seguro",
        "insuranceType",
        "forma_pago",
        "insurancePaymentTermRemnant",
        "paquete_seguro",
        "insuranceCoverageLorant",
        "aseguradora_seleccionada",
        "insuranceOption",
    ];

    return {
        ...(body.nivel_detalle !== undefined || body.nivelDetalle !== undefined
            ? { nivel_detalle: normalizeNivelDetalle(body.nivel_detalle ?? body.nivelDetalle) }
            : {}),
        cliente: pick(body, clienteKeys),
        vehiculo: normalizeVehiculo(pick(body, vehiculoKeys)),
        credito: normalizeCredito(pick(body, creditoKeys)),
        seguro: normalizeSeguro(pick(body, seguroKeys)),
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
