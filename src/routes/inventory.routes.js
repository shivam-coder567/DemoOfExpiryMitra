const express = require("express");
const {
  listInventory,
  getInventory,
  createManual,
  confirmSave
} = require("../controllers/inventory.controller");

const router = express.Router();

router.get("/", listInventory);
router.get("/:id", getInventory);
router.post("/manual", createManual);
router.post("/confirm", confirmSave);

module.exports = router;
