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
    const isPlanesDisponibles = nivel_detalle === "planes_disponibles";
    const isSeleccionSeguro = nivel_detalle === "seleccion_seguro";

    if (isPlanesDisponibles) {
        const result = data?.result && typeof data.result === "object" ? data.result : {};
        const planes = Array.isArray(result?.planes) ? result.planes : [];
        const request_data =
            result?.request_data && typeof result.request_data === "object" ? result.request_data : { agencia: null };

        if (status === "completado") {
            return {
                estatus_code: planes.length ? 1 : 0,
                nivel_detalle: "planes_disponibles",
                mensaje_det: String(result?.mensaje_det || (planes.length ? `${planes.length} planes obtenidos correctamente.` : "No se encontraron planes disponibles en el portal.")),
                planes,
                request_data,
            };
        }

        if (status === "fallido") {
            return {
                estatus_code: 0,
                nivel_detalle: "planes_disponibles",
                mensaje_det: sanitizeDetalle(data?.detalle),
                planes: [],
                request_data,
                data: null,
            };
        }

        return {
            estatus_code: 2,
            nivel_detalle: "planes_disponibles",
            mensaje_det: sanitizeDetalle(data?.detalle ?? data?.status ?? "En progreso"),
        };
    }

    if (isSeleccionSeguro) {
        const result = data?.result && typeof data.result === "object" ? data.result : {};
        const aseguradora = String(result?.aseguradora ?? result?.insuranceOption ?? "").trim() || null;
        const prima = result?.prima_seleccionada ?? result?.primaSeleccionada ?? result?.prima;
        const prima_seleccionada =
            typeof prima === "number"
                ? prima
                : (Number.isFinite(Number(prima)) ? Number(prima) : null);

        const rangoRaw = result?.rango_anualidad && typeof result.rango_anualidad === "object" ? result.rango_anualidad : null;
        const minimo = rangoRaw && Number.isFinite(Number(rangoRaw.minimo)) ? Number(rangoRaw.minimo) : null;
        const maximo = rangoRaw && Number.isFinite(Number(rangoRaw.maximo)) ? Number(rangoRaw.maximo) : null;

        const base = {
            aseguradora,
            prima_seleccionada,
            anualidad_requerida: result?.anualidad_requerida === true,
            rango_anualidad: { minimo, maximo },
        };

        if (status === "completado") {
            return {
                ...base,
                estatus_code: Number.isFinite(Number(result?.estatus_code)) ? Number(result.estatus_code) : 1,
                mensaje_det: String(result?.mensaje_det ?? "EXITOSO"),
            };
        }

        if (status === "fallido") {
            return {
                ...base,
                estatus_code: Number.isFinite(Number(result?.estatus_code)) ? Number(result.estatus_code) : 0,
                mensaje_det: sanitizeDetalle(result?.mensaje_det ?? data?.detalle),
            };
        }

        return {
            ...base,
            estatus_code: 2,
            mensaje_det: sanitizeDetalle(data?.detalle ?? data?.status ?? "En progreso"),
        };
    }

    if (nivel_detalle === "guardar_cotizacion") {
        const result = data?.result && typeof data.result === "object" ? data.result : {};
        const form_error_content = String(result?.form_error_content ?? data?.form_error_content ?? "").trim() || null;
        const form_error_field = String(result?.form_error_field ?? data?.form_error_field ?? "").trim() || null;
        const form_errors = Array.isArray(result?.form_errors)
            ? result.form_errors
            : (Array.isArray(data?.form_errors) ? data.form_errors : null);
        const anualidad_range_message = String(result?.anualidad_range_message ?? "").trim() || null;
        const rango_anualidad_raw =
            result?.rango_anualidad && typeof result.rango_anualidad === "object" ? result.rango_anualidad : null;
        const rango_anualidad =
            rango_anualidad_raw &&
            Number.isFinite(Number(rango_anualidad_raw.minimo)) &&
            Number.isFinite(Number(rango_anualidad_raw.maximo))
                ? { minimo: Number(rango_anualidad_raw.minimo), maximo: Number(rango_anualidad_raw.maximo) }
                : null;
        const phase_durations =
            result?.phase_durations && typeof result.phase_durations === "object"
                ? result.phase_durations
                : (data?.phase_durations && typeof data.phase_durations === "object" ? data.phase_durations : {});

        if (status === "completado") {
            return {
                folio: result?.folio ?? null,
                rfc_calculado: result?.rfc_calculado ?? null,
                mensualidad_1: Number(result?.mensualidad_1 ?? 0) || 0.0,
                mensualidad_13: Number(result?.mensualidad_13 ?? 0) || 0.0,
                estatus_code: Number.isFinite(Number(result?.estatus_code))
                    ? Number(result.estatus_code)
                    : (result?.folio ? 1 : 0),
                json: result?.json && typeof result.json === "object" ? result.json : null,
                mensaje_det: String(result?.mensaje_det ?? (result?.folio ? "EXITOSO" : "Error")),
                ...(form_error_content ? { form_error_content } : {}),
                ...(form_error_field ? { form_error_field } : {}),
                ...(Array.isArray(form_errors) && form_errors.length ? { form_errors } : {}),
                ...(anualidad_range_message ? { anualidad_range_message } : {}),
                ...(rango_anualidad ? { rango_anualidad } : {}),
                phase_durations,
            };
        }

        if (status === "fallido") {
            return {
                folio: null,
                rfc_calculado: null,
                mensualidad_1: 0.0,
                mensualidad_13: 0.0,
                estatus_code: 0,
                json: null,
                mensaje_det: sanitizeDetalle(data?.detalle),
                ...(form_error_content ? { form_error_content } : {}),
                ...(form_error_field ? { form_error_field } : {}),
                ...(Array.isArray(form_errors) && form_errors.length ? { form_errors } : {}),
                ...(anualidad_range_message ? { anualidad_range_message } : {}),
                ...(rango_anualidad ? { rango_anualidad } : {}),
                phase_durations,
            };
        }

        return {
            folio: null,
            rfc_calculado: null,
            mensualidad_1: 0.0,
            mensualidad_13: 0.0,
            estatus_code: 2,
            json: null,
            mensaje_det: sanitizeDetalle(data?.detalle ?? data?.status ?? "En progreso"),
            ...(form_error_content ? { form_error_content } : {}),
            ...(form_error_field ? { form_error_field } : {}),
            ...(Array.isArray(form_errors) && form_errors.length ? { form_errors } : {}),
            ...(anualidad_range_message ? { anualidad_range_message } : {}),
            ...(rango_anualidad ? { rango_anualidad } : {}),
            phase_durations,
        };
    }

    if (status === "completado") {
        const primas = Array.isArray(data?.primas_seguros) ? data.primas_seguros : [];
        const primas_formateadas = primas.map((p) => ({
            aseguradora: String(p?.aseguradora ?? p?.nombre ?? "").trim(),
            monto: formatPrima(p?.monto ?? p?.prima),
            anualidad_requerida: p?.anualidad_requerida === true,
            rango_anualidad: p?.rango_anualidad || { minimo: null, maximo: null },
        }));

        if (primas_formateadas.length === 0) {
            return {
                estatus_code: 0,
                nivel_detalle: nivel_detalle || "seguros",
                mensaje_det: "No se obtuvieron primas de seguros",
                primas_seguros: [],
                aseguradoras: [],
                data: {
                    aseguradoras: [],
                    estatus_code: 0,
                    nivel_detalle: nivel_detalle || "seguros",
                    mensaje_det: "No se obtuvieron primas de seguros",
                    primas_seguros: [],
                },
            };
        }

        const aseguradoras = primas_formateadas.map((p) => ({
            nombre: p.aseguradora,
            prima: p.monto,
        }));

        return {
            estatus_code: 1,
            nivel_detalle: nivel_detalle || "seguros",
            mensaje_det: "Primas de seguros consultadas exitosamente",
            primas_seguros: primas_formateadas,
            aseguradoras,
            data: {
                aseguradoras,
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
    };
}
module.exports = {
    formatearSalidaCliente,
};
