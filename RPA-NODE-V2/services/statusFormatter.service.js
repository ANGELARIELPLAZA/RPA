function asStringMonto(value) {
    if (value === undefined || value === null) return "";
    return String(value);
}

function sanitizeDetalle(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "Error desconocido";

    const marker = "\nError:";
    const idx = raw.indexOf(marker);
    if (idx >= 0) {
        const after = raw.slice(idx + marker.length).trim();
        return after || raw.slice(0, idx).trim() || raw;
    }

    return raw;
}

function formatearSalidaCliente(data) {
    const status = String(data?.status ?? "").toLowerCase();

    if (status === "completado") {
        const primas = Array.isArray(data?.primas_seguros) ? data.primas_seguros : [];
        return primas.map((p) => ({
            monto: asStringMonto(p?.monto),
            aseguradora: String(p?.aseguradora ?? "").trim(),
        }));
    }

    if (status === "fallido") {
        return {
            status: "fallido",
            detalle: sanitizeDetalle(data?.detalle),
        };
    }

    return {
        status: data?.status ?? "en progreso",
        detalle: sanitizeDetalle(data?.detalle ?? ""),
    };
}

module.exports = {
    formatearSalidaCliente,
};

