# Nomadex

<p align="center">
  <img src="public/favicon.svg" alt="Nomadex logo" width="72" />
</p>

<p align="center">
  Remote web UI for local coding agents.
</p>

<p align="center">
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/Node-20%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node 20+" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-f2c94c?style=flat-square" alt="MIT License" />
  </a>
  <img src="https://img.shields.io/badge/UI-Web%20%2B%20Mobile-1f7aec?style=flat-square" alt="Web and mobile UI" />
  <img src="https://img.shields.io/badge/Providers-Codex%20%7C%20OpenCode%20%7C%20Qwen%20Code-7b61ff?style=flat-square" alt="Providers" />
</p>

Nomadex is a browser workspace for running and supervising coding agents on your own machine.

The repo is built for the workflow where the real agent, repository, CLI tools, and credentials stay on your workstation, server, or home box, while the UI stays reachable from your laptop, tablet, or phone. You can open the session remotely, watch live output, inspect files and diffs, answer approvals, steer the current turn, and keep moving without living in one terminal window.

If you are looking for a Codex web UI, OpenCode web UI, or Qwen Code web UI that works well on mobile, that is the direction Nomadex is built for. The app layer is also being shaped to support future providers such as Claude Code and Antigravity without rebuilding the whole shell.

## 🖼️ Screenshots

### 🖥️ Desktop

![Nomadex desktop UI](docs/ui-desktop.png)

### 📱 Mobile

![Nomadex mobile UI](docs/ui-mobile.png)

## ✨ Why Nomadex

- Keep the actual execution environment local and under your control.
- Supervise long-running agent work from your phone or another machine.
- Stay in one threaded workspace for chat, plans, files, diffs, approvals, and terminal output.
- Avoid exposing a raw local CLI session directly just to monitor progress remotely.
- Use a UI that is shaped for remote, mobile, and browser-first workflows instead of a desktop-only shell.

## 🚀 Feature Highlights

| Area | What you get |
| --- | --- |
| Live sessions | Real-time threaded chat over the local app-server bridge |
| Mobile UX | Responsive workspace shell, tail-first transcript loading, and remote-friendly controls |
| Files and diffs | Explorer, editor, diff review, changed-file summaries, and local file browse routes |
| Composer | File attachments, image attachments, image paste, queueing, steer, and prompt tools |
| Runtime controls | Approvals, question prompts, rollback support, and in-progress visibility |
| Provider layer | Codex as the reference live path, plus OpenCode and Qwen Code integration work |
| Launch flow | Packaged `npx nomadexapp` launcher with app-server startup, password gate, and update check |

## 🤖 Providers

| Provider | Status | Notes |
| --- | --- | --- |
| Codex | Live | Main reference path through the local app-server bridge |
| OpenCode | Integrated | CLI-backed path with provider-aware model handling |
| Qwen Code | Integrated | CLI-backed path with local setup/auth flow support |
| Claude Code | Planned | Target provider for the shared shell architecture |
| Antigravity | Planned | Scaffolded direction, not yet a complete live runtime |

## ⚡ Quick Start

### 📦 Packaged launcher

```bash
npx nomadexapp
```

The packaged launcher:

1. serves the built Nomadex UI
2. checks whether a Codex app-server is already healthy on `ws://127.0.0.1:3901`
3. starts one if needed
4. binds the UI on `0.0.0.0:3784`
5. proxies the browser websocket through `/codex-ws`
6. prints a UI password and requires it before the browser can open the workspace
7. checks whether a newer npm release is available and prompts before startup when appropriate

Open:

- 🏠 Local machine: `http://127.0.0.1:3784`
- 🌐 Another device on the same network: `http://<your-lan-ip>:3784`

### 🛠️ Repo development

```bash
npm install
npm run dev:live
```

Use `dev:live` when you are developing Nomadex itself and want the Vite development workflow.

## 🌍 Remote Access

Preferred setup: ZeroTier.

Why:

- it keeps Nomadex on a private overlay network
- it is safer than exposing the local UI directly to the internet
- it works well for phone access from anywhere
- it matches the core model of keeping the real agent local to your machine

Recommended flow:

