# Architecture

Nomadex is structured as a provider-aware browser shell around a live local coding-agent bridge.

## Goals

- Keep the UI responsive on desktop and mobile
- Support long-running local agent sessions from a browser
- Separate UI rendering from transport/runtime concerns
- Leave room for additional providers beyond Codex

## Runtime Topology

Recommended local flow:

```text
Browser
  -> Nomadex UI (Vite on 3784)
    -> /codex-ws proxy
      -> Codex app-server (3901)
```

The UI talks to the local bridge through same-origin websocket proxying. Local file/image access and auth callback relay are also served through the UI host.

## Main App Layers

### Composition root

- `src/app/WorkspaceShell.tsx`

Responsibilities:

- route-to-panel mapping
- shell state
- thread selection
- overlay and sidebar behavior
- composer orchestration
- wiring services to presentational components

### View layer

- `src/app/WorkspaceView.tsx`
- `src/app/components/ChatTranscript.tsx`
- `src/app/components/SettingsPanels.tsx`
- `src/app/components/TerminalPanel.tsx`
- `src/app/components/FileChangeSummary.tsx`

Responsibilities:

- transcript rendering
- markdown display
- settings, theme, and skills UI
- terminal presentation
- explorer/editor/review surfaces

### Runtime service

- `src/app/services/runtime/WorkspaceRuntimeService.ts`

Responsibilities:

- websocket lifecycle
- request/response transport
- optimistic local state updates
- stream delta handling
- uploads
- skills/account/config requests
- thread and turn mutation flow

### Presentation service

- `src/app/services/presentation/workspacePresentationService.ts`

Responsibilities:

- map raw protocol items into UI display shapes
- parse message text, file attachments, markdown-related display concerns
- build local image and browse URLs
- summarize changed files and live overlays

### Provider layer

- `src/app/services/providers/*`

Responsibilities:

- provider-specific paths and conventions
- websocket proxy path
- auth callback path
- upload directories
- prompt heading and request marker parsing

Current registry state:

- provider abstraction exists
- active shipped provider: `codex`

## Data Flow

### Sending a prompt

1. Composer state is collected in `WorkspaceShell`
2. Runtime uploads files/images when needed
3. Mentions and attachments are normalized
4. Prompt text is built, including file manifest headings when applicable
5. `turn/start` or related runtime request is sent over the live bridge

### Receiving a response

1. App-server emits thread, turn, and item notifications
2. Runtime service merges them into the dashboard snapshot
3. Stream visibility and text effects are updated
4. Presentation helpers derive renderable transcript state
5. `ChatTranscript` renders streaming plain text and completed markdown output

## Mobile Performance Strategy

Current mobile optimizations include:

- tail-first transcript rendering for long threads
- explicit mounting rules for heavy overlays/panels
- virtualized file preview and terminal log surfaces
- scroll-state management for editor/review returns
- keeping the main workspace mounted behind some overlays to avoid costly remounts

This is still an actively tuned area of the codebase.

## Persistence

Persisted locally:

- selected UI theme in `localStorage`

Stored in workspace:

- uploads under `.codex-web/uploads`

Mostly in-memory UI state:

- panel visibility
- sidebar state
- queue state
- scroll restoration state
- transcript windowing state

## Important Boundaries

- Some names and paths still contain `codex` because they reflect the live provider contract.
- The UI is becoming provider-neutral faster than the transport layer, so branding and architecture are ahead of full multi-provider runtime support.
- If you want to add another provider, the provider adapter layer is the intended entry point, but runtime request/notification assumptions still need extension work.

## Suggested Extension Order

If you continue this codebase toward multi-provider support, the most practical order is:

1. add provider adapters and registry selection
2. split runtime operations into smaller domain services
3. isolate provider-specific request and notification mapping
4. persist queue/session UI state where needed
5. code-split heavy panels and modal surfaces
