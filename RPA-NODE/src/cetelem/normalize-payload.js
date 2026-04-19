const logger = require("../core/logger");

const FLOW_ALIASES = {
    cliente: "cliente",
    clientes: "cliente",
    credito: "credito",
    creditos: "credito",
    seguro: "seguro",
    seguros: "seguro",
    vehiculo: "vehiculo",
    vehiculos: "vehiculo",
};

const VEHICLE_USE_ALIASES = {
    personal: "1",
    particular: "1",
    privado: "1",
    comercial: "2",
    negocio: "2",
    trabajo: "2",
};

const CUSTOMER_TYPE_ALIASES = {
    fisica: "1",
    "física": "1",
    moral: "2",
    "fisica actividad empresarial": "3",
    "física actividad empresarial": "3",
    actividad: "3",
};

const BOOLEAN_RADIO_ALIASES = {
    no: "N",
    n: "N",
    false: "N",
    0: "N",
    si: "S",
    "sí": "S",
    s: "S",
    true: "S",
    1: "S",
};

function normalizeCetelemPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("El body JSON debe ser un objeto");
    }

    if (isInternalPayload(payload)) {
        return normalizeInternalPayload(payload);
    }

    return normalizeFlatPayload(payload);
}

function isInternalPayload(payload) {
    return ["cliente", "vehiculo", "credito", "seguro"].some((key) => (
        payload[key] && typeof payload[key] === "object" && !Array.isArray(payload[key])
    ));
}

function isEmptyValue(value) {
    return value === undefined || value === null || String(value).trim() === "";
}

function sanitizeVehiclePayload(vehiculo, { source = "vehiculo" } = {}) {
    if (!vehiculo || typeof vehiculo !== "object" || Array.isArray(vehiculo)) {
        return vehiculo;
    }

    const hasVehiclePriceTax = Object.prototype.hasOwnProperty.call(vehiculo, "vehiclePriceTax")
        && !isEmptyValue(vehiculo.vehiclePriceTax);

    if (!hasVehiclePriceTax) {
        const { vehiclePriceTax, ...rest } = vehiculo; // drop if present (even empty) to avoid fills
        return rest;
    }

    logger.warn(`[payload] Campo no editable ignorado: ${source}.vehiclePriceTax=${String(vehiculo.vehiclePriceTax)}`);
    const { vehiclePriceTax, ...rest } = vehiculo;
    return rest;
}

function normalizeInternalPayload(payload) {
    const vehiculo = sanitizeVehiclePayload(payload.vehiculo, { source: "vehiculo" });
    const normalized = omitEmpty({
        cliente: payload.cliente,
        vehiculo,
        credito: payload.credito,
        seguro: payload.seguro,
    });

    const flows = normalizeFlows(payload.flujos || payload.flows || payload.nivelDetalle || payload.nivel_detalle);
    if (flows.length > 0) {
        normalized.flujos = flows;
    }

    return {
        ...payload,
        ...normalized,
    };
}

function normalizeFlatPayload(payload) {
    if (!isEmptyValue(payload.importe_localizador)) {
        logger.warn(`[payload] Campo no editable ignorado: importe_localizador=${String(payload.importe_localizador)} (Precio auto con IVA)`);
    }

    if (!isEmptyValue(payload.vehiclePriceTax)) {
        logger.warn(`[payload] Campo no editable ignorado: vehiclePriceTax=${String(payload.vehiclePriceTax)} (Precio auto con IVA)`);
    }

    const vehiculo = omitEmpty({
        vehicleType: normalizeVehicleType(payload.tipo_vehiculo),
        insuranceVehicleUse: normalizeVehicleUse(payload.uso_vehicular),
        vehicleBrand: normalizeText(payload.marca),
        vehicleAnio: normalizeText(payload.anio),
        vehicleModel: normalizeText(payload.modelo),
        vehicleVersion: normalizeText(payload.version),
        vehicleAccesories: normalizeText(payload.accesorios_nombre),
        vehicleAccesoriesAmount: normalizeNumber(payload.accesorios_importe),
        vehicleChargeStationAmount: normalizeNumber(payload.importe_estacion_carga),
        vehicleExtendedWarrantyOption: normalizeWarrantyOption(payload.garantia_extendida),
        gapInsurance: normalizeRadioBoolean(payload.seguro_gap),
        gapInsurancePlan: normalizeText(payload.plan_gap),
        gapInsuranceType: normalizeText(payload.tipo_pago_gap),
        tipoCarga: normalizeText(payload.tipo_carga),
        servicio: normalizeText(payload.servicio),
    });

    const credito = omitEmpty({
        creditDepositPercent: normalizeNumber(payload.enganche_porcentaje),
        creditDepositAmount: normalizeNumber(payload.enganche_monto),
        creditDepositPlan: normalizeText(payload.plan_credito),
        creditDepositTerm: normalizeText(payload.plazo_credito),
    });

    const seguro = omitEmpty({
        insuranceCP: normalizeText(payload.codigo_postal),
        insuranceRecruitment: normalizeText(payload.contratacion_seguro),
        insuranceType: normalizeText(payload.tipo_seguro),
        insuranceTermRemnant: normalizeText(payload.plazo_remanente),
        insurancePaymentTermRemnant: normalizeText(payload.forma_pago),
        insuranceCoverageLorant: normalizeText(payload.paquete_seguro),
        insuranceOption: normalizeText(payload.aseguradora_seleccionada),
    });

    const cliente = normalizeFlatClient(payload);
    const flows = normalizeFlows(payload.nivel_detalle || payload.nivelDetalle || payload.flujos || payload.flows);

    return omitEmpty({
        cliente,
        vehiculo,
        credito,
        seguro,
        flujos: flows.length > 0 ? expandFlows(flows, { cliente, vehiculo, credito, seguro }) : undefined,
        rawPayload: payload,
    });
}

