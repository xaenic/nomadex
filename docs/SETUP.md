# Setup

This guide covers the practical Nomadex setup for the workflow it was built for:

- the coding agent runs on your own machine
- the repo and credentials stay on that machine
- you open Nomadex from your phone, tablet, or another computer to monitor and steer the run remotely

## 1. Prerequisites

- Node.js 20 or newer recommended
- `npm`
- `codex` CLI available on `PATH`

Quick check:

```bash
codex --version
```

## 2. Recommended Launch

Normal use:

```bash
npx nomadexapp
```

Expected result:

- Codex app-server on `ws://127.0.0.1:3901`
- Nomadex UI on `http://127.0.0.1:3784`
- Browser websocket proxy on `/codex-ws`

`npx nomadexapp` is the packaged launcher path. It:

- it reuses an existing app-server only if `/readyz` succeeds
- it starts the app-server if needed
- it fails if the UI port is already busy
- it binds the UI to `0.0.0.0`, which is useful for LAN and phone access
- it serves the built UI directly instead of running Vite dev mode
- it prints a UI password in the terminal and blocks browser access until that password is entered
- it can prompt for a newer npm package version before startup

Repo development:

```bash
npm install
npm run dev:live
```

Use `dev:live` when you are editing Nomadex itself and want the Vite development workflow.

## 3. Preferred Remote Access

Preferred setup: ZeroTier.

Why ZeroTier is the preferred path for Nomadex:

- it keeps the UI on a private overlay network
- it is safer than exposing the raw dev server directly
- it works well for phone access from anywhere
- it preserves the model where the real agent stays local to your machine

Recommended flow:

1. Install ZeroTier on the host machine.
2. Install ZeroTier on your phone or remote laptop.
3. Join both devices to the same ZeroTier network.
4. Run `npx nomadexapp` on the host machine.
5. Open `http://<host-zerotier-ip>:3784` from the remote device.

Alternative options:

- Tailscale
- SSH tunnel
- reverse proxy with real auth in front of Nomadex

Do not expose the raw Nomadex dev server directly to the public internet.

## 4. LAN And Mobile Access

On the same local network:

1. Run `npx nomadexapp` on the host machine.
2. Or run `npm run dev:live` if you are using the repo development flow.
3. Find the machine’s LAN IP.
4. Open `http://<lan-ip>:3784` from your phone or tablet.

Because the websocket is proxied through the same origin, the browser should connect through the Nomadex host without needing a separate websocket URL.

## 5. Repo Development And Manual Launch

For normal installed usage, prefer `npx nomadexapp`.

If you are working from the repo and want to manage the bridge yourself:

```bash
npm run app-server
VITE_CODEX_WS_URL=ws://127.0.0.1:3901 npm run dev -- --host 0.0.0.0 --port 3784 --strictPort
```

This is useful if:

- you want a different websocket target
- you are debugging the app-server directly
- you want to run the bridge separately from Vite

## 6. Environment Variables

Main variables:

- `NOMADEX_WS_URL`
  Websocket URL for the packaged launcher. Default: `ws://127.0.0.1:3901`
- `NOMADEX_UI_PORT`
  UI port used by `npx nomadexapp`. Default: `3784`
- `NOMADEX_AUTH_RELAY_TARGET`
  HTTP target used by the packaged auth relay. Default: `http://127.0.0.1:1455`
- `NOMADEX_PASSWORD`
  Stable UI password for the packaged launcher. If unset, Nomadex generates one on each launch and prints it in the terminal.
- `VITE_CODEX_WS_URL`
  Websocket URL for the Codex app-server. Default: `ws://127.0.0.1:3901`
- `VITE_CODEX_UI_PORT`
  UI port used by `dev:live`. Default: `3784`
- `VITE_CODEX_AUTH_RELAY_TARGET`
  HTTP target used for login callback relay. Default: `http://127.0.0.1:1455`

Examples:

```bash
npx nomadexapp --port 4173
npx nomadexapp --ws-url ws://127.0.0.1:3902
NOMADEX_PASSWORD=my-secret npx nomadexapp
VITE_CODEX_UI_PORT=4173 npm run dev:live
VITE_CODEX_WS_URL=ws://127.0.0.1:3902 npm run dev:live
```

## 7. Build And Preview

Build:

```bash
npm run build
```

Preview:

```bash
npm run preview
```

Use `preview` to inspect the built shell inside the repo. The normal packaged launch is `npx nomadexapp`.

## 8. GitHub Actions And npm Publish

This repo now includes:

- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

Behavior:

- pushes and pull requests run `npm ci`, `npm run lint`, and `npm run build`
- pushes to `main` also check npm
- if the current `package.json` version is not published yet, GitHub Actions runs `npm publish --access public --provenance`

Required setup:

1. Add a repository secret named `NPM_TOKEN`.
2. Make sure that token has permission to publish the package.
3. Bump `package.json` version before pushing a release to `main`.

Without a new version, the publish workflow skips instead of failing on a duplicate publish.

## 9. Files, Images, And Uploads

Current behavior:

- images can be pasted into the composer
- non-image files go through `Attach`
- uploaded assets are written into the workspace under:
  - `.codex-web/uploads`
  - `.codex-web/uploads/files`

The runtime injects file mentions into the prompt manifest so the live agent can see attached file paths consistently.

## 10. Troubleshooting

### UI port is busy

Error:

```text
UI port 3784 is already in use
```

Fix:

- stop the old process using `3784`
- open the already-running UI
- or change `NOMADEX_UI_PORT` for the packaged launcher
- or change `VITE_CODEX_UI_PORT` for the repo dev launcher

### Websocket bridge port is occupied

Error:

```text
Port 3901 on 127.0.0.1 is already in use, but it is not responding like a Codex app-server
```

Fix:

- stop the conflicting process
- or run the app-server on another port and set `NOMADEX_WS_URL`
- or set `VITE_CODEX_WS_URL` if you are using `dev:live`

### Browser shows websocket connection failures

Check:

1. `npx nomadexapp` is still running, or `npm run dev:live` if you are in the repo
2. the UI URL is really the strict port you launched
3. the app-server is reachable on the configured websocket target
4. you hard refreshed after recent websocket changes

### Old favicon or theme color still shows

Mobile browsers cache icon and `theme-color` metadata aggressively.

Fix:

1. hard refresh
2. close the tab
3. reopen the page

## 11. Current Boundaries

- Codex is still the strongest live provider path.
- The provider abstraction is ahead of full provider-runtime parity.
- Internet-safe deployment is not built in. Add your own network boundary and auth if you expose Nomadex remotely.
- The packaged launcher currently assumes the Codex app-server contract as the reference bridge path.
