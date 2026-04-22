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
