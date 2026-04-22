const test = require("node:test");
const assert = require("node:assert/strict");

const { buildFlowStages, isNonEmptyObject } = require("../services/flowPlan.service");

test("isNonEmptyObject: ignora null/undefined/blank", () => {
    assert.equal(isNonEmptyObject(null), false);
    assert.equal(isNonEmptyObject(undefined), false);
    assert.equal(isNonEmptyObject({}), false);
    assert.equal(isNonEmptyObject({ a: null, b: undefined, c: "" }), false);
    assert.equal(isNonEmptyObject({ a: "   " }), false);
});

test("isNonEmptyObject: detecta valores no vacíos", () => {
    assert.equal(isNonEmptyObject({ a: 0 }), true);
    assert.equal(isNonEmptyObject({ a: "0" }), true);
    assert.equal(isNonEmptyObject({ a: "X" }), true);
});

test("buildFlowStages: no agrega cliente si viene vacío", () => {
    const payload = {
        nivel_detalle: "planes_disponibles",
        cliente: { customerType: "1", customerName: null },
        vehiculo: { vehicleBrand: "KIA" },
        credito: { creditDepositTerm: "12" },
        seguro: { insuranceCP: "45640" },
    };

    const stages = buildFlowStages(payload).map((s) => s.name);
    assert.deepEqual(stages, ["login", "vehiculo", "credito", "planes_disponibles", "finalizando"]);
});
