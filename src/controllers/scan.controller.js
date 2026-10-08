const { processScan } = require("../services/scan.service");

function isValidImagePayload(image) {
  if (typeof image !== "string" || image.trim().length === 0) return false;
  // Practice client sends a base64 data URL. Keep validation permissive enough
  // for tests and future OCR providers.
  return image.startsWith("data:image/") || image.length > 100;
}

async function scan(req, res, next) {
  try {
    const barcode = typeof req.body?.barcode === "string"
      ? req.body.barcode.trim()
      : "";
    const image = typeof req.body?.image === "string"
      ? req.body.image.trim()
      : "";

    if (!barcode || !image) {
      return res.status(400).json({
        status: "error",
        message: "barcode and image are required"
      });
    }

    if (!isValidImagePayload(image)) {
      return res.status(400).json({
        status: "error",
        message: "image must be a valid base64 image payload"
      });
    }

    const result = await processScan({ barcode, image });
    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    return next(error);
  }
}

module.exports = { scan };
