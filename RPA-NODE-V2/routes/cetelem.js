const express = require("express");
const { cotizarCetelemAsync, cotizarSeguroCetelem } = require("../controllers/cetelem.controller");

const router = express.Router();

router.post("/cotizar-cetelem-async", cotizarCetelemAsync);
router.post("/cotizar-seguro-cetelem", cotizarSeguroCetelem);

module.exports = router;
