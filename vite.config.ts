import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const wsProxyTarget = process.env.VITE_CODEX_WS_PROXY_TARGET ?? process.env.VITE_CODEX_WS_URL ?? "ws://127.0.0.1:3901";
const authRelayTarget = process.env.VITE_CODEX_AUTH_RELAY_TARGET ?? "http://127.0.0.1:1455";

const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
};

const normalizeLocalPath = (rawValue: string | null | undefined) => {
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

const sendText = (res: ServerResponse, statusCode: number, message: string) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
};

const sendJson = (res: ServerResponse, statusCode: number, payload: unknown) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const sendHtml = (res: ServerResponse, statusCode: number, body: string) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(body);
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const stripHtml = (value: string) =>
  value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractAuthRelayMessage = (body: string) => {
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

const readRequestBody = async (req: IncomingMessage) => {
  const chunks: Array<Uint8Array> = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
};

const relayAuthCallback = async (search: string) => {
  const target = new URL("/auth/callback", authRelayTarget);
  target.search = search;

  const response = await fetch(target, {
    method: "GET",
  });
  const body = await response.text();
  const message = extractAuthRelayMessage(body);
  const failedByBody = /sign-in could not be completed|token_exchange_failed|state mismatch/i.test(body);

  return {
    ok: response.ok && !failedByBody,
    status: response.ok && !failedByBody ? 200 : response.status,
    text: message,
  };
};

const sendLocalFile = async (res: ServerResponse, filePath: string | null | undefined) => {
  const normalizedPath = normalizeLocalPath(filePath);
  if (!normalizedPath || !path.isAbsolute(normalizedPath)) {
    sendText(res, 400, "Invalid local path");
    return;
  }

  try {
    const stat = await fs.stat(normalizedPath);
    if (!stat.isFile()) {
      sendText(res, 404, "Not a file");
      return;
    }

    const body = await fs.readFile(normalizedPath);
    const extension = path.extname(normalizedPath).toLowerCase();
    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", CONTENT_TYPES[extension] ?? "application/octet-stream");
    res.end(body);
  } catch {
    sendText(res, 404, "File not found");
  }
};

const localAssetMiddleware = (): Connect.NextHandleFunction => {
  return async (req, res, next) => {
    if (!req.url) {
      next();
      return;
    }

    const requestUrl = new URL(req.url, "http://codex.local");

    if (requestUrl.pathname === "/codex-local-image") {
      await sendLocalFile(res, requestUrl.searchParams.get("path"));
      return;
    }

    if (requestUrl.pathname.startsWith("/codex-local-browse")) {
      const rawPath = decodeURI(requestUrl.pathname.slice("/codex-local-browse".length));
      await sendLocalFile(res, rawPath);
      return;
    }

    next();
  };
};

const authRelayMiddleware = (): Connect.NextHandleFunction => {
  return async (req, res, next) => {
    if (!req.url) {
      next();
      return;
    }

    const requestUrl = new URL(req.url, "http://codex.local");

    if (req.method === "GET" && requestUrl.pathname === "/auth/callback") {
      try {
        const result = await relayAuthCallback(requestUrl.search);
        const ok = result.ok;
        const message = escapeHtml(result.text || (ok ? "Login completed." : "Login relay failed."));

        sendHtml(
          res,
          ok ? 200 : result.status,
          `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex Login</title>
    <style>
      body { font-family: sans-serif; background:#0f0f1a; color:#f5f5ff; padding:24px; }
      .card { max-width:560px; margin:40px auto; padding:20px; border:1px solid #2d2d44; border-radius:16px; background:#171726; }
      a { color:#8b8cff; }
      pre { white-space:pre-wrap; word-break:break-word; color:#b8b8d9; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${ok ? "Codex login completed" : "Codex login relay failed"}</h1>
      <pre>${message}</pre>
      <p><a href="/threads">Return to Codex UI</a></p>
      ${ok ? '<script>setTimeout(()=>window.location.replace("/threads"), 1200)</script>' : ""}
    </div>
  </body>
</html>`,
        );
      } catch (error) {
        sendText(res, 502, error instanceof Error ? error.message : "Failed to relay auth callback");
      }
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/codex-auth/complete") {
      try {
        const rawBody = await readRequestBody(req);
        const parsed = rawBody ? JSON.parse(rawBody) : {};
        const callbackUrl = typeof parsed.callbackUrl === "string" ? parsed.callbackUrl.trim() : "";
        if (!callbackUrl) {
          sendJson(res, 400, { error: "Missing callbackUrl" });
          return;
        }

        const callback = new URL(callbackUrl);
        if (callback.pathname !== "/auth/callback") {
          sendJson(res, 400, { error: "Callback URL must target /auth/callback" });
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
          error: error instanceof Error ? error.message : "Failed to complete mobile login",
        });
      }
      return;
    }

    next();
  };
};

const codexLocalAssetPlugin = (): Plugin => ({
  name: "codex-local-assets",
  configureServer(server) {
    server.middlewares.use(localAssetMiddleware());
    server.middlewares.use(authRelayMiddleware());
  },
  configurePreviewServer(server) {
    server.middlewares.use(localAssetMiddleware());
    server.middlewares.use(authRelayMiddleware());
  },
});

export default defineConfig({
  plugins: [react(), codexLocalAssetPlugin()],
  server: {
    host: "0.0.0.0",
    proxy: {
      "/codex-ws": {
        target: wsProxyTarget,
        ws: true,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/codex-ws/, ""),
      },
      "/codex-api/ws": {
        target: wsProxyTarget,
        ws: true,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/codex-api\/ws/, ""),
      },
    },
  },
  preview: {
    host: "0.0.0.0",
  },
});
