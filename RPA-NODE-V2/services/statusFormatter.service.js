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

function normalizeNivelDetalle(value) {
    const raw = String(value ?? "").trim();
    return raw ? raw.toLowerCase() : "";
}

function formatPrima(value) {
    if (value === undefined || value === null || value === "") return "0.00";
    const num = typeof value === "number"
        ? value
        : Number.parseFloat(String(value).replace(/[$\s]/g, "").replace(/,/g, ""));
    if (!Number.isFinite(num)) return "0.00";
    return num.toFixed(2);
}

function formatearSalidaCliente(data) {
    const status = String(data?.status ?? "").toLowerCase();
    const nivel_detalle = normalizeNivelDetalle(data?.nivel_detalle ?? data?.nivelDetalle);

    if (status === "completado") {
        const primas = Array.isArray(data?.primas_seguros) ? data.primas_seguros : [];
        const primas_formateadas = primas.map((p) => ({
            aseguradora: String(p?.aseguradora ?? p?.nombre ?? "").trim(),
            monto: formatPrima(p?.monto ?? p?.prima),
            anualidad_requerida: p?.anualidad_requerida === true,
            rango_anualidad: p?.rango_anualidad || { minimo: null, maximo: null },
        }));

        const aseguradoras = primas_formateadas.map((p) => ({
            nombre: p.aseguradora,
            prima: p.monto,
        }));

        return {
            estatus_code: 1,
            nivel_detalle: nivel_detalle || "seguros",
            mensaje_det: "Primas de seguros consultadas exitosamente",
            primas_seguros: primas_formateadas,
            // Compatibilidad: algunos clientes consumen esto "plano"
            aseguradoras,
            data: {
                aseguradoras,
                // Compatibilidad: si el consumidor se queda con `response.data`
                estatus_code: 1,
                nivel_detalle: nivel_detalle || "seguros",
                mensaje_det: "Primas de seguros consultadas exitosamente",
                primas_seguros: primas_formateadas,
            },
        };
    }

    if (status === "fallido") {
        return {
            estatus_code: 0,
            nivel_detalle: nivel_detalle || "seguros",
            mensaje_det: sanitizeDetalle(data?.detalle),
            aseguradoras: [],
            data: null,
        };
    }

    return {
        estatus_code: 2,
        nivel_detalle: nivel_detalle || "seguros",
        mensaje_det: sanitizeDetalle(data?.detalle ?? data?.status ?? "En progreso"),
        aseguradoras: [],
        data: null,
    };
}

module.exports = {
    formatearSalidaCliente,
};
