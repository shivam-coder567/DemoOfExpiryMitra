const { processScan } = require("../services/scan.service");

async function scan(req, res, next) {
  try {
    const { barcode, image } = req.body;

    if (!barcode || !image) {
      return res.status(400).json({
        status: "error",
        message: "barcode and image are required"
      });
    }

    const result = await processScan({ barcode, image });
    res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
}

module.exports = { scan };
