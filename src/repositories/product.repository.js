const { read, write } = require("./storage");

async function get(barcode) {
  const products = await read("products.json", []);
  return products.find((p) => p.barcode === barcode) || null;
}

async function save(product) {
  const products = await read("products.json", []);
  const index = products.findIndex((p) => p.barcode === product.barcode);

  if (index >= 0) products[index] = product;
  else products.push(product);

  await write("products.json", products);
  return product;
}

module.exports = { get, save };
