const express = require("express");
const cors = require("cors");
const path = require("path");

const scanRoutes = require("./routes/scan.routes");
const inventoryRoutes = require("./routes/inventory.routes");
const { notFound, errorHandler } = require("./middleware/error.middleware");

const app = express();

app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.use(express.static(path.join(__dirname, "../public")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "expirymitra-practice" });
});

app.use("/api", scanRoutes);
app.use("/api/inventory", inventoryRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
