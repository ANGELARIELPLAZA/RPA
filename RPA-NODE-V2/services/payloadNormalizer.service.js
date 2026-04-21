function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNivelDetalle(value) {
    const raw = String(value ?? "").trim();
    return raw ? raw.toLowerCase() : "";
}

function normalizeAgencia(value) {
    const raw = String(value ?? "").trim();
    return raw || "";
}

function normalizeCotizacion(value) {
    const cotizacion = isObject(value) ? { ...value } : {};

    function empty(value) {
        return value === undefined ||
            value === null ||
            String(value).trim() === "";
    }

    function isZeroLike(value) {
        if (value === undefined || value === null) return false;
        const raw = String(value).trim();
        if (raw === "") return false;
        const numeric = Number(raw.replace(/,/g, ""));
        return Number.isFinite(numeric) && numeric === 0;
    }

    if (empty(cotizacion.annuityMonth) && !empty(cotizacion.mes_anualidad)) {
        cotizacion.annuityMonth = cotizacion.mes_anualidad;
    }

    // annuityAmount: por negocio viene de `importe_anualidad` (monto).
    // Fallback opcional a `anualidad_cliente` por compatibilidad de payloads viejos.
    if (empty(cotizacion.annuityAmount) && !empty(cotizacion.importe_anualidad)) {
        cotizacion.annuityAmount = cotizacion.importe_anualidad;
    }

    if (empty(cotizacion.annuityAmount) && !empty(cotizacion.anualidad_cliente)) {
        cotizacion.annuityAmount = cotizacion.anualidad_cliente;
    }
    // Normaliza a strings (inputs/selects suelen comparar strings)
    for (const key of ["annuityMonth", "annuityAmount"]) {
        if (cotizacion[key] !== undefined && cotizacion[key] !== null) {
            cotizacion[key] = String(cotizacion[key]).trim();
        }
    }

    return cotizacion;
}