function normalizeFlatClient(payload) {
    const customerType = normalizeCustomerType(payload.tipo_persona, payload);
    if (!customerType) {
        return null;
    }

    return omitEmpty({
        customerType,
        genero: normalizeText(payload.genero),
        customerTitle: normalizeText(payload.titulo),
        customerName: normalizeText(payload.nombre),
        customerAPaterno: normalizeText(payload.apellido_paterno),
        customerAMaterno: normalizeText(payload.apellido_materno),
        customerBirthDate: normalizeText(payload.fecha_nacimiento || payload.fecha_constitucion),
        customerRfc: normalizeText(payload.rfc),
        customerRazonSocial: normalizeText(payload.razon_social),
        customerNombreComercial: normalizeText(payload.nombre_comercial),
        customerNumUnidades: normalizeText(payload.numero_unidades_solicitar),
        customerFirstCredit: normalizeRadioBoolean(payload.cliente_cetelem_actual),
    });
}

function normalizeCustomerType(value, payload) {
    const normalized = normalizeText(value);
    if (normalized) {
        const lower = normalized.toLowerCase();
        return CUSTOMER_TYPE_ALIASES[lower] || normalized;
    }

    if (hasValue(payload.razon_social) || hasValue(payload.fecha_constitucion)) {
        return "2";
    }

    if (hasValue(payload.numero_unidades_solicitar) || hasValue(payload.cliente_cetelem_actual)) {
        return "3";
    }

    if (hasValue(payload.nombre) || hasValue(payload.rfc)) {
        return "1";
    }

    return null;
}

function normalizeFlows(value) {
    const rawFlows = Array.isArray(value)
        ? value
        : hasValue(value)
            ? String(value).split(",")
            : [];

    return rawFlows
        .map((flow) => FLOW_ALIASES[String(flow).trim().toLowerCase()] || String(flow).trim().toLowerCase())
        .filter(Boolean);
}

function expandFlows(flows, sections) {
    const unique = new Set();

    for (const flow of flows) {
        if (flow === "seguro" && Object.keys(sections.vehiculo || {}).length > 0) {
            unique.add("vehiculo");
        }

        if (flow === "seguro" && Object.keys(sections.credito || {}).length > 0) {
            unique.add("credito");
        }

        unique.add(flow);
    }

    return Array.from(unique).filter((flow) => Object.keys(sections[flow] || {}).length > 0);
}

function normalizeVehicleType(value) {
    return normalizeText(value);
}

function normalizeVehicleUse(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }

    return VEHICLE_USE_ALIASES[normalized.toLowerCase()] || normalized;
}

function normalizeWarrantyOption(value) {
    if (!hasValue(value)) {
        return null;
    }

    return Number(value) > 0 ? "S" : "N";
}

function normalizeRadioBoolean(value) {
    if (!hasValue(value)) {
        return null;
    }

    const normalized = String(value).trim().toLowerCase();
    return BOOLEAN_RADIO_ALIASES[normalized] || String(value).trim().toUpperCase();
}

function normalizeText(value) {
    if (!hasValue(value)) {
        return null;
    }

    return String(value).trim();
}

function normalizeNumber(value) {
    if (!hasValue(value)) {
        return null;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? String(numericValue) : String(value).trim();
}

function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
}

function omitEmpty(object) {
    if (!object || typeof object !== "object") {
        return null;
    }

    const normalized = {};

    for (const [key, value] of Object.entries(object)) {
        if (Array.isArray(value)) {
            if (value.length > 0) {
                normalized[key] = value;
            }
            continue;
        }

        if (value && typeof value === "object") {
            const child = omitEmpty(value);
            if (child && Object.keys(child).length > 0) {
                normalized[key] = child;
            }
            continue;
        }

        if (hasValue(value)) {
            normalized[key] = value;
        }
    }

    return normalized;
}

module.exports = {
    normalizeCetelemPayload,
};
