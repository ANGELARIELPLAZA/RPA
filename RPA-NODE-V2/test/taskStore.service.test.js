const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function freshTaskStore(env = {}) {
    Object.assign(process.env, env);
    // Importante: taskStore depende de ../config, que lee env al cargarse.
    for (const mod of ["../config", "../services/taskStore.service"]) {
        delete require.cache[require.resolve(mod)];
    }
    return require("../services/taskStore.service");
}

test("taskStore.toPublicStatus (tiempo + screenshot)", async (t) => {
    await t.test("incluye tiempo_transcurrido en ms/seg/min", () => {
        const taskStore = freshTaskStore();

        const task = taskStore.createTask({
            task_id: "t-1",
            fecha_ejecucion: 1_000,
            payload_original: {},
            payload_normalizado: { nivel_detalle: "seguros" },
            total_steps: 1,
        });

        task.started_at = 1_000;
        task.finished_at = 61_000;
        task.status = "completado";

        const out = taskStore.toPublicStatus(task, { includeScreenshotBase64: false });

        assert.equal(out.tiempo_transcurrido_ms, 60_000);
        assert.equal(out.tiempo_transcurrido_segundos, 60);
        assert.equal(out.tiempo_transcurrido_minutos, 1);
    });

    await t.test("puede incluir screenshot.base64 cuando hay screenshot_url", () => {
        const tmpDir = path.join(__dirname, ".tmp_screenshots");
        fs.mkdirSync(tmpDir, { recursive: true });

        const taskStore = freshTaskStore({
            SCREENSHOTS_DIR: tmpDir,
            BASE_URL: "http://localhost:3000",
        });

        const filename = "test.png";
        const localPath = path.join(tmpDir, filename);
        fs.writeFileSync(localPath, Buffer.from([0x01, 0x02, 0x03]));

        const task = taskStore.createTask({
            task_id: "t-2",
            fecha_ejecucion: Date.now(),
            payload_original: {},
            payload_normalizado: { nivel_detalle: "planes_disponibles" },
            total_steps: 1,
        });

        task.status = "completado";
        task.screenshot_url = `http://localhost:3000/screenshots/${encodeURIComponent(filename)}`;

        const out = taskStore.toPublicStatus(task, { includeScreenshotBase64: true });
        assert.ok(out.screenshot && typeof out.screenshot.base64 === "string" && out.screenshot.base64.length > 0);

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});
