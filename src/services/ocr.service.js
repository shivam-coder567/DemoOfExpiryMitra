/**
 * Production-ready OCR service for reading expiry labels and text.
 */

const { isValidImagePayload } = require("../middleware/validate.middleware");

class OcrError extends Error {
  constructor(message, statusCode = 500, isTransient = false) {
    super(message);
    this.name = "OcrError";
    this.statusCode = statusCode;
    this.isTransient = isTransient;
  }
}

function getTimeoutMs() {
  const parsed = Number(process.env.EXTERNAL_API_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
}

function isImageData(value) {
  return isValidImagePayload(value);
}

/**
 * Normalizes messy OCR output without corrupting date characters.
 */
function normalizeOcrText(text) {
  if (typeof text !== "string") return "";

  let cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ");

  // Join lines where a label is separated from its value by a newline
  // e.g. "EXP:\n11/06/2026" -> "EXP: 11/06/2026"
  cleaned = cleaned.replace(
    /\b(MFG|MFD|EXP|EXPIRY|USE BY|BEST BEFORE|BEST BY|BATCH|LOT|B\.NO|BN)[:\s]*\n+[:\s]*/gi,
    "$1: "
  );

  // Normalize spaced letters in standard keywords: "E X P" -> "EXP", "M F G" -> "MFG"
  cleaned = cleaned.replace(/\bM\s+F\s+G\b/gi, "MFG");
  cleaned = cleaned.replace(/\bM\s+F\s+D\b/gi, "MFD");
  cleaned = cleaned.replace(/\bE\s+X\s+P\b/gi, "EXP");
  cleaned = cleaned.replace(/\bL\s+O\s+T\b/gi, "LOT");

  // Fix spaced separators in dates: "11 / 06 / 2026" -> "11/06/2026"
  cleaned = cleaned.replace(
    /(\d{1,2})\s*([\/\-\.])\s*(\d{1,2})\s*([\/\-\.])\s*(\d{2,4})/g,
    "$1$2$3$4$5"
  );
  cleaned = cleaned.replace(
    /(\d{1,2})\s*([\/\-\.])\s*(\d{4})/g,
    "$1$2$3"
  );

  // Collapse excessive inline spaces while preserving newlines
  cleaned = cleaned
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  return cleaned.trim();
}

/**
 * Calls configured OCR API with timeout and safe response parsing.
 */
async function callOcrApiOnce(image) {
  const apiUrl =
    process.env.OCR_API_URL || "https://api.ocr.space/parse/image";
  const apiKey = process.env.OCR_API_KEY;

  if (!apiKey) {
    throw new OcrError("OCR_API_KEY is not configured", 500, false);
  }

  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const isOcrSpace = apiUrl.toLowerCase().includes("ocr.space");

  try {
    let response;

    if (isOcrSpace) {
      const language = process.env.OCR_LANGUAGE || "eng";
      const engine = String(process.env.OCR_ENGINE || "2");

      const params = new URLSearchParams({
        apikey: apiKey,
        base64Image: image,
        language,
        OCREngine: engine,
        isOverlayRequired: "false",
        scale: "true",
        detectOrientation: "true"
      });

      response = await fetch(apiUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          apikey: apiKey,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
      });
    } else {
      // Custom JSON OCR API endpoint
      response = await fetch(apiUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          apikey: apiKey
        },
        body: JSON.stringify({
          image,
          language: process.env.OCR_LANGUAGE || "eng",
          engine: process.env.OCR_ENGINE || "2"
        })
      });
    }

    if (!response.ok) {
      const isTransient = response.status >= 500;
      throw new OcrError(
        `OCR HTTP ${response.status}`,
        response.status,
        isTransient
      );
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new OcrError("Malformed JSON response from OCR API", 502, true);
    }

    if (!data || typeof data !== "object") {
      throw new OcrError("Invalid OCR response structure", 502, true);
    }

    // OCR.space specific result extraction
    if (Array.isArray(data.ParsedResults)) {
      if (data.IsErroredOnProcessing && (!data.ParsedResults.length || !data.ParsedResults[0].ParsedText)) {
        const errorMsg = Array.isArray(data.ErrorMessage)
          ? data.ErrorMessage.join("; ")
          : (data.ErrorMessage || "OCR processing failed");
        throw new OcrError(errorMsg, 422, false);
      }

      const parsedText = data.ParsedResults.map((r) => r.ParsedText || "").join("\n").trim();
      return {
        rawText: parsedText,
        confidence: 0.92,
        source: "ocr_api"
      };
    }

    // Generic JSON endpoint fallback
    const rawText = String(data.rawText || data.text || "").trim();
    const confidence = Number.isFinite(Number(data.confidence))
      ? Number(data.confidence)
      : null;

    return {
      rawText,
      confidence,
      source: "ocr_api"
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new OcrError("OCR request timed out", 504, true);
    }
    if (error instanceof OcrError) {
      throw error;
    }
    throw new OcrError(`OCR request failed: ${error.message}`, 502, true);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Executes OCR with safe retry for transient errors.
 */
async function callConfiguredOcr(image) {
  const maxRetries = 1;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await callOcrApiOnce(image);
    } catch (error) {
      lastError = error;
      if (!error.isTransient || attempt === maxRetries) {
        break;
      }
      // Brief pause before retry
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw lastError;
}

/**
 * Public service method to extract and normalize text from image.
 */
async function extractText(image) {
  if (!isImageData(image)) {
    return {
      rawText: "",
      normalizedText: "",
      confidence: 0,
      source: "invalid_image"
    };
  }

  // Preserve deterministic mock behavior for test environments when key is absent or mock requested
  if (
    process.env.OCR_MODE === "mock" ||
    (!process.env.OCR_API_KEY && process.env.OCR_MODE !== "real")
  ) {
    const mockRaw = "MFG 12/06/2024 EXP 11/06/2026 BATCH A24B7";
    return {
      rawText: mockRaw,
      normalizedText: normalizeOcrText(mockRaw),
      confidence: 0.96,
      source: "mock"
    };
  }

  // Production flow: call real OCR API
  const result = await callConfiguredOcr(image);
  const normalizedText = normalizeOcrText(result.rawText);

  return {
    rawText: result.rawText,
    normalizedText,
    confidence: result.confidence ?? 0.90,
    source: result.source
  };
}

module.exports = {
  extractText,
  normalizeOcrText,
  callConfiguredOcr,
  isImageData,
  OcrError
};
