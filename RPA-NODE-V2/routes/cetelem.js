const express = require("express");
const { cotizarCetelemAsync } = require("../controllers/cetelem.controller");

const router = express.Router();

router.post("/cotizar-cetelem-async", cotizarCetelemAsync);

module.exports = router;

