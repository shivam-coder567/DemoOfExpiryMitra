const { findProduct } = require("./product.service");
const { extractText } = require("./ocr.service");
const { interpretExpiry } = require("./ai.service");
const { validate } = require("./validation.service");
const inventory = require("./inventory.service");

async function processScan({ barcode, image }) {
  const productResult = await findProduct(barcode);

  if (productResult.status === "not_found") {
    return {
      httpStatus: 200,
      body: {
        status: "not_found",
        barcode,
        message: "Product not found. Ask the user for product name and expiry."
      }
    };
  }

  const ocr = await extractText(image);

  if (!ocr.rawText) {
    return {
      httpStatus: 200,
      body: {
        status: "low_confidence",
        product: productResult.product,
        expiry: {
          raw_text: "",
          parsed_expiry_date: null,
          parsed_mfg_date: null,
          batch: null,
          confidence: 0
        },
        message: "No useful expiry text found. Retry or enter manually."
      }
    };
  }

  const interpretation = await interpretExpiry(ocr.rawText);
  const validation = validate(interpretation);

  if (!validation.accepted) {
    return {
      httpStatus: 200,
      body: {
        status: "low_confidence",
        product: productResult.product,
        expiry: {
          raw_text: ocr.rawText,
          parsed_expiry_date: interpretation.expiry_date,
          parsed_mfg_date: interpretation.mfg_date,
          batch: interpretation.batch,
          confidence: interpretation.confidence
        },
        message: validation.message
      }
    };
  }

  const item = await inventory.create({
    barcode,
    product_name: productResult.product.name,
    brand: productResult.product.brand,
    batch: interpretation.batch,
    mfg_date: interpretation.mfg_date,
    expiry_date: interpretation.expiry_date,
    quantity: 1,
    confidence: interpretation.confidence,
    source: "ocr"
  });

  return {
    httpStatus: 200,
    body: {
      status: "confident",
      product: productResult.product,
      expiry: {
        raw_text: ocr.rawText,
        parsed_expiry_date: interpretation.expiry_date,
        parsed_mfg_date: interpretation.mfg_date,
        batch: interpretation.batch,
        confidence: interpretation.confidence
      },
      record_id: item.id
    }
  };
}

module.exports = { processScan };
