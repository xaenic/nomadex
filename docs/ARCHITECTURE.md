# Architecture

Nomadex is a provider-aware browser shell around a local coding-agent runtime.

The important design choice is that the agent stays on your machine. Nomadex is the remote control surface, not the execution environment.

## Goals

- keep the real agent, repo, and credentials local to the host machine
- provide a responsive browser UI for desktop and mobile
- make remote supervision practical from a phone or secondary device
- separate rendering, runtime, and provider concerns
- leave room for multiple providers without rewriting the shell

## Runtime Topology

Recommended live flow:

```text
Remote browser or phone
  -> Nomadex UI host
    -> same-origin websocket proxy
      -> local coding agent bridge on the host machine
```

Current reference path:

```text
Browser
  -> Nomadex UI host (3784)
    -> /codex-ws proxy
      -> Codex app-server (3901)
```

The browser does not talk to the agent bridge directly. It talks to the Nomadex host, which:

- proxies websocket traffic
- serves local image and file browse routes
- relays auth callback routes

That same-origin model is what makes the mobile and remote access story simpler.

## Main Layers

### Composition root

- `src/app/WorkspaceShell.tsx`

Responsibilities:

- route-to-panel mapping
- shell state and active thread selection
- sidebar and overlay behavior
- composer orchestration
- bridging snapshot/actions into the view layer

### View layer

- `src/app/WorkspaceView.tsx`
- `src/app/components/ChatTranscript.tsx`
- `src/app/components/SettingsPanels.tsx`
- `src/app/components/TerminalPanel.tsx`
- `src/app/components/FileChangeSummary.tsx`

Responsibilities:

- transcript rendering
- markdown and structured prompt rendering
- settings, theme, and skills UI
- terminal and file/editor surfaces
- diff, file-change, and summary views

### Runtime service

- `src/app/services/runtime/WorkspaceRuntimeService.ts`

Responsibilities:

- websocket lifecycle
- request/response transport
- optimistic local state updates
- stream delta handling
- uploads
- thread and turn mutation flow
- provider setup and auth flows

### Presentation service

- `src/app/services/presentation/workspacePresentationService.ts`

Responsibilities:

- shape raw protocol data for rendering
- parse message text and attachments
- build file/image/browse display links
- summarize changed files, graph rows, and transcript overlays

### Provider layer

- `src/app/services/providers/*`

Responsibilities:

- provider identifiers and metadata
- transport conventions
- websocket/auth/local-asset path conventions
- upload root conventions
- request headings and parsing markers

## Data Flow

### Sending a prompt

1. The composer state is collected in `WorkspaceShell`.
2. Runtime uploads files and images when needed.
3. Mentions and attachments are normalized.
4. Prompt text is built, including shared thread memory when needed.
5. The runtime sends `turn/start` or the relevant provider-specific action.

### Receiving a response

1. The bridge emits thread, turn, and item notifications.
2. The runtime merges those events into the dashboard snapshot.
3. Stream visibility and optimistic state are updated.
4. Presentation helpers derive renderable transcript state.
5. `ChatTranscript` renders streaming and completed output.

### Steering an active turn

1. The user applies steer from the UI.
2. Nomadex creates an immediate local steer-history entry for the active turn.
3. The runtime sends `turn/steer` to the bridge.
4. Successful steer entries persist in app-owned thread state and local storage so they survive reloads even though the current backend does not emit a dedicated steer history event.

## Remote-First Design

Nomadex is designed around remote supervision rather than a traditional local-only IDE shell.

That affects the architecture in a few ways:

- the UI must stay usable on mobile
- the browser cannot depend on direct filesystem access
- local file and image access must be resolved through the host
- long-running turns need visible intermediate state
- queueing, steer, approvals, and transcript continuity matter more than “single screen IDE” behavior

## Mobile Performance Strategy

Current mobile-oriented optimizations include:

- tail-first transcript rendering for long threads
- selective mounting of heavy panels and overlays
- virtualized file preview and terminal log surfaces
- scroll-state management for file/editor returns
- keeping the main workspace stable where remount cost is too high

This area is still being tuned.

## Persistence

Persisted locally:

- selected UI theme in `localStorage`
- selected provider in `localStorage`
- app-owned steer history entries per thread in `localStorage`

Stored in workspace:

- uploads under provider-specific upload folders such as `.codex-web/uploads`

Mostly in-memory UI state:

- panel visibility
- sidebar state
- queue state
- scroll restoration state
- transcript windowing state

## Current Boundaries

- Codex is still the most complete live provider path.
- The UI is more provider-neutral than the transport layer.
- Some names and paths still contain `codex` because they match the active bridge contract.
- The packaged `nomadexapp` launcher now exists, but Codex is still the reference bridge contract it assumes by default.

## Extension Direction

The most practical order for continuing the codebase is:

1. harden the packaged launcher for more providers and remote auth flows
2. split the runtime into smaller domain services
3. keep isolating provider-specific request and notification logic
4. strengthen durable thread-memory and session persistence
5. add stronger access control for remote and internet-facing setups
