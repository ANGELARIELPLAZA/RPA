function isNonEmptyObject(value) {
    if (!value || typeof value !== "object") return false;
    return Object.keys(value).some((k) => value[k] !== undefined && value[k] !== null && String(value[k]).trim() !== "");
}

function buildFlowStages(normalizedPayload) {
    const stages = [];

    // Nota: la validación del portal se hace ANTES de crear task_id (en el controller).
    stages.push({ name: "login" });

    const nivelDetalle = String(normalizedPayload?.nivel_detalle ?? normalizedPayload?.nivelDetalle ?? "").trim().toLowerCase();
    const isSeguros = nivelDetalle === "seguros";
    const isSeleccionSeguro = nivelDetalle === "seleccion_seguro";
    const isPlanesDisponibles = nivelDetalle === "planes_disponibles";
    const isGuardarCotizacion = nivelDetalle === "guardar_cotizacion";
    const skipCliente = isSeguros || isSeleccionSeguro || isPlanesDisponibles;

    if (!skipCliente && isNonEmptyObject(normalizedPayload?.cliente)) stages.push({ name: "cliente" });
    if (isNonEmptyObject(normalizedPayload?.vehiculo)) stages.push({ name: "vehiculo" });
    if (isNonEmptyObject(normalizedPayload?.credito)) stages.push({ name: "credito" });
    if (isPlanesDisponibles) stages.push({ name: "planes_disponibles" });
    if (isSeguros || isSeleccionSeguro || (!isPlanesDisponibles && isNonEmptyObject(normalizedPayload?.seguro))) stages.push({ name: "seguro" });
    if (isGuardarCotizacion) stages.push({ name: "guardar_cotizacion" });
    stages.push({ name: "finalizando" });

    return stages;
}

module.exports = {
    buildFlowStages,
    isNonEmptyObject,
};
