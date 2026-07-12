const path = require("node:path");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function getContentType(filePath) {
  return MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
}

module.exports = {
  getContentType
};
