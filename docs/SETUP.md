# Setup

This document covers local launch, LAN/mobile access, manual bridge setup, and the main failure cases for Nomadex.

## 1. Prerequisites

- Node.js 20 or newer recommended
- `npm`
- `codex` CLI installed and reachable on `PATH`

Check the agent bridge binary first:

```bash
codex --version
```

## 2. Recommended Launch

From the repo root:

```bash
npm install
npm run dev:live
```

`npm install` includes the Codex CLI as a local development dependency for this
project, so you do not need a separate global `codex` install just to launch
Nomadex.

Expected result:

- Codex app-server on `ws://127.0.0.1:3901`
- Nomadex UI on `http://127.0.0.1:3784`
- Browser websocket proxy on `/codex-ws`

`dev:live` is the recommended path because it validates both sides:

- It reuses an existing app-server only if `/readyz` succeeds.
- It refuses to start if the UI port is already busy.
- It binds the UI to `0.0.0.0`, which is useful for mobile/LAN access.

## 3. Manual Launch

If you want to manage the bridge yourself:

```bash
npm run app-server
VITE_CODEX_WS_URL=ws://127.0.0.1:3901 npm run dev -- --host 0.0.0.0 --port 3784 --strictPort
```

This is useful if:

- you want a different websocket target
- you are debugging the app-server directly
- you want to run the bridge separately from Vite

## 4. Environment Variables

Main variables:

- `VITE_CODEX_WS_URL`
  Websocket URL for the Codex app-server. Default: `ws://127.0.0.1:3901`
- `VITE_CODEX_UI_PORT`
  UI port used by `dev:live`. Default: `3784`
- `VITE_CODEX_AUTH_RELAY_TARGET`
  HTTP target used for login callback relay. Default: `http://127.0.0.1:1455`

Examples:

```bash
VITE_CODEX_UI_PORT=4173 npm run dev:live
VITE_CODEX_WS_URL=ws://127.0.0.1:3902 npm run dev:live
```

## 5. LAN And Mobile Access

On the same network:

1. Run `npm run dev:live` on your machine.
2. Find your machine's LAN IP.
3. Open `http://<lan-ip>:3784` from your phone or tablet.

Because the websocket is proxied through the same origin, the browser should connect through the Nomadex host without needing a separate websocket URL in the device browser.

## 6. Access From Outside Your Network

Do not expose the raw Vite dev server directly to the internet.

Safer options:

- Tailscale or another private mesh VPN
- SSH tunnel from your phone/laptop to the machine
- Reverse proxy with real auth in front of Nomadex

Practical rule:

- Good: VPN, SSH forwarding, authenticated reverse proxy
- Bad: open `3784` directly to the public internet

## 7. Build And Preview

Build:

```bash
npm run build
```

Preview:

```bash
npm run preview
```

Use `preview` to inspect the production build shell. The main live development workflow is still `dev:live`.

## 8. File And Image Uploads

Current behavior:

- Images can be pasted into the composer
- Non-image files go through `Attach`
- Uploaded assets are written into the workspace under:
  - `.codex-web/uploads`
  - `.codex-web/uploads/files`

The runtime currently injects file mentions into the prompt manifest so the live agent can see attached file paths consistently.

## 9. Troubleshooting

### UI port is busy

Error:

```text
UI port 3784 is already in use
```

Fix:

- stop the old process using `3784`, or
- open the already-running UI, or
- change `VITE_CODEX_UI_PORT`

### Websocket bridge port is occupied by another process

Error:

```text
Port 3901 on 127.0.0.1 is already in use, but it is not responding like a Codex app-server
```

Fix:

- stop the conflicting process, or
- run the app-server on another port and set `VITE_CODEX_WS_URL`

### Browser shows websocket connection failures

Check:

1. `npm run dev:live` is still running
2. the UI URL is really the strict port you launched, usually `3784`
3. the app-server is reachable on the configured websocket target
4. you hard refreshed after recent websocket or theme changes

### Old favicon or theme color still shows

Mobile browsers cache icon and `theme-color` metadata aggressively.

Fix:

1. hard refresh
2. close the tab
3. reopen the page

## 10. Current Boundaries

- The UI has a provider abstraction layer, but the shipped live provider is still Codex.
- Internet-safe deployment is not baked in. Add your own network boundary and auth if you expose it remotely.
- Some runtime/storage paths still use Codex-specific names because they match the active provider contract.
