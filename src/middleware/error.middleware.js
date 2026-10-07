function notFound(req, res) {
  res.status(404).json({
    status: "not_found",
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
}

function errorHandler(error, _req, res, _next) {
  console.error(error);
  res.status(500).json({
    status: "error",
    message: "Internal server error"
  });
}

module.exports = { notFound, errorHandler };
