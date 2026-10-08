const express = require("express");
const { scan } = require("../controllers/scan.controller");
const { validateScanRequest } = require("../middleware/validate.middleware");

const router = express.Router();

router.post("/scan", validateScanRequest, scan);

module.exports = router;