function normalizeCliente(value) {
    const cliente = isObject(value) ? { ...value } : {};

    function normalizeYesNo01(input) {
        if (input === undefined || input === null) return input;
        const raw = String(input).trim().toLowerCase();
        if (raw === "") return "";
        if (["1", "true", "si", "sí", "s", "y", "yes"].includes(raw)) return "1";
        if (["0", "false", "no", "n"].includes(raw)) return "0";
        return String(input).trim();
    }

    // Alias comunes: nombre / apellidos (payload externo)
    if (cliente.customerName === undefined) {
        cliente.customerName =
            cliente.nombre ??
            cliente.name ??
            cliente.first_name ??
            cliente.firstName;
    }

    if (cliente.customerAPaterno === undefined) {
        cliente.customerAPaterno =
            cliente.apellido_paterno ??
            cliente.apellidoPaterno ??
            cliente.apellidoP ??
            cliente.paterno ??
            cliente.last_name ??
            cliente.lastName;
    }

    if (cliente.customerAMaterno === undefined) {
        cliente.customerAMaterno =
            cliente.apellido_materno ??
            cliente.apellidoMaterno ??
            cliente.apellidoM ??
            cliente.materno ??
            cliente.second_last_name ??
            cliente.secondLastName;
    }

    if (cliente.customerBirthDate === undefined) {
        cliente.customerBirthDate =
            cliente.fecha_nacimiento ??
            cliente.fechaNacimiento ??
            cliente.birth_date ??
            cliente.birthDate;
    }

    if (cliente.customerRfc === undefined) {
        cliente.customerRfc =
            cliente.rfc ??
            cliente.RFC;
    }

    if (cliente.customerNumUnidades === undefined) {
        cliente.customerNumUnidades =
            cliente.numero_unidades_solicitar ??
            cliente.numeroUnidadesSolicitar ??
            cliente.num_unidades ??
            cliente.numUnidades;
    }

    // Alias: cliente actual (cetelem) -> customerFirstCredit (1=primer crédito, 0=no)
    // Nota: en el portal se usa como select/radio en algunas variantes; aquí solo normalizamos valor.
    if (cliente.customerFirstCredit === undefined && cliente.cliente_cetelem_actual !== undefined) {
        const normalized = normalizeYesNo01(cliente.cliente_cetelem_actual);
        if (normalized === "1") {
            // "SI" => ya es cliente => no es primer crédito
            cliente.customerFirstCredit = "0";
        } else if (normalized === "0") {
            // "NO" => no es cliente => primer crédito
            cliente.customerFirstCredit = "1";
        } else {
            cliente.customerFirstCredit = normalized;
        }
    }

    // Alias: tipo_persona -> customerType
    if (cliente.customerType === undefined && cliente.tipo_persona !== undefined) {
        cliente.customerType = cliente.tipo_persona;
    }

    // Alias: titulo -> customerTitle
    if (cliente.customerTitle === undefined && cliente.titulo !== undefined) {
        cliente.customerTitle = cliente.titulo;
    }

    // Normaliza tipos esperados (selects/inputs suelen comparar strings)
    for (const key of [
        "customerType",
        "genero",
        "customerTitle",
        "customerName",
        "customerAPaterno",
        "customerAMaterno",
        "customerBirthDate",
        "customerRfc",
        "customerNumUnidades",
        "cliente_cetelem_actual",
        "cliente_kia",
        "cliente_fidelity",
        "tipo_cliente_fidelity",
        "customerFirstCredit",
    ]) {
        if (cliente[key] !== undefined && cliente[key] !== null) {
            cliente[key] = String(cliente[key]).trim();
        }
    }

    return cliente;
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

    // Regla de negocio: si NO hay GAP (N), ignorar plan/tipo aunque vengan en payload.
    const gapInsuranceValue = String(vehiculo.gapInsurance ?? "").trim().toUpperCase();
    if (gapInsuranceValue !== "N") {
        if (vehiculo.gapInsurancePlan === undefined && vehiculo.plan_gap !== undefined) {
            vehiculo.gapInsurancePlan = vehiculo.plan_gap;
        }

        if (vehiculo.gapInsuranceType === undefined && vehiculo.tipo_pago_gap !== undefined) {
            vehiculo.gapInsuranceType = vehiculo.tipo_pago_gap;
        }
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
    const clienteKeys = [
        "tipo_persona",
        "customerType",
        "genero",
        "titulo",
        "customerTitle",
        "nombre",
        "apellido_paterno",
        "apellido_materno",
        "fecha_nacimiento",
        "rfc",
        "numero_unidades_solicitar",
        "cliente_cetelem_actual",
        "cliente_kia",
        "cliente_fidelity",
        "tipo_cliente_fidelity",
        "customerName",
        "customerAPaterno",
        "customerAMaterno",
        "customerBirthDate",
        "customerRfc",
        "customerNumUnidades",
        "customerFirstCredit",
    ];

    const mergedCliente = {
        ...pick(body, clienteKeys),
        ...(isObject(body.cliente) ? body.cliente : {}),
    };

    return {
        agencia: normalizeAgencia(body.agencia ?? body.agency),
        ...(body.nivel_detalle !== undefined || body.nivelDetalle !== undefined
            ? { nivel_detalle: normalizeNivelDetalle(body.nivel_detalle ?? body.nivelDetalle) }
            : {}),
        cotizacion: normalizeCotizacion({
            mes_anualidad: body.mes_anualidad,
            annuityMonth: body.annuityMonth,
            importe_anualidad: body.importe_anualidad,
            annuityAmount: body.annuityAmount,
            mes_primer_pago: body.mes_primer_pago,
            mesPrimerPago: body.mesPrimerPago,
            anualidad_cliente: body.anualidad_cliente ?? body.anualidadCliente,
        }),
        cliente: normalizeCliente(mergedCliente),
        vehiculo: normalizeVehiculo(body.vehiculo),
        credito: normalizeCredito(body.credito),
        seguro: normalizeSeguro(body.seguro),
    };
}

function normalizeFormatoB(body) {
    const cotizacionKeys = [
        "mes_anualidad",
        "annuityMonth",
        "importe_anualidad",
        "annuityAmount",
        "mes_primer_pago",
        "mesPrimerPago",
        "anualidad_cliente",
        "anualidadCliente",
    ];

    const clienteKeys = [
        "tipo_persona",
        "customerType",
        "genero",
        "titulo",
        "customerTitle",
        "nombre",
        "apellido_paterno",
        "apellido_materno",
        "fecha_nacimiento",
        "rfc",
        "numero_unidades_solicitar",
        "cliente_cetelem_actual",
        "cliente_kia",
        "cliente_fidelity",
        "tipo_cliente_fidelity",
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
        agencia: normalizeAgencia(body.agencia ?? body.agency),
        ...(body.nivel_detalle !== undefined || body.nivelDetalle !== undefined
            ? { nivel_detalle: normalizeNivelDetalle(body.nivel_detalle ?? body.nivelDetalle) }
            : {}),
        cotizacion: normalizeCotizacion(pick(body, cotizacionKeys)),
        cliente: normalizeCliente(pick(body, clienteKeys)),
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
