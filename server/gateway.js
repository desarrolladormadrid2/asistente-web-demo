// Gateway local: expone el servidor OpenCode del Desktop con CORS + auth propia.
// Sin dependencias. Variables de entorno:
//   WEB_PORT    puerto local (def: 4500)
//   WEB_PASSWORD contraseña que usan los clientes del chat
//   DESKTOP_URL  URL del servidor OpenCode interno (def: http://127.0.0.1:50366)
//   DESKTOP_USER/USERNAME  y DESKTOP_PASSWORD  credenciales del servidor interno
//   DIRECTORY    directorio del proyecto a inyectar como x-opencode-directory
"use strict";

const http = require("http");
const { URL } = require("url");

const WEB_PORT = parseInt(process.env.WEB_PORT || "4500", 10);
const WEB_PASSWORD = process.env.WEB_PASSWORD || "";
const DESKTOP_URL = process.env.DESKTOP_URL || "http://127.0.0.1:50366";
const DESKTOP_USER = process.env.DESKTOP_USER || "opencode";
const DESKTOP_PASSWORD = process.env.DESKTOP_PASSWORD || process.env.OPENCODE_SERVER_PASSWORD || "";
const DIRECTORY = process.env.DIRECTORY || "";

const desktopAuth = "Basic " + Buffer.from(DESKTOP_USER + ":" + DESKTOP_PASSWORD).toString("base64");

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return (
    /^https:\/\/desarrolladormadrid2\.github\.io$/.test(origin) ||
    /^http:\/\/localhost(:\d+)?$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
  );
}

function corsHeaders(origin) {
  const allow = origin || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, x-opencode-directory, if-match",
    "Access-Control-Expose-Headers": "x-opencode-directory, retry-after",
    "Vary": "Origin"
  };
}

function checkAuth(req) {
  const h = req.headers["authorization"] || "";
  const m = /^Basic (.+)$/.exec(h);
  if (!m || !WEB_PASSWORD) return false;
  const dec = Buffer.from(m[1], "base64").toString("utf8");
  const i = dec.indexOf(":");
  if (i < 0) return false;
  return dec.slice(0, i) === "opencode" && dec.slice(i + 1) === WEB_PASSWORD;
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const cors = corsHeaders(origin);

  if (!isAllowedOrigin(origin)) {
    res.writeHead(403, Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, cors));
    res.end("origin not allowed");
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (!checkAuth(req)) {
    res.writeHead(401, Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, cors, { "WWW-Authenticate": 'Basic realm="opencode"' }));
    res.end("unauthorized");
    return;
  }

  const target = new URL(DESKTOP_URL + req.url);

  const headers = {};
  for (const k of Object.keys(req.headers)) {
    if (["authorization", "host", "connection", "origin", "access-control-request-method", "access-control-request-headers"].includes(k)) continue;
    headers[k] = req.headers[k];
  }
  headers["authorization"] = desktopAuth;
  headers["accept-encoding"] = "identity";
  if (DIRECTORY) headers["x-opencode-directory"] = DIRECTORY;

  const proxyReq = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers
    },
    (proxyRes) => {
      const out = {};
      for (const k of Object.keys(proxyRes.headers)) {
        if (["connection", "keep-alive", "transfer-encoding"].includes(k)) continue;
        out[k] = proxyRes.headers[k];
      }
      res.writeHead(proxyRes.statusCode || 502, Object.assign({}, out, cors));
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, cors));
      res.end("gateway error: " + err.message);
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq);
});

server.listen(WEB_PORT, "127.0.0.1", () => {
  console.log("gateway listen http://127.0.0.1:" + WEB_PORT);
  console.log("desktop target " + DESKTOP_URL);
  console.log("directory " + DIRECTORY);
  console.log("auth enabled: " + (WEB_PASSWORD ? "yes" : "NO"));
});