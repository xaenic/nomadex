import { readFileSync } from "node:fs";
import net from "node:net";
import process from "node:process";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wsUrl = process.env.VITE_CODEX_WS_URL ?? "ws://127.0.0.1:3901";
const uiPort = process.env.VITE_CODEX_UI_PORT ?? "3784";
const url = new URL(wsUrl);
const host = url.hostname;
const port = Number(url.port || (url.protocol === "wss:" ? 443 : 80));
const children = [];
const require = createRequire(import.meta.url);

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

const resolveLocalNodePackageLaunch = (packageName, binName) => {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const relativeBin =
      typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[binName];

    if (!relativeBin) {
      return null;
    }

    return {
      command: process.execPath,
      args: [path.resolve(path.dirname(packageJsonPath), relativeBin)],
      shell: false,
      source: `${packageName} local dependency`,
    };
  } catch {
    return null;
  }
};

const resolveLocalCodexLaunch = () =>
  resolveLocalNodePackageLaunch("@openai/codex", "codex");

const getCodexLaunch = () => {
  const localLaunch = resolveLocalCodexLaunch();

  if (localLaunch) {
    return localLaunch;
  }

  return {
    command: process.platform === "win32" ? "codex.cmd" : "codex",
    args: [],
    shell: false,
    source: "global PATH",
  };
};

const getViteLaunch = () => {
  const localLaunch = resolveLocalNodePackageLaunch("vite", "vite");

  if (localLaunch) {
    return localLaunch;
  }

  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "dev", "--"],
    shell: process.platform === "win32",
    source: "npm fallback",
  };
};

const formatSpawnError = (error) => {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    return (
      "Could not find the Codex CLI. Run `npm install` in this repo to use the bundled " +
      "dev dependency, or install `@openai/codex` globally."
    );
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

  const codexLaunch = getCodexLaunch();
  console.log(`[nomadex] Starting Codex app-server at ${wsUrl}`);
  const appServer = spawn(
    codexLaunch.command,
    [...codexLaunch.args, "app-server", "--listen", wsUrl],
    {
    cwd: projectRoot,
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

  throw new Error(`Timed out waiting for Codex app-server at ${wsUrl}`);
};

const startVite = () => {
  console.log(`[nomadex] Starting Vite dev server on http://127.0.0.1:${uiPort}`);
  const viteLaunch = getViteLaunch();

  const viteEnv = {
    ...process.env,
    VITE_CODEX_WS_PROXY_TARGET: wsUrl,
  };

  delete viteEnv.VITE_CODEX_WS_URL;

  const vite = spawn(
    viteLaunch.command,
    [
      ...viteLaunch.args,
      "--host",
      "0.0.0.0",
      "--port",
      uiPort,
      "--strictPort",
    ],
    {
      cwd: projectRoot,
      stdio: "inherit",
      env: viteEnv,
      shell: viteLaunch.shell,
    },
  );
  let viteError = null;

  vite.once("error", (error) => {
    viteError = error;
    stopChildren();
    console.error(`[nomadex] ${formatSpawnError(error)}`);
    process.exit(1);
  });

  children.push(vite);

  vite.on("exit", (code) => {
    if (viteError) {
      return;
    }
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
