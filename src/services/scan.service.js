/**
 * Scan orchestration service coordinating lookup, OCR, AI, validation, and persistence.
 */

const { findProduct } = require("./product.service");
const { extractText } = require("./ocr.service");
const { interpretExpiry } = require("./ai.service");
const { validate } = require("./validation.service");
const inventory = require("./inventory.service");

async function processScan({ barcode, image }) {
  const normalizedBarcode = String(barcode || "").trim();

  if (!normalizedBarcode) {
    return {
      httpStatus: 400,
      body: {
        status: "error",
        message: "barcode is required"
      }
    };
  }

  // 1. Product Lookup (Local repository -> Open Food Facts)
  const productResult = await findProduct(normalizedBarcode);

  if (productResult.status === "not_found") {
    return {
      httpStatus: 200,
      body: {
        status: "not_found",
        barcode: normalizedBarcode,
        message: "Product not found. Please enter product details manually."
      }
    };
  }

  // 2. OCR API Call
  let ocr;
  try {
    ocr = await extractText(image);
  } catch (error) {
    return {
      httpStatus: 200,
      body: {
        status: "ocr_error",
        message: "Unable to read expiry information. Please retry."
      }
    };
  }

  if (!ocr || !ocr.rawText || !ocr.rawText.trim()) {
    return {
      httpStatus: 200,
      body: {
        status: "ocr_error",
        message: "Unable to read expiry information. Please retry."
      }
    };
  }

  // 3. AI / Regex Interpretation of Normalized OCR Text
  const textToParse = ocr.normalizedText || ocr.rawText;
  const interpretation = await interpretExpiry(textToParse);

  // 4. Business & Date Validation
  const validation = validate(interpretation);

  if (!validation.accepted) {
    const errorStatus = validation.reason === "invalid" ? "invalid" : "low_confidence";
    return {
      httpStatus: 200,
      body: {
        status: errorStatus,
        product: productResult.product,
        expiry: {
          raw_text: ocr.rawText,
          parsed_expiry_date: interpretation.expiry_date,
          parsed_mfg_date: interpretation.mfg_date,
          expiry_date: interpretation.expiry_date,
          mfg_date: interpretation.mfg_date,
          batch: interpretation.batch,
          confidence: interpretation.confidence
        },
        message: validation.message
      }
    };
  }

  // 5. Expiry Status & Days Remaining Calculation
  const { days_left, status: expiry_status } = inventory.statusFor(
    interpretation.expiry_date
  );

  // 6. Persistence to Inventory
  const item = await inventory.create({
    barcode: normalizedBarcode,
    product_name: productResult.product.name,
    brand: productResult.product.brand,
    batch: interpretation.batch,
    mfg_date: interpretation.mfg_date,
    expiry_date: interpretation.expiry_date,
    quantity: 1,
    confidence: interpretation.confidence,
    source: "ocr"
  });

  // 7. Structured Response
  return {
    httpStatus: 200,
    body: {
      status: "confident",
      product: productResult.product,
      expiry: {
        raw_text: ocr.rawText,
        parsed_expiry_date: interpretation.expiry_date,
        parsed_mfg_date: interpretation.mfg_date,
        expiry_date: interpretation.expiry_date,
        mfg_date: interpretation.mfg_date,
        batch: interpretation.batch,
        confidence: interpretation.confidence
      },
      days_left,
      expiry_status,
      record_id: item.id
    }
  };
}

module.exports = { processScan };
