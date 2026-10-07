const { read, write } = require("./storage");

async function save(item) {
  const items = await read("inventory.json", []);
  items.push(item);
  await write("inventory.json", items);
  return item;
}

async function list() {
  return read("inventory.json", []);
}

async function get(id) {
  const items = await read("inventory.json", []);
  return items.find((item) => item.id === id) || null;
}

module.exports = { save, list, get };
