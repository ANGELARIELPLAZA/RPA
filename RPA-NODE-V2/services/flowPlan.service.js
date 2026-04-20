function isNonEmptyObject(value) {
    if (!value || typeof value !== "object") return false;
    return Object.keys(value).some((k) => value[k] !== undefined && value[k] !== null && String(value[k]).trim() !== "");
}

function buildFlowStages(normalizedPayload) {
    const stages = [];

    // Nota: la validación del portal se hace ANTES de crear task_id (en el controller).
    stages.push({ name: "login" });

    if (isNonEmptyObject(normalizedPayload?.cliente)) stages.push({ name: "cliente" });
    if (isNonEmptyObject(normalizedPayload?.vehiculo)) stages.push({ name: "vehiculo" });
    if (isNonEmptyObject(normalizedPayload?.credito)) stages.push({ name: "credito" });
    if (isNonEmptyObject(normalizedPayload?.seguro)) stages.push({ name: "seguro" });
    stages.push({ name: "finalizando" });

    return stages;
}

module.exports = {
    buildFlowStages,
};
