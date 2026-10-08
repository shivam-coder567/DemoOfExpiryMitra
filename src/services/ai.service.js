/**
 * AI / Parser service for extracting manufacturing, expiry, and batch details.
 */

const { parseDate } = require("../utils/date.parser");
const { calculateConfidence } = require("../utils/confidence");

const DATE_PATTERN =
  "(\\d{1,2}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{2,4}|\\d{1,2}[\\/\\-\\.]\\d{4}|\\d{1,2}[\\s\\-\\/.][A-Za-z]{3,9}[\\s\\-\\/.][0-9]{2,4}|\\d{4}[\\/\\-]\\d{1,2}[\\/\\-]\\d{1,2})";

const MFG_REGEX = new RegExp(
  "(?:MANUFACTURING\\s+DATE|MANUFACTURED\\s+ON|MANUFACTURED|DATE\\s+OF\\s+MFG|MFD\\s+DATE|MFD|MFG|PKD|PACKED)\\b[:\\s.]*" +
    DATE_PATTERN,
  "i"
);

const EXP_REGEX = new RegExp(
  "(?:BEST\\s+BEFORE\\s+DATE|BEST\\s+BEFORE|BEST\\s+BY|EXPIRY\\s+DATE|EXP\\s+DATE|EXPIRY|USE\\s+BY|EXP)\\b[:\\s.]*" +
    DATE_PATTERN,
  "i"
);

const BATCH_REGEX =
  /(?:BATCH\s+(?:NO|NUMBER)|LOT\s+(?:NO|NUMBER)|BATCH|LOT|B\.NO|BN)\b[:\s.]*([A-Za-z0-9\-_]{2,20})/i;

/**
 * Extracts manufacturing date, expiry date, batch, and confidence from OCR text.
 * @param {string} rawText
 * @returns {Promise<{ expiry_date: string|null, mfg_date: string|null, batch: string|null, confidence: number }>}
 */
async function interpretExpiry(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    return {
      expiry_date: null,
      mfg_date: null,
      batch: null,
      confidence: 0
    };
  }

  const text = rawText.trim();
  let mfgDate = null;
  let expiryDate = null;
  let batch = null;
  let hasMfgLabel = false;
  let hasExpiryLabel = false;

  // 1. Check for Manufacturing Date
  const mfgMatch = text.match(MFG_REGEX);
  if (mfgMatch && mfgMatch[1]) {
    hasMfgLabel = true;
    mfgDate = parseDate(mfgMatch[1], { isExpiry: false });
  }

  // 2. Check for Expiry Date
  const expMatch = text.match(EXP_REGEX);
  if (expMatch && expMatch[1]) {
    hasExpiryLabel = true;
    expiryDate = parseDate(expMatch[1], { isExpiry: true });
  }

  // 3. Fallback: if expiry date was not found by main regex, try line-by-line inspection
  if (!expiryDate) {
    const lines = text.split("\n");
    for (const line of lines) {
      const lineExp = line.match(EXP_REGEX);
      if (lineExp && lineExp[1]) {
        hasExpiryLabel = true;
        expiryDate = parseDate(lineExp[1], { isExpiry: true });
        if (expiryDate) break;
      }
    }
  }

  // 4. Fallback: if manufacturing date was not found by main regex, inspect lines
  if (!mfgDate) {
    const lines = text.split("\n");
    for (const line of lines) {
      const lineMfg = line.match(MFG_REGEX);
      if (lineMfg && lineMfg[1]) {
        hasMfgLabel = true;
        mfgDate = parseDate(lineMfg[1], { isExpiry: false });
        if (mfgDate) break;
      }
    }
  }

  // 5. Check for Batch Number
  const batchMatch = text.match(BATCH_REGEX);
  if (batchMatch && batchMatch[1]) {
    const candidate = batchMatch[1].trim().toUpperCase();
    if (!candidate.includes("/") && candidate.length >= 2) {
      batch = candidate;
    }
  }

  // Consistency check
  let datesConsistent = true;
  if (mfgDate && expiryDate && expiryDate < mfgDate) {
    datesConsistent = false;
  }

  const confidence = calculateConfidence({
    hasExpiryLabel,
    hasExpiryDate: Boolean(expiryDate),
    hasMfgLabel,
    hasMfgDate: Boolean(mfgDate),
    hasBatch: Boolean(batch),
    datesConsistent
  });

  return {
    mfg_date: mfgDate,
    expiry_date: expiryDate,
    batch,
    confidence
  };
}

module.exports = {
  interpretExpiry,
  MFG_REGEX,
  EXP_REGEX,
  BATCH_REGEX
};