1. Install ZeroTier on the host machine and on your phone.
2. Join both devices to the same ZeroTier network.
3. Run `npx nomadexapp` on the host machine.
4. Open `http://<host-zerotier-ip>:3784` on the remote device.

Tailscale or SSH tunneling also work well. Avoid exposing the raw Nomadex port directly to the public internet without real network and auth controls in front of it.

## 🧰 Common Commands

```bash
npx nomadexapp
npm run dev:live
npm run app-server
npm run build
npm run preview
```

## 🏗️ Architecture

```text
Browser or phone
  -> Nomadex UI host
    -> same-origin websocket proxy
      -> local coding agent bridge
```

Main layers:

- `src/app/WorkspaceShell.tsx`: routing, shell state, active thread, overlays, and composer orchestration
- `src/app/WorkspaceView.tsx`: reusable workspace UI sections
- `src/app/components/*`: transcript, settings, terminal, summaries, approvals, and supporting cards
- `src/app/services/runtime/*`: websocket lifecycle, uploads, turn mutations, auth/setup flows, and local runtime actions
- `src/app/services/presentation/*`: render shaping for transcript items, attachments, file links, and summaries
- `src/app/services/providers/*`: provider-specific transport and path conventions

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 🎯 Use Cases

- Remote coding companion for a workstation you access over SSH
- Phone-friendly control panel for long-running local agent sessions
- Reviewing changed files and diffs before asking the agent to continue
- Sending steer prompts while away from your desk
- Handling approvals and question prompts from mobile
- Watching shell output and file edits on a private remote box or home lab machine

## 📌 Status

### ✅ Done

- [x] Live threaded workspace over the local websocket bridge
- [x] Mobile-friendly shell and long-thread transcript handling
- [x] File explorer, editor, diff review, and terminal surfaces
- [x] File and image attachments, including pasted images
- [x] Queueing, steer, approvals, and in-progress turn visibility
- [x] Theme picker, settings, skills library, and account/provider surfaces
- [x] Local workspace browsing and uploaded asset handling
- [x] Provider-aware launcher and app layer

### 🧭 Next

- [ ] Publish the first public npm release
- [ ] Harden the packaged launcher for more providers and remote auth flows
- [ ] Extend provider parity beyond the current Codex-first runtime path
- [ ] Improve durable cross-provider thread memory and reload persistence
- [ ] Tighten remote access hardening for internet-facing setups
- [ ] Keep improving performance on very long mobile sessions

## 📚 Documentation

- Setup and launch: [docs/SETUP.md](docs/SETUP.md)
- Architecture and extension points: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 🚢 Publishing

- `main` now has GitHub Actions for lint, build, and npm publish.
- The publish workflow only releases when the version in `package.json` is not already on npm.
- Add a repo secret named `NPM_TOKEN` before relying on automatic publish.
- To ship an update, bump the package version, push to `main`, and GitHub Actions will publish `nomadexapp` automatically.

## 🤝 Contributing

Contributions are welcome.

Useful areas:

- provider integrations
- launcher and packaging improvements
- remote access hardening
- mobile performance and long-thread rendering
- auth and session UX
- editor, diff, and terminal polish

Open an issue or PR with a focused change. Small, well-scoped improvements are much easier to review and land than broad refactors.

## 📝 Notes

- Uploaded assets currently land under `.codex-web/uploads` and `.codex-web/uploads/files`.
- Codex is still the strongest live provider path today.
- Set `NOMADEX_PASSWORD` if you want a stable password instead of the generated per-launch password.
- `npm run preview` is useful for checking the built shell in the repo, while `npx nomadexapp` is the packaged launcher flow.

## 🐛 Troubleshooting

- `UI port 3784 is already in use`
  Stop the old Nomadex process or choose a different port.
- `Port 3901 ... is already in use, but it is not responding like a Codex app-server`
  Another process is already on the websocket port. Stop it or point Nomadex to a different bridge.
- Browser still shows an old favicon or theme color
  Hard refresh, then fully close and reopen the tab once. Mobile browsers cache this aggressively.

For the full setup guide, see [docs/SETUP.md](docs/SETUP.md).
