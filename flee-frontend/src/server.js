const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { buildBrowserConfigScript } = require("./config/browser-config");
const { env } = require("./config/env");
const { getContentType } = require("./server/mime-types");

function safeFilePathFromRequest(pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname || "/index.html";
  const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  return path.join(env.PUBLIC_DIR, normalized);
}

function sendFile(res, filePath, fallbackPath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT" && fallbackPath) {
        sendFile(res, fallbackPath);
        return;
      }

      res.writeHead(500, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      res.end("Unexpected file server error.");
      return;
    }

    res.writeHead(200, {
      "Content-Type": getContentType(filePath)
    });
    res.end(content);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/app-config.js") {
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/javascript; charset=utf-8"
      });
      res.end(buildBrowserConfigScript());
      return;
    }

    const filePath = safeFilePathFromRequest(url.pathname);
    const indexPath = path.join(env.PUBLIC_DIR, "index.html");
    sendFile(res, filePath, indexPath);
  });
}

function startServer() {
  const server = createServer();
  server.listen(env.PORT, () => {
    console.log(`flee-frontend running on http://localhost:${env.PORT}`);
  });
  return server;
}

module.exports = {
  startServer
};
