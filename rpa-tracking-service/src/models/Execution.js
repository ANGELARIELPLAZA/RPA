const mongoose = require("mongoose");

const ExecutionSchema = new mongoose.Schema(
    {
        task_id: { type: String, required: true, unique: true, index: true },
        source_service: { type: String, default: "RPA-NODE-V2" },

        status: { type: String, enum: ["En progreso", "completado", "fallido"], index: true, default: "En progreso" },
        etapa_nombre: { type: String, index: true, default: "inicializando" },
        etapa_numero: { type: String, default: "0/0" },
        current_step: { type: Number, default: 0 },
        total_steps: { type: Number, default: 0 },

        fecha_ejecucion: { type: Date, index: true },
        started_at: { type: Date },
        finished_at: { type: Date, index: true },
        tiempo_transcurrido_ms: { type: Number },

        payload_original: { type: mongoose.Schema.Types.Mixed },
        payload_normalizado: { type: mongoose.Schema.Types.Mixed },
        result: { type: mongoose.Schema.Types.Mixed },

        detalle: { type: String },
        screenshot_url: { type: String },

        error: {
            message: { type: String },
            stack: { type: String },
            code: { type: String },
        },

        robot_meta: { type: mongoose.Schema.Types.Mixed },
        portal_meta: { type: mongoose.Schema.Types.Mixed },
    },
    { timestamps: true }
);

ExecutionSchema.index({ createdAt: -1 });
ExecutionSchema.index({ finished_at: -1 });

module.exports = mongoose.model("Execution", ExecutionSchema);

