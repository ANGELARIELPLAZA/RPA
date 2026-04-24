const test = require("node:test");
const assert = require("node:assert/strict");

const { formatearSalidaCliente } = require("../services/statusFormatter.service");

test("planes_disponibles: completado devuelve lista de planes", () => {
    const out = formatearSalidaCliente({
        status: "completado",
        nivel_detalle: "planes_disponibles",
        result: {
            estatus_code: 1,
            nivel_detalle: "planes_disponibles",
            mensaje_det: "ok",
            planes: [{ id: "2026", nombre: "Plan 2026" }],
            request_data: { agencia: "Primavera" },
        },
    });

    assert.equal(out.estatus_code, 1);
    assert.equal(out.nivel_detalle, "planes_disponibles");
    assert.ok(Array.isArray(out.planes) && out.planes.length === 1);
    assert.equal(out.request_data.agencia, "Primavera");
});

test("planes_disponibles: fallido mantiene estructura", () => {
    const out = formatearSalidaCliente({
        status: "fallido",
        nivel_detalle: "planes_disponibles",
        detalle: "Falta campo requerido: customerName",
    });

    assert.equal(out.estatus_code, 0);
    assert.equal(out.nivel_detalle, "planes_disponibles");
    assert.deepEqual(out.planes, []);
    assert.equal(out.data, null);
});

test("seleccion_seguro: completado devuelve prima seleccionada", () => {
    const out = formatearSalidaCliente({
        status: "completado",
        nivel_detalle: "seleccion_seguro",
        result: {
            aseguradora: "HDI",
            prima_seleccionada: 52707.63,
            anualidad_requerida: true,
            rango_anualidad: { minimo: 17401, maximo: 34802 },
            estatus_code: 1,
            mensaje_det: "EXITOSO",
        },
    });

    assert.equal(out.estatus_code, 1);
    assert.equal(out.aseguradora, "HDI");
    assert.equal(out.prima_seleccionada, 52707.63);
    assert.equal(out.anualidad_requerida, true);
    assert.deepEqual(out.rango_anualidad, { minimo: 17401, maximo: 34802 });
});

test("seleccion_seguro: fallido mantiene estructura con nulls", () => {
    const out = formatearSalidaCliente({
        status: "fallido",
        nivel_detalle: "seleccion_seguro",
        detalle: "Aseguradora no estÃ¡ disponible: GNP",
    });

    assert.equal(out.estatus_code, 0);
    assert.equal(out.aseguradora, null);
    assert.equal(out.prima_seleccionada, null);
    assert.equal(out.anualidad_requerida, false);
    assert.deepEqual(out.rango_anualidad, { minimo: null, maximo: null });
});

test("seguros: completado incluye rango_anualidad por aseguradora", () => {
    const out = formatearSalidaCliente({
        status: "completado",
        nivel_detalle: "seguros",
        primas_seguros: [
            {
                aseguradora: "HDI",
                monto: "1000",
                anualidad_requerida: true,
                rango_anualidad: { minimo: 100, maximo: 200 },
            },
            {
                aseguradora: "GNP",
                monto: 2000,
                anualidad_requerida: false,
                rango_anualidad: { min: "10", max: "20" },
            },
        ],
    });

    assert.equal(out.estatus_code, 1);
    assert.equal(out.nivel_detalle, "seguros");
    assert.equal(out.primas_seguros.length, 2);
    assert.deepEqual(out.primas_seguros[0].rango_anualidad, { minimo: 100, maximo: 200 });
    assert.deepEqual(out.primas_seguros[1].rango_anualidad, { minimo: 10, maximo: 20 });
});
