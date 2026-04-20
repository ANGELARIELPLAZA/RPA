const mongoose = require("mongoose");

const ExecutionEventSchema = new mongoose.Schema(
    {
        task_id: { type: String, required: true, index: true },
        event_type: { type: String, index: true, required: true },
        etapa_nombre: { type: String, index: true },
        etapa_numero: { type: String },
        message: { type: String },
        detail: { type: mongoose.Schema.Types.Mixed },
        level: { type: String, enum: ["info", "warn", "error"], default: "info" },
        screenshot_url: { type: String },
        timestamp: { type: Date, default: Date.now, index: true },
        meta: { type: mongoose.Schema.Types.Mixed },
    },
    { timestamps: true }
);

ExecutionEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model("ExecutionEvent", ExecutionEventSchema);

