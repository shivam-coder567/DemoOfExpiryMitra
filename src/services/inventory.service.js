const repo = require("../repositories/inventory.repository");

function statusFor(expiryDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(`${expiryDate}T00:00:00`);
  const days_left = Math.ceil((expiry - today) / 86400000);

  let status = "expired";
  if (days_left > 7) status = "safe";
  else if (days_left >= 1) status = "expiring_soon";

  return { days_left, status };
}

function computed(item) {
  return { ...item, ...statusFor(item.expiry_date) };
}

async function create(data) {
  const item = {
    id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ...data,
    created_at: new Date().toISOString()
  };

  return repo.save(item);
}

async function createManual(body) {
  if (!body.barcode || !body.product_name || !body.expiry_date) {
    return {
      httpStatus: 400,
      body: {
        status: "error",
        message: "barcode, product_name and expiry_date are required"
      }
    };
  }

  const item = await create({
    barcode: body.barcode,
    product_name: body.product_name,
    brand: body.brand || "",
    batch: body.batch || null,
    mfg_date: body.mfg_date || null,
    expiry_date: body.expiry_date,
    quantity: Number(body.quantity || 1),
    confidence: null,
    source: "manual"
  });

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

module.exports = { create, createManual, list, get };
