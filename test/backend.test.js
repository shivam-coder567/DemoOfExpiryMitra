const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");

const { validate } = require("../src/services/validation.service");
const { interpretExpiry } = require("../src/services/ai.service");
const { extractText } = require("../src/services/ocr.service");
const { statusFor } = require("../src/services/inventory.service");
const { processScan } = require("../src/services/scan.service");

const inventoryFile = path.join(__dirname, "../data/inventory.json");

test("validates a confident expiry result", () => {
  const result = validate({
    confidence: 0.94,
    mfg_date: "2024-06-12",
    expiry_date: "2026-06-11"
  });

  assert.equal(result.accepted, true);
});

test("rejects low-confidence results", () => {
  const result = validate({
    confidence: 0.5,
    expiry_date: "2026-06-11"
  });

  assert.equal(result.accepted, false);
});

test("rejects expiry before manufacturing date", () => {
  const result = validate({
    confidence: 0.95,
    mfg_date: "2026-06-12",
    expiry_date: "2026-06-11"
  });

  assert.equal(result.accepted, false);
});

test("mock AI parses the practice expiry format", async () => {
  const result = await interpretExpiry(
    "MFG 12/06/2024 EXP 11/06/2026 BATCH A24B7"
  );

  assert.deepEqual(result, {
    mfg_date: "2024-06-12",
    expiry_date: "2026-06-11",
    batch: "A24B7",
    confidence: 0.94
  });
});

test("mock OCR returns deterministic practice text", async () => {
  const result = await extractText("data:image/jpeg;base64,test");
  assert.match(result.rawText, /MFG 12\/06\/2024/);
  assert.equal(result.confidence, 0.96);
});

test("inventory status is computed consistently", () => {
  assert.equal(statusFor("2000-01-01").status, "expired");
  assert.equal(statusFor("2999-01-01").status, "safe");
});

test("scan flow saves a confident local product", async () => {
  const before = await fs.readFile(inventoryFile, "utf8").catch(() => "[]");
  try {
    const result = await processScan({
      barcode: "8901030700087",
      image: "data:image/jpeg;base64,test"
    });

    assert.equal(result.httpStatus, 200);
    assert.equal(result.body.status, "confident");
    assert.equal(result.body.product.name, "Maggi 2-Minute Noodles");
    assert.ok(result.body.record_id);
  } finally {
    await fs.writeFile(inventoryFile, before, "utf8");
  }
});
