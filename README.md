# ⚡ Codex Console

A standalone **React + TanStack** workspace for **Codex CLI**, built for desktop and mobile use with a live local Codex app-server bridge.

## 🖼️ Sample UI

### Desktop

![Desktop UI sample](docs/ui-desktop.svg)

### Mobile

![Mobile UI sample](docs/ui-mobile.svg)

## 🎯 Why This Exists

Codex CLI is powerful in the terminal, but there are workflows where a web shell is more practical:

- 📱 running Codex from a phone while the real agent keeps working on your machine
- 👀 monitoring live responses, approvals, terminals, and file changes without staying in one terminal tab
- 🧵 browsing thread history, reopening sessions, and following multi-turn work visually
- 🛠️ reviewing diffs, uploads, mentions, MCP state, and skills from one place
- 🌐 exposing the UI over LAN so the same Codex session is reachable from other devices

## ✨ What It Includes

- 💬 threaded Codex conversations
- ⚡ live streaming responses
- 🧠 steer / queue flows during active turns
- 📎 inline file mentions plus file/image upload
- 🗂️ file explorer and inline code preview
- 🔍 diff review and code review surfaces
- ⛓️ MCP server state and auth flows
- 🧰 skills, feature flags, and settings panels
- 🖥️ background terminals and command output
- 🤖 subagent visibility and thread switching
- 📲 mobile-first layout with desktop shell parity

## 🧪 Main Use Cases

### 1. Mobile companion for Codex

Keep Codex running on your workstation and use the browser UI on your phone to:

- send prompts
- watch streams live
- approve actions
- inspect diffs

### 2. Persistent thread workspace

Open saved sessions again, continue them, and keep operational context visible:

- current model
- approval mode
- terminal activity
- review state

### 3. Review and supervision layer

Use the UI as a control plane while Codex edits code:

- watch file changes
- inspect patches
- reopen older threads
- steer the current turn

## 🚀 Run Locally

From the project root:

```bash
npm install
npm run dev:live
```

That launcher will:

1. reuse a Codex app-server already listening on `ws://127.0.0.1:3901`, or start one if needed
2. start the UI on `http://127.0.0.1:3784`
3. proxy the browser websocket bridge through the same origin

## 🌐 LAN Access

By default the dev launcher is configured for LAN/mobile access through the Vite host, so the UI can be opened from another device on the same network.

If you need custom ports or a custom websocket target:

```bash
VITE_CODEX_WS_URL=ws://127.0.0.1:3902 VITE_CODEX_UI_PORT=4173 npm run dev:live
```

## 🧱 Stack

- React 19
- TanStack Router
- TanStack Query
- Vite
- local Codex app-server websocket bridge

## 🛠️ Other Commands

```bash
npm run build
npm run preview
npm run app-server
```

## 📌 Notes

- If the Codex app-server is unavailable, the UI can fall back to a local mock shell so the interface still opens.
- The sample images in this README are representative artwork of the shipped UI shell.
- Remote skill marketplace behavior depends on the connected Codex account and server access.
