/**
 * Inventory service for managing tracked product records.
 */

const repo = require("../repositories/inventory.repository");

/**
 * Calculates days remaining until expiry and categorical status.
 * @param {string} expiryDate - YYYY-MM-DD
 * @returns {{ days_left: number, status: "expired"|"expiring_soon"|"safe" }}
 */
function statusFor(expiryDate) {
  if (!expiryDate || typeof expiryDate !== "string") {
    return { days_left: 0, status: "expired" };
  }

  const expiry = new Date(`${expiryDate}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) {
    return { days_left: 0, status: "expired" };
  }

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );

  const days_left = Math.ceil((expiry.getTime() - todayUtc) / 86400000);

  let status = "expired";
  if (days_left > 7) {
    status = "safe";
  } else if (days_left >= 1) {
    status = "expiring_soon";
  }

  return { days_left, status };
}

function computed(item) {
  return { ...item, ...statusFor(item.expiry_date) };
}

function normalizedQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

/**
 * Saves a new inventory item with metadata.
 */
async function create(data) {
  const item = {
    id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    barcode: String(data.barcode || "").trim(),
    product_name: String(data.product_name || "").trim(),
    brand: data.brand ? String(data.brand).trim() : "",
    batch: data.batch ? String(data.batch).trim() : null,
    mfg_date: data.mfg_date || null,
    expiry_date: data.expiry_date,
    quantity: normalizedQuantity(data.quantity) || 1,
    confidence: typeof data.confidence === "number" ? data.confidence : null,
    source: data.source || "ocr",
    created_at: new Date().toISOString()
  };

  return repo.save(item);
}

/**
 * Manual inventory entry handler.
 */
async function createManual(body = {}) {
  if (!body.barcode || !body.product_name || !body.expiry_date) {
    return {
      httpStatus: 400,
      body: {
        status: "error",
        message: "barcode, product_name and expiry_date are required"
      }
    };
  }

  const quantity = normalizedQuantity(body.quantity || 1);
  if (quantity === null) {
    return {
      httpStatus: 400,
      body: {
        status: "error",
        message: "quantity must be a positive number"
      }
    };
  }

  const item = await create({
    barcode: body.barcode,
    product_name: body.product_name,
    brand: body.brand,
    batch: body.batch,
    mfg_date: body.mfg_date,
    expiry_date: body.expiry_date,
    quantity,
    confidence: null,
    source: "manual"
  });

  return { httpStatus: 201, body: computed(item) };
}

/**
 * Confirms and persists an inventory item if not already saved.
 */
async function confirmSave(body = {}) {
  if (body.record_id) {
    const existing = await repo.get(body.record_id);
    if (existing) {
      return { httpStatus: 200, body: computed(existing) };
    }
  }

  if (!body.barcode || !body.product_name || !body.expiry_date) {
    return {
      httpStatus: 400,
      body: {
        status: "error",
        message: "barcode, product_name and expiry_date are required"
      }
    };
  }

  const item = await create(body);
  return { httpStatus: 201, body: computed(item) };
}

async function list() {
  const items = await repo.list();
  return items.map(computed);
}

async function get(id) {
  const item = await repo.get(id);
  return item ? computed(item) : null;
}

module.exports = {
  create,
  createManual,
  confirmSave,
  list,
  get,
  statusFor,
  computed
};
