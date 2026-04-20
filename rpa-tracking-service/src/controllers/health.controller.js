const mongoose = require("mongoose");
const { SERVICE_NAME } = require("../config/env");

function getHealth(req, res) {
    return res.json({
        service: SERVICE_NAME,
        ok: true,
        db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        uptime_s: Math.floor(process.uptime()),
    });
}

module.exports = {
    getHealth,
};

