const { app, BrowserWindow, shell } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const DIST_DIR = path.join(__dirname, "../dist-electron");
const PREFERRED_PORT = 34291; // Fixed port so IndexedDB origin stays stable across restarts

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback — all unknown paths serve index.html so react-router works
      fs.readFile(path.join(DIST_DIR, "index.html"), (err2, html) => {
        if (err2) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      });
    } else {
      res.writeHead(200, { "Content-Type": mime });
      res.end(data);
    }
  });
}

function startServer(port, callback) {
  const server = http.createServer((req, res) => {
    let pathname = req.url.split("?")[0];
    if (pathname === "/" || pathname === "") pathname = "/index.html";
    serveFile(res, path.join(DIST_DIR, pathname));
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      // Port in use — pick a random one
      startServer(0, callback);
    } else {
      console.error("Server error:", err);
    }
  });

  server.listen(port, "127.0.0.1", () => {
    callback(server.address().port);
  });
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 420,
    height: 780,
    minWidth: 360,
    minHeight: 600,
    title: "Pearl Wallet",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
    backgroundColor: "#050811",
  });

  win.loadURL(`http://127.0.0.1:${port}`);

  win.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    shell.openExternal(openUrl);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  startServer(PREFERRED_PORT, (port) => {
    createWindow(port);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
