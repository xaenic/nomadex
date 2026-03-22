import net from "node:net";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wsUrl = process.env.VITE_CODEX_WS_URL ?? "ws://127.0.0.1:3901";
const uiPort = process.env.VITE_CODEX_UI_PORT ?? "3784";
const url = new URL(wsUrl);
const host = url.hostname;
const port = Number(url.port || (url.protocol === "wss:" ? 443 : 80));
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readyzUrl = (() => {
  const target = new URL(wsUrl);
  target.protocol = target.protocol === "wss:" ? "https:" : "http:";
  target.pathname = "/readyz";
  target.search = "";
  target.hash = "";
  return target;
})();

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
  if (!(await isPortOpen("127.0.0.1", Number(uiPort)))) {
    return;
  }

  throw new Error(
    `UI port ${uiPort} is already in use. Open the existing UI at http://127.0.0.1:${uiPort} ` +
      `or set VITE_CODEX_UI_PORT to a different port before running dev:live.`,
  );
};

const stopChildren = () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
};

process.on("SIGINT", () => {
  stopChildren();
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopChildren();
  process.exit(143);
});

const ensureAppServer = async () => {
  if (await isPortOpen(host, port)) {
    if (await isCodexAppServerReady()) {
      console.log(`[nomadex] Reusing Codex app-server at ${wsUrl}`);
      return;
    }

    throw new Error(
      `Port ${port} on ${host} is already in use, but it is not responding like a Codex app-server. ` +
        `Stop the conflicting process or set VITE_CODEX_WS_URL to a different websocket target.`,
    );
  }

  console.log(`[nomadex] Starting Codex app-server at ${wsUrl}`);
  const appServer = spawn("codex", ["app-server", "--listen", wsUrl], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });

  children.push(appServer);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isCodexAppServerReady()) {
      return;
    }

    if (appServer.exitCode !== null) {
      throw new Error(`Codex app-server exited with code ${appServer.exitCode}`);
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for Codex app-server at ${wsUrl}`);
};

const startVite = () => {
  console.log(`[nomadex] Starting Vite dev server on http://127.0.0.1:${uiPort}`);

  const viteEnv = {
    ...process.env,
    VITE_CODEX_WS_PROXY_TARGET: wsUrl,
  };

  delete viteEnv.VITE_CODEX_WS_URL;

  const vite = spawn(npmBin, ["run", "dev", "--", "--host", "0.0.0.0", "--port", uiPort, "--strictPort"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: viteEnv,
  });

  children.push(vite);

  vite.on("exit", (code) => {
    stopChildren();
    process.exit(code ?? 0);
  });
};

try {
  await ensureAppServer();
  await ensureUiPortAvailable();
  startVite();
} catch (error) {
  stopChildren();
  console.error(`[nomadex] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
