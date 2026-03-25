#!/usr/bin/env node

import { createServer } from "node:http";
import { statSync, readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import httpProxy from "http-proxy";

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(packageRoot, "dist");
const packageJson = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
const launchCwd = process.cwd();
const children = [];

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseArgs = (argv) => {
  const options = {
    host: process.env.NOMADEX_HOST ?? "0.0.0.0",
    uiPort:
      process.env.NOMADEX_UI_PORT ??
      process.env.VITE_CODEX_UI_PORT ??
      "3784",
    wsUrl:
      process.env.NOMADEX_WS_URL ??
      process.env.VITE_CODEX_WS_URL ??
      "ws://127.0.0.1:3901",
    authRelayTarget:
      process.env.NOMADEX_AUTH_RELAY_TARGET ??
      process.env.VITE_CODEX_AUTH_RELAY_TARGET ??
      "http://127.0.0.1:1455",
    password: process.env.NOMADEX_PASSWORD ?? "",
    updateCheck:
      process.env.NOMADEX_NO_UPDATE_CHECK === "1" ? false : true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      options.version = true;
      continue;
    }
    if (arg === "--host") {
      options.host = argv[index + 1] ?? options.host;
      index += 1;
      continue;
    }
    if (arg === "--port") {
      options.uiPort = argv[index + 1] ?? options.uiPort;
      index += 1;
      continue;
    }
    if (arg === "--ws-url") {
      options.wsUrl = argv[index + 1] ?? options.wsUrl;
      index += 1;
      continue;
    }
    if (arg === "--auth-relay-target") {
      options.authRelayTarget = argv[index + 1] ?? options.authRelayTarget;
      index += 1;
      continue;
    }
    if (arg === "--password") {
      options.password = argv[index + 1] ?? options.password;
      index += 1;
      continue;
    }
    if (arg === "--no-update-check") {
      options.updateCheck = false;
    }
  }

  return {
    ...options,
    uiPort: Number(options.uiPort),
  };
};

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  process.stdout.write(`Nomadex ${packageJson.version}

Usage:
  nomadex
  nomadex --port 3784 --ws-url ws://127.0.0.1:3901

Options:
  --host <host>                Host to bind the UI server (default: 0.0.0.0)
  --port <port>                UI port (default: 3784)
  --ws-url <url>               App-server websocket target (default: ws://127.0.0.1:3901)
  --auth-relay-target <url>    Auth relay HTTP target (default: http://127.0.0.1:1455)
  --password <value>           UI password (default: generated per launch)
  --no-update-check            Skip npm registry update prompt
  --help                       Show this help
  --version                    Print the package version
`);
  process.exit(0);
}

if (options.version) {
  process.stdout.write(`${packageJson.version}\n`);
  process.exit(0);
}

if (!Number.isInteger(options.uiPort) || options.uiPort <= 0) {
  console.error("[nomadex] Invalid UI port.");
  process.exit(1);
}

const rawLaunchPassword = options.password.trim();
const appPassword = rawLaunchPassword || randomBytes(9).toString("base64url");
const passwordSource = rawLaunchPassword ? "configured" : "generated";
const sessionCookieName = "nomadex_session";
const uiSessions = new Set();

const isTruthyYes = (value) => /^(1|y|yes|true)$/iu.test(value.trim());

const parseVersion = (value) =>
  value
    .split(".")
    .map((part) => Number.parseInt(part.replace(/[^0-9].*$/u, ""), 10) || 0);

const compareVersions = (left, right) => {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
};

const parseCookies = (rawCookie) => {
  const cookies = {};
  for (const part of rawCookie?.split(";") ?? []) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    cookies[name] = decodeURIComponent(value);
  }
  return cookies;
};

const createSessionToken = () => {
  const token = randomBytes(24).toString("base64url");
  uiSessions.add(token);
  return token;
};

const getSessionToken = (req) => parseCookies(req.headers.cookie)[sessionCookieName] ?? null;

const isAuthenticatedRequest = (req) => {
  const token = getSessionToken(req);
  return token ? uiSessions.has(token) : false;
};

const setSessionCookie = (res, token) => {
  res.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
  );
};

const clearSessionCookie = (res) => {
  res.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
};

