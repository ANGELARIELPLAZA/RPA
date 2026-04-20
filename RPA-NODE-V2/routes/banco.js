const express = require("express");
const { getJob } = require("../controllers/banco.controller");

const router = express.Router();

router.get("/banco/job/:job_id", getJob);

module.exports = router;

