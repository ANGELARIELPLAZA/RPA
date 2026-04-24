const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeCotizacionPayload } = require("../services/payloadNormalizer.service");

test("payloadNormalizer: preserva debug cuando viene como objeto", () => {
    const out = normalizeCotizacionPayload({
        agencia: "KIA",
        nivel_detalle: "seguros",
        seguro: { insuranceCP: "01000" },
        debug: { stop_at: "seguros", pause_ms: 1234 },
    });

    assert.equal(out.agencia, "KIA");
    assert.equal(out.nivel_detalle, "seguros");
    assert.deepEqual(out.debug, { stop_at: "seguros", pause_ms: 1234 });
});

test("payloadNormalizer: ignora debug si no es objeto", () => {
    const out = normalizeCotizacionPayload({
        agencia: "KIA",
        nivel_detalle: "seguros",
        seguro: { insuranceCP: "01000" },
        debug: "1",
    });

    assert.equal(out.agencia, "KIA");
    assert.equal(out.nivel_detalle, "seguros");
    assert.equal(out.debug, undefined);
});

