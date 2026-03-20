import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const wsProxyTarget = process.env.VITE_CODEX_WS_PROXY_TARGET ?? process.env.VITE_CODEX_WS_URL ?? "ws://127.0.0.1:3901";

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

const codexLocalAssetPlugin = (): Plugin => ({
  name: "codex-local-assets",
  configureServer(server) {
    server.middlewares.use(localAssetMiddleware());
  },
  configurePreviewServer(server) {
    server.middlewares.use(localAssetMiddleware());
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
