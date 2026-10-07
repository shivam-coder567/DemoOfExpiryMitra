const express = require("express");
const {
  listInventory,
  getInventory,
  createManual
} = require("../controllers/inventory.controller");

const router = express.Router();

router.get("/", listInventory);
router.get("/:id", getInventory);
router.post("/manual", createManual);

module.exports = router;
