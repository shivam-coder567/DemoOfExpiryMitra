const service = require("../services/inventory.service");

async function listInventory(_req, res, next) {
  try {
    res.json(await service.list());
  } catch (error) {
    next(error);
  }
}

async function getInventory(req, res, next) {
  try {
    const item = await service.get(req.params.id);

    if (!item) {
      return res.status(404).json({
        status: "not_found",
        message: "Inventory item not found"
      });
    }

    res.json(item);
  } catch (error) {
    next(error);
  }
}

async function createManual(req, res, next) {
  try {
    const result = await service.createManual(req.body);
    res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
}

module.exports = { listInventory, getInventory, createManual };
