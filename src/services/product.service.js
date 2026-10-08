const { get, save } = require("../repositories/product.repository");

const OFF_BASE =
  process.env.OPEN_FOOD_FACTS_BASE_URL ||
  "https://world.openfoodfacts.org/api/v2/product";

async function findProduct(barcode) {
  const normalizedBarcode = String(barcode || "").trim();

  if (!normalizedBarcode) return { status: "not_found" };

  const local = await get(normalizedBarcode);
  if (local) return { status: "found", product: local };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(
      `${OFF_BASE}/${encodeURIComponent(normalizedBarcode)}.json`,
      { signal: controller.signal }
    );

    if (response.ok) {
      const data = await response.json();

      if (data.status === 1 && data.product) {
        const product = {
          barcode: normalizedBarcode,
          name: data.product.product_name || "Unknown product",
          brand: data.product.brands || "",
          category: data.product.categories || "",
          source: "external_api"
        };

        await save(product);
        return { status: "found", product };
      }
    }
  } catch (error) {
    console.warn("Open Food Facts lookup unavailable:", error.message);
  } finally {
    clearTimeout(timeout);
  }

  return { status: "not_found" };
}

module.exports = { findProduct };