const sanitizeNextPath = (value) => {
  if (typeof value !== "string") {
    return "/threads";
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return "/threads";
  }
  if (trimmed.startsWith("//")) {
    return "/threads";
  }
  return trimmed;
};

const matchesPassword = (value) => {
  const provided = Buffer.from(value, "utf8");
  const expected = Buffer.from(appPassword, "utf8");
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
};

const renderLoginPage = ({ errorMessage = "", nextPath = "/threads" } = {}) => {
  const escapedMessage = errorMessage
    ? `<p class="login-note login-note-error">${escapeHtml(errorMessage)}</p>`
    : '<p class="login-note">Enter the Nomadex access password shown in the launcher terminal.</p>';
  const safeNext = escapeHtml(sanitizeNextPath(nextPath));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nomadex Access</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, rgba(72, 219, 203, 0.12), transparent 42%), #0d1118;
        color: #f3f5ff;
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        padding: 24px;
      }
      .card {
        width: min(100%, 420px);
        padding: 24px;
        border-radius: 20px;
        background: #141a24;
        border: 1px solid #283245;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 20px;
      }
      p {
        margin: 0;
        color: #b4bdd4;
        line-height: 1.55;
      }
      .login-note {
        margin-bottom: 18px;
      }
      .login-note-error {
        color: #ff97ac;
      }
      label {
        display: block;
        margin-bottom: 8px;
        color: #dfe5f6;
        font-size: 13px;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #2f3c52;
        border-radius: 14px;
        background: #0f141d;
        color: #f3f5ff;
        padding: 14px 16px;
        font: inherit;
        outline: none;
      }
      input:focus {
        border-color: #57dbc9;
        box-shadow: 0 0 0 3px rgba(87, 219, 201, 0.16);
      }
      button {
        margin-top: 14px;
        width: 100%;
        border: 0;
        border-radius: 14px;
        background: #57dbc9;
        color: #08211d;
        padding: 14px 16px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .foot {
        margin-top: 14px;
        font-size: 12px;
        color: #90a0bf;
      }
    </style>
  </head>
  <body>
    <form class="card" method="post" action="/login">
      <h1>Nomadex Access</h1>
      ${escapedMessage}
      <input type="hidden" name="next" value="${safeNext}" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus />
      <button type="submit">Unlock workspace</button>
      <p class="foot">This password is generated by the running Nomadex launcher unless you set <code>NOMADEX_PASSWORD</code>.</p>
    </form>
  </body>
</html>`;
};

const promptForUpdate = async () => {
  if (!options.updateCheck || !process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageJson.name)}/latest`,
      {
        signal: AbortSignal.timeout(1500),
      },
    );
    if (!response.ok) {
      return false;
    }

    const latest = await response.json();
    const latestVersion =
      typeof latest?.version === "string" ? latest.version.trim() : "";

    if (!latestVersion) {
      return false;
    }

    if (
      compareVersions(parseVersion(packageJson.version), parseVersion(latestVersion)) >=
      0
    ) {
      return false;
    }

    console.log(
      `[nomadex] Update available: ${packageJson.version} -> ${latestVersion}`,
    );
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const answer = await rl.question(
        "Start the latest Nomadex package instead? [y/N] ",
      );
      if (!isTruthyYes(answer)) {
        return false;
      }
    } finally {
      rl.close();
    }

    const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
    const restart = spawn(
      npxCommand,
      ["--yes", `${packageJson.name}@${latestVersion}`, ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: process.env,
      },
    );

    restart.once("error", (error) => {
      console.error(
        `[nomadex] Failed to start updated package: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    });

    await new Promise((resolve) => {
      restart.once("spawn", resolve);
    });

    return true;
  } catch {
    return false;
  }
};

const wsUrl = new URL(options.wsUrl);
const wsHost = wsUrl.hostname;
const wsPort = Number(wsUrl.port || (wsUrl.protocol === "wss:" ? 443 : 80));
const readyzUrl = (() => {
  const target = new URL(options.wsUrl);
  target.protocol = target.protocol === "wss:" ? "https:" : "http:";
  target.pathname = "/readyz";
  target.search = "";
  target.hash = "";
  return target;
})();
const authRelayTarget = options.authRelayTarget;

const resolveLocalNodePackageLaunch = (packageName, binName) => {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const dependencyPackage = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const relativeBin =
      typeof dependencyPackage.bin === "string"
        ? dependencyPackage.bin
        : dependencyPackage.bin?.[binName];

    if (!relativeBin) {
      return null;
    }

    return {
      command: process.execPath,
      args: [path.resolve(path.dirname(packageJsonPath), relativeBin)],
      shell: false,
      source: `${packageName} dependency`,
    };
  } catch {
    return null;
  }
};

const getCodexLaunch = () =>
  resolveLocalNodePackageLaunch("@openai/codex", "codex") ?? {
    command: process.platform === "win32" ? "codex.cmd" : "codex",
    args: [],
    shell: false,
    source: "global PATH",
  };

const isPortOpen = (targetHost, targetPort) =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(targetPort, targetHost);
  });

const isCodexAppServerReady = async () => {
  try {
    const response = await fetch(readyzUrl, {
      signal: AbortSignal.timeout(500),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const ensureUiPortAvailable = async () => {
  if (!(await isPortOpen("127.0.0.1", options.uiPort))) {
    return;
  }

  throw new Error(
    `UI port ${options.uiPort} is already in use. Open the existing UI at http://127.0.0.1:${options.uiPort} or choose another port with --port.`,
  );
};

const formatSpawnError = (error) => {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    return "Could not find the Codex CLI. Install `@openai/codex` or use the bundled package dependency.";
  }

  if (error instanceof Error) {
    return `Failed to start the Codex CLI: ${error.message}`;
  }

  return `Failed to start the Codex CLI: ${String(error)}`;
};

