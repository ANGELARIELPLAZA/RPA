const express = require("express");
const { cotizarCetelemAsync, cotizarSeguroCetelem } = require("../controllers/cetelem.controller");
const { requireApiKey } = require("../middlewares/apiKeyAuth");

const router = express.Router();

router.post("/cotizar-cetelem-async", requireApiKey(), cotizarCetelemAsync);
router.post("/cotizar-seguro-cetelem", requireApiKey(), cotizarSeguroCetelem);

module.exports = router;