const stopChildren = () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
};

const shutdown = (code) => {
  stopChildren();
  process.exit(code);
};

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

const ensureDistBuilt = () => {
  const indexPath = path.join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(
      "Nomadex build output is missing. Run `npm run build` before packing or publishing the package.",
    );
  }
};

const ensureAppServer = async () => {
  if (await isPortOpen(wsHost, wsPort)) {
    if (await isCodexAppServerReady()) {
      console.log(`[nomadex] Reusing Codex app-server at ${options.wsUrl}`);
      return;
    }

    throw new Error(
      `Port ${wsPort} on ${wsHost} is already in use, but it is not responding like a Codex app-server.`,
    );
  }

  const codexLaunch = getCodexLaunch();
  console.log(`[nomadex] Starting Codex app-server at ${options.wsUrl}`);
  const appServer = spawn(
    codexLaunch.command,
    [...codexLaunch.args, "app-server", "--listen", options.wsUrl],
    {
      cwd: launchCwd,
      stdio: "inherit",
      env: process.env,
      shell: codexLaunch.shell,
    },
  );

  let appServerError = null;
  appServer.once("error", (error) => {
    appServerError = error;
  });

  children.push(appServer);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (appServerError) {
      throw new Error(formatSpawnError(appServerError));
    }
    if (await isCodexAppServerReady()) {
      return;
    }
    if (appServer.exitCode !== null) {
      throw new Error(
        `Codex app-server exited with code ${appServer.exitCode} (${codexLaunch.source}).`,
      );
    }
    await sleep(200);
  }

  throw new Error(`Timed out waiting for Codex app-server at ${options.wsUrl}`);
};

const sendText = (res, statusCode, message) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
};

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const sendHtml = (res, statusCode, body) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(body);
};

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const stripHtml = (value) =>
  value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractAuthRelayMessage = (body) => {
  const messageMatch = body.match(/<p class="message">([\s\S]*?)<\/p>/i);
  if (messageMatch) {
    return stripHtml(messageMatch[1]);
  }

  const titleMatch = body.match(/<h1>([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    return stripHtml(titleMatch[1]);
  }

  return stripHtml(body) || body;
};

const readRequestBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const relayAuthCallback = async (search) => {
  const target = new URL("/auth/callback", authRelayTarget);
  target.search = search;

  const response = await fetch(target, {
    method: "GET",
  });
  const body = await response.text();
  const message = extractAuthRelayMessage(body);
  const failedByBody =
    /sign-in could not be completed|token_exchange_failed|state mismatch/i.test(
      body,
    );

  return {
    ok: response.ok && !failedByBody,
    status: response.ok && !failedByBody ? 200 : response.status,
    text: message,
  };
};

const normalizeLocalPath = (rawValue) => {
  const value = rawValue?.trim();
  if (!value) {
    return null;
  }

  try {
    if (value.startsWith("file://")) {
      return decodeURIComponent(new URL(value).pathname);
    }
  } catch {
    return null;
  }

  return value;
};

const sendLocalFile = async (res, filePath) => {
  const normalizedPath = normalizeLocalPath(filePath);
  if (!normalizedPath || !path.isAbsolute(normalizedPath)) {
    sendText(res, 400, "Invalid local path");
    return;
  }

  try {
    const fileStat = statSync(normalizedPath);
    if (!fileStat.isFile()) {
      sendText(res, 404, "Not a file");
      return;
    }

    const body = await readFile(normalizedPath);
    const extension = path.extname(normalizedPath).toLowerCase();
    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Type",
      CONTENT_TYPES[extension] ?? "application/octet-stream",
    );
    res.end(body);
  } catch {
    sendText(res, 404, "File not found");
  }
};

const serveStaticFile = async (res, targetPath) => {
  const body = await readFile(targetPath);
  const extension = path.extname(targetPath).toLowerCase();
  res.statusCode = 200;
  res.setHeader(
    "Content-Type",
    CONTENT_TYPES[extension] ?? "application/octet-stream",
  );
  res.end(body);
};

const isSafeDistPath = (pathname) => {
  const normalized = path.posix.normalize(pathname);
  return !normalized.startsWith("/../") && normalized !== "/..";
};

const resolveDistPath = (pathname) => {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  if (!isSafeDistPath(safePath)) {
    return null;
  }

  const candidate = path.join(distDir, safePath.replace(/^\/+/u, ""));
  if (!candidate.startsWith(distDir)) {
    return null;
  }

  return candidate;
};

const getPreferredIp = () => {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
};

const wsProxy = httpProxy.createProxyServer({
  target: options.wsUrl,
  ws: true,
  changeOrigin: true,
});

wsProxy.on("proxyReqWs", (proxyReq) => {
  if (!proxyReq.headersSent) {
    proxyReq.removeHeader("origin");
  }
});

wsProxy.on("error", (error, req, resOrSocket) => {
  const message = error instanceof Error ? error.message : String(error);
  if ("writableEnded" in resOrSocket) {
    if (!resOrSocket.headersSent) {
      sendText(resOrSocket, 502, message);
    }
    return;
  }

  try {
    resOrSocket.end();
  } catch {
    // Ignore broken upgrade sockets.
  }
});

const server = createServer(async (req, res) => {
  if (!req.url) {
    sendText(res, 400, "Missing request URL");
    return;
  }

  const requestUrl = new URL(req.url, "http://nomadex.local");
  const { pathname } = requestUrl;

  if (pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/login") {
    sendHtml(
      res,
      200,
      renderLoginPage({
        nextPath: sanitizeNextPath(
          requestUrl.searchParams.get("next") ?? "/threads",
        ),
      }),
    );
    return;
  }

  if (req.method === "POST" && pathname === "/login") {
    const rawBody = await readRequestBody(req);
    const params = new URLSearchParams(rawBody);
    const submittedPassword = params.get("password") ?? "";
    const nextPath = sanitizeNextPath(params.get("next") ?? "/threads");

    if (!matchesPassword(submittedPassword)) {
      clearSessionCookie(res);
      sendHtml(
        res,
        401,
        renderLoginPage({
          errorMessage: "Incorrect password. Use the password shown in the Nomadex launcher.",
          nextPath,
        }),
      );
      return;
    }

    const sessionToken = createSessionToken();
    setSessionCookie(res, sessionToken);
    res.statusCode = 302;
    res.setHeader("Location", nextPath);
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/auth/callback") {
    try {
      const result = await relayAuthCallback(requestUrl.search);
      const ok = result.ok;
      const message = escapeHtml(
        result.text || (ok ? "Login completed." : "Login relay failed."),
      );

      sendHtml(
        res,
        ok ? 200 : result.status,
        `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nomadex Login</title>
    <style>
      body { font-family: sans-serif; background:#111219; color:#f3f5ff; padding:24px; }
      .card { max-width:560px; margin:40px auto; padding:20px; border:1px solid #31354a; border-radius:16px; background:#171a24; }
      a { color:#7fd8c8; }
      pre { white-space:pre-wrap; word-break:break-word; color:#ccd2ec; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${ok ? "Nomadex login completed" : "Nomadex login relay failed"}</h1>
      <pre>${message}</pre>
      <p><a href="/threads">Return to Nomadex</a></p>
      ${ok ? '<script>setTimeout(()=>window.location.replace("/threads"), 1200)</script>' : ""}
    </div>
  </body>
</html>`,
      );
    } catch (error) {
      sendText(
        res,
        502,
        error instanceof Error ? error.message : "Failed to relay auth callback",
      );
    }
    return;
  }

  if (!isAuthenticatedRequest(req)) {
    if (req.method === "GET" || req.method === "HEAD") {
      sendHtml(
        res,
        401,
        renderLoginPage({
          errorMessage: "Enter the Nomadex access password to open this workspace.",
          nextPath: `${requestUrl.pathname}${requestUrl.search}`,
        }),
      );
      return;
    }

    sendJson(res, 401, {
      error: "Unauthorized",
      message: "Enter the Nomadex access password first.",
    });
    return;
  }

  if (
    req.method === "POST" &&
    /^\/[a-z0-9-]+-auth\/complete$/iu.test(pathname)
  ) {
    try {
      const rawBody = await readRequestBody(req);
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      const callbackUrl =
        typeof parsed.callbackUrl === "string" ? parsed.callbackUrl.trim() : "";

      if (!callbackUrl) {
        sendJson(res, 400, { error: "Missing callbackUrl" });
        return;
      }

      const callback = new URL(callbackUrl);
      if (callback.pathname !== "/auth/callback") {
        sendJson(res, 400, {
          error: "Callback URL must target /auth/callback",
        });
        return;
      }

      const result = await relayAuthCallback(callback.search);
      sendJson(res, result.ok ? 200 : result.status, {
        ok: result.ok,
        status: result.status,
        message: result.text,
      });
    } catch (error) {
      sendJson(res, 502, {
        error:
          error instanceof Error
            ? error.message
            : "Failed to complete mobile login",
      });
    }
    return;
  }

  if (req.method === "GET" && /-local-image$/iu.test(pathname)) {
    await sendLocalFile(res, requestUrl.searchParams.get("path"));
    return;
  }

  const browseMatch = pathname.match(/^\/[a-z0-9-]+-local-browse(\/.*)$/iu);
  if (req.method === "GET" && browseMatch?.[1]) {
    await sendLocalFile(res, decodeURI(browseMatch[1]));
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  const directAssetPath = resolveDistPath(pathname);
  if (directAssetPath && existsSync(directAssetPath)) {
    await serveStaticFile(res, directAssetPath);
    return;
  }

  await serveStaticFile(res, path.join(distDir, "index.html"));
});

server.on("upgrade", (req, socket, head) => {
  try {
    const requestUrl = new URL(req.url ?? "/", "http://nomadex.local");
    const pathname = requestUrl.pathname;

    if (
      pathname === "/codex-ws" ||
      pathname === "/codex-api/ws" ||
      /-ws$/iu.test(pathname)
    ) {
      if (!isAuthenticatedRequest(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      req.url = "/";
      wsProxy.ws(req, socket, head);
      return;
    }
  } catch {
    // Ignore malformed upgrade URLs and destroy the socket below.
  }

  socket.destroy();
});

try {
  const restarted = await promptForUpdate();
  if (restarted) {
    process.exit(0);
  }

  ensureDistBuilt();
  await ensureAppServer();
  await ensureUiPortAvailable();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.uiPort, options.host, resolve);
  });

  const preferredIp = getPreferredIp();
  console.log(`[nomadex] UI ready at http://127.0.0.1:${options.uiPort}`);
  if (preferredIp) {
    console.log(`[nomadex] LAN access: http://${preferredIp}:${options.uiPort}`);
  }
  console.log(
    `[nomadex] UI password (${passwordSource}): ${appPassword}`,
  );
} catch (error) {
  stopChildren();
  console.error(
    `[nomadex] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
