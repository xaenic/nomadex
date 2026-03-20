import {
  createContext,
  memo,
  startTransition,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PropsWithChildren,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import clsx from "clsx";

import type { Thread, ThreadItem, Turn } from "../protocol/v2";
import { CodexLiveRuntime } from "./codexLive";
import {
  deriveLiveOverlay,
  getUserMessageDisplay,
  parseInlineSegments,
  parseMessageBlocks,
  toBrowseUrl,
  toRenderableImageUrl,
  type UiLiveOverlay,
} from "./codexUiBridge";
import {
  createBlankThreadRecord,
  createFallbackDashboardData,
  createSimulatedTurn,
  type ComposerFile,
  type ComposerImage,
  type DashboardData,
  type MentionAttachment,
  type SettingsState,
  type SkillCard,
  type StreamSpec,
  type ThreadRecord,
  type WorkspaceMode,
} from "./mockData";

type UiApprovalMode = "auto" | "ro" | "fa";
type PanelTab = "files" | "diff" | "terminal" | "agents" | "config";
type QuickMode = "slash" | "mention" | "skill";
type RouteSection = "chat" | "ops" | "agents" | "review" | "skills" | "mcp" | "settings";
type ToastTone = "" | "ok" | "warn" | "err";

type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ComposerPayload = {
  prompt: string;
  mentions: Array<MentionAttachment>;
  skills: Array<SkillCard>;
  images: Array<ComposerImage>;
  files: Array<ComposerFile>;
};

type QueuedComposerMessage = ComposerPayload & {
  id: string;
  mode: WorkspaceMode;
};

type WorkspaceActions = {
  createThread: (settings: SettingsState, title?: string) => Promise<string>;
  resumeThread: (threadId: string) => Promise<void>;
  interruptTurn: (threadId: string) => Promise<boolean>;
  sendComposer: (args: ComposerPayload & {
    threadId: string;
    mode: WorkspaceMode;
    settings: SettingsState;
  }) => Promise<void>;
  applySteer: (args: ComposerPayload & { threadId: string }) => Promise<boolean>;
  searchMentions: (cwd: string, query: string) => Promise<void>;
  loadDirectory: (cwd: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  updateSettings: (patch: Partial<SettingsState>) => Promise<void>;
  toggleFeatureFlag: (name: string) => Promise<void>;
  toggleInstalledSkill: (skillId: string) => Promise<void>;
  installSkill: (skillId: string) => Promise<void>;
  toggleMcpAuth: (serverName: string) => Promise<void>;
  cleanTerminals: (threadId: string) => Promise<void>;
  resolveApproval: (requestId: string, approved: boolean) => Promise<void>;
  submitQuestion: (requestId: string, answers: string[]) => Promise<void>;
  submitMcp: (requestId: string, action: "accept" | "decline" | "cancel", contentText: string) => Promise<void>;
  forkThread: (threadId: string) => Promise<string>;
  compactThread: (threadId: string) => Promise<void>;
};

type WorkspaceContextValue = {
  snapshot: DashboardData;
  actions: WorkspaceActions;
};

type ParsedRoute = {
  threadId: string | null;
  section: RouteSection;
};

type QuickEntry = {
  id: string;
  label: string;
  description: string;
  mode: QuickMode;
  value: string;
};

type FilePreviewState = {
  path: string;
  name: string;
  content: string;
  loading: boolean;
  error: string | null;
};

type FileChangeItem = Extract<ThreadItem, { type: "fileChange" }>;
type FileChangeDiff = FileChangeItem["changes"][number];
type DiffReviewEntry = {
  id: string;
  itemId: string;
  path: string;
  diff: string;
  kind: FileChangeDiff["kind"];
  status: FileChangeItem["status"];
  additions: number;
  removals: number;
  hunks: number;
};

type DiffReviewLine = {
  id: string;
  kind: "meta" | "hunk" | "add" | "rem" | "ctx";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

type ComposerHighlightSegment = {
  text: string;
  mention: MentionAttachment | null;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const FALLBACK_DATA = createFallbackDashboardData();
const ALL_MENTIONS = FALLBACK_DATA.mentionCatalog;
const APPROVAL_ORDER: Array<UiApprovalMode> = ["auto", "ro", "fa"];
const APPROVAL_LABELS: Record<UiApprovalMode, string> = {
  auto: "Auto",
  ro: "Read-only",
  fa: "Full Access",
};
const APPROVAL_CLASS: Record<UiApprovalMode, string> = {
  auto: "auto",
  ro: "ro",
  fa: "fa",
};
const PANEL_TITLE: Record<PanelTab, string> = {
  files: "Files",
  diff: "Diff",
  terminal: "Terminal",
  agents: "Agents",
  config: "Config",
};
const QUICK_HINTS = {
  slash:
    "Ask Codex… / for slash commands · @ mention · $ skills · ! shell · Ctrl+G editor",
  mention: "Attach a file or folder to the conversation",
  skill: "Attach an installed or marketplace skill",
};
const SLASH_COMMANDS: Array<{ cmd: string; dsc: string }> = [
  { cmd: "/permissions", dsc: "Switch Auto, Read-only, or Full Access approval mode" },
  { cmd: "/apps", dsc: "Browse connectors and insert $app-slug into the prompt" },
  { cmd: "/compact", dsc: "Summarize the conversation and free context" },
  { cmd: "/diff", dsc: "Open the git diff view in the right panel" },
  { cmd: "/exit", dsc: "End the current session" },
  { cmd: "/feedback", dsc: "Send logs and feedback to maintainers" },
  { cmd: "/fork", dsc: "Fork the current session into a new thread" },
  { cmd: "/init", dsc: "Generate AGENTS.md in the workspace" },
  { cmd: "/logout", dsc: "Sign out of Codex" },
  { cmd: "/mcp", dsc: "Open Model Context Protocol server controls" },
  { cmd: "/mention", dsc: "Attach a file or folder to the current message" },
  { cmd: "/model", dsc: "Choose the active model and effort" },
  { cmd: "/new", dsc: "Start a fresh conversation" },
  { cmd: "/plan", dsc: "Switch to plan-first collaboration mode" },
  { cmd: "/personality", dsc: "Choose the assistant communication style" },
  { cmd: "/ps", dsc: "Open background terminal sessions" },
  { cmd: "/quit", dsc: "End the current session" },
  { cmd: "/resume", dsc: "Resume a saved session" },
  { cmd: "/review", dsc: "Run a review pass against the working tree" },
  { cmd: "/clear", dsc: "Clear the current conversation view" },
  { cmd: "/copy", dsc: "Copy the latest Codex response" },
  { cmd: "/skills", dsc: "Open installed and marketplace skills" },
  { cmd: "/status", dsc: "Show model, tokens, approvals, git, and MCP state" },
  { cmd: "/theme", dsc: "Preview and save UI theme variants" },
  { cmd: "/experimental", dsc: "Toggle experimental feature flags" },
];

const nextId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const isDesktopViewport = () => (typeof window === "undefined" ? true : window.innerWidth >= 768);

const sortThreads = (threads: Array<ThreadRecord>) => [...threads].sort((a, b) => b.thread.updatedAt - a.thread.updatedAt);
const sortTurnsById = (turns: Array<Turn>) => [...turns].sort((left, right) => left.id.localeCompare(right.id));

const approvalModeFromSettings = (settings: SettingsState): UiApprovalMode => {
  if (settings.approvalPolicy === "untrusted") {
    return "ro";
  }

  if (settings.approvalPolicy === "never") {
    return "fa";
  }

  return "auto";
};

const settingsPatchFromApprovalMode = (mode: UiApprovalMode): Partial<SettingsState> => {
  if (mode === "ro") {
    return {
      approvalPolicy: "untrusted",
      sandboxMode: "read-only",
    };
  }

  if (mode === "fa") {
    return {
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
    };
  }

  return {
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
  };
};

const sectionToPanel = (section: RouteSection): PanelTab | null => {
  switch (section) {
    case "ops":
      return "files";
    case "agents":
      return "agents";
    case "review":
      return "diff";
    case "skills":
    case "mcp":
    case "settings":
      return "config";
    default:
      return null;
  }
};

const panelToSection = (tab: PanelTab): RouteSection => {
  switch (tab) {
    case "files":
    case "terminal":
      return "ops";
    case "agents":
      return "agents";
    case "diff":
      return "review";
    case "config":
      return "settings";
  }
};

const statusTone = (status: DashboardData["transport"]["status"]) => {
  if (status === "connected") {
    return "gn";
  }

  if (status === "error") {
    return "rd";
  }

  return "yw";
};

const parseRoute = (pathname: string): ParsedRoute => {
  const parts = pathname.split("/").filter(Boolean);

  if (parts[0] === "thread" && parts[1]) {
    return {
      threadId: parts[1],
      section: "chat",
    };
  }

  if (parts[0] === "threads" && parts[1] && parts[2]) {
    return {
      threadId: parts[1],
      section: parts[2] as RouteSection,
    };
  }

  if (parts[0] === "threads" && parts[1]) {
    return {
      threadId: parts[1],
      section: "chat",
    };
  }

  return {
    threadId: null,
    section: "chat",
  };
};

const threadDayGroup = (updatedAt: number) => {
  const updated = new Date(updatedAt * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const value = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate());
  const days = Math.round((today.getTime() - value.getTime()) / 86400000);

  if (days <= 0) {
    return "Today";
  }

  if (days === 1) {
    return "Yesterday";
  }

  return "Earlier";
};

const threadLabel = (thread: Thread) => thread.name ?? thread.preview ?? "Untitled Session";

const formatClock = (value: number) =>
  new Date(value * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

const shorten = (value: string, max = 76) => (value.length <= max ? value : `${value.slice(0, max - 3)}...`);
const formatUploadSize = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
const localUploadedFilesToMentions = (cwd: string, files: Array<ComposerFile>): Array<MentionAttachment> =>
  files.map((file) => ({
    id: `upload-${file.id}`,
    name: file.name,
    path: `${cwd}/.codex-web/uploads/${file.name}`,
    kind: "file",
  }));

const OMIT_DIRECTORY_NAMES = new Set([".git", "node_modules"]);

const sortMentionAttachments = (entries: Array<MentionAttachment>) =>
  [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

const deriveLocalDirectoryCatalog = (cwd: string): Array<MentionAttachment> => {
  const prefix = `${cwd.replace(/\/+$/u, "")}/`;
  const entries = new Map<string, MentionAttachment>();

  ALL_MENTIONS.forEach((entry) => {
    if (!entry.path.startsWith(prefix)) {
      return;
    }

    const relative = entry.path.slice(prefix.length);
    if (!relative) {
      return;
    }

    const [head, ...rest] = relative.split("/");
    if (!head || OMIT_DIRECTORY_NAMES.has(head)) {
      return;
    }

    if (rest.length === 0) {
      entries.set(head, {
        ...entry,
        id: `${cwd}:${head}`,
        name: head,
      });
      return;
    }

    if (!entries.has(head)) {
      entries.set(head, {
        id: `${cwd}:${head}`,
        name: head,
        path: `${prefix}${head}`,
        kind: "directory",
      });
    }
  });

  return sortMentionAttachments([...entries.values()]);
};

const isPathWithinRoot = (root: string, value: string) => {
  const normalizedRoot = root.replace(/\/+$/u, "");
  return value === normalizedRoot || value.startsWith(`${normalizedRoot}/`);
};

const getUserText = (item: Extract<ThreadItem, { type: "userMessage" }>) => getUserMessageDisplay(item).text;

const latestThreadLabel = (record: ThreadRecord) => {
  if (record.thread.name?.trim()) {
    return record.thread.name.trim();
  }

  const turns = sortTurnsById(record.thread.turns);
  for (const turn of [...turns].reverse()) {
    for (const item of [...turn.items].reverse()) {
      if (item.type === "userMessage") {
        const text = getUserText(item).trim();
        if (text) {
          return text;
        }
      }

      if (item.type === "agentMessage") {
        const text = item.text.trim();
        if (text) {
          return text;
        }
      }
    }
  }

  return threadLabel(record.thread);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const mentionInlineLabel = (mention: MentionAttachment) => {
  const baseName = mention.name.split("/").filter(Boolean).at(-1) ?? mention.name;
  return baseName.replace(/\s+/gu, "-");
};

const mentionInlineToken = (mention: MentionAttachment) => `@${mentionInlineLabel(mention)}`;

const composerHasMentionToken = (value: string, mention: MentionAttachment) => {
  const token = mentionInlineToken(mention);
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(token)}(?=$|\\s|[.,!?;:])`, "u");
  return pattern.test(value);
};

const insertInlineMentionToken = (value: string, mention: MentionAttachment) => {
  const token = mentionInlineToken(mention);
  const tokenQueryPattern = /(?:^|\s)@[^\s]*$/u;
  const hasTokenAlready = composerHasMentionToken(value, mention);

  if (tokenQueryPattern.test(value)) {
    return value.replace(tokenQueryPattern, (match) => `${match.startsWith(" ") ? " " : ""}${token} `);
  }

  if (hasTokenAlready) {
    return value;
  }

  const spacer = value && !/\s$/u.test(value) ? " " : "";
  return `${value}${spacer}${token} `;
};

const buildComposerHighlightSegments = (value: string, mentions: Array<MentionAttachment>) => {
  if (!value) {
    return [] as Array<ComposerHighlightSegment>;
  }

  const tokenMap = new Map(mentions.map((mention) => [mentionInlineToken(mention), mention]));
  const segments: Array<ComposerHighlightSegment> = [];
  const tokenPattern = /@[\w./-]+/gu;
  let cursor = 0;

  for (const match of value.matchAll(tokenPattern)) {
    const token = match[0];
    const mention = tokenMap.get(token) ?? null;
    const index = match.index ?? 0;

    if (index > cursor) {
      segments.push({
        text: value.slice(cursor, index),
        mention: null,
      });
    }

    segments.push({
      text: token,
      mention,
    });
    cursor = index + token.length;
  }

  if (cursor < value.length) {
    segments.push({
      text: value.slice(cursor),
      mention: null,
    });
  }

  return segments;
};

const attachmentDisplayLabel = (label: string, path: string) => {
  const trimmedLabel = label.trim();
  if (trimmedLabel && !trimmedLabel.startsWith("/") && !trimmedLabel.includes("\\")) {
    return `@${trimmedLabel}`;
  }

  return `@${path.replace(/\\/gu, "/").split("/").filter(Boolean).pop() ?? path}`;
};

const isExistingThreadHistoryPending = (record: ThreadRecord | null, turns: Array<Turn>) => {
  if (!record) {
    return false;
  }

  if (turns.length > 0) {
    return false;
  }

  const threadName = record.thread.name?.trim();
  if (threadName && threadName !== "New Session" && threadName !== "New Thread" && threadName !== "Untitled Session") {
    return true;
  }

  return Boolean(record.thread.preview?.trim());
};

const diffEntryId = (itemId: string, changeIndex: number, path: string) => `${itemId}:${changeIndex}:${path}`;

const normalizeDiffPath = (value: string) => value.replace(/^\.?\//u, "").replace(/\\/gu, "/");

const diffKindLabel = (kind: FileChangeDiff["kind"]) => {
  if (kind.type === "add") {
    return "new";
  }

  if (kind.type === "delete") {
    return "deleted";
  }

  if (kind.move_path) {
    return "renamed";
  }

  return "modified";
};

const countDiffStats = (diff: string) => {
  if (!diff.trim()) {
    return {
      additions: 0,
      removals: 0,
      hunks: 0,
    };
  }

  return diff.split("\n").reduce(
    (stats, line) => {
      if (line.startsWith("@@")) {
        stats.hunks += 1;
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        stats.additions += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        stats.removals += 1;
      }

      return stats;
    },
    { additions: 0, removals: 0, hunks: 0 },
  );
};

const buildDiffReviewLines = (diff: string) => {
  if (!diff.trim()) {
    return [] as Array<DiffReviewLine>;
  }

  const rows: Array<DiffReviewLine> = [];
  let oldLine = 0;
  let newLine = 0;

  diff.split("\n").forEach((line, index) => {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      rows.push({
        id: `hunk-${index}`,
        kind: "hunk",
        text: line,
        oldLine: null,
        newLine: null,
      });
      return;
    }

    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ")
    ) {
      rows.push({
        id: `meta-${index}`,
        kind: "meta",
        text: line,
        oldLine: null,
        newLine: null,
      });
      return;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      rows.push({
        id: `add-${index}`,
        kind: "add",
        text: line,
        oldLine: null,
        newLine,
      });
      newLine += 1;
      return;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      rows.push({
        id: `rem-${index}`,
        kind: "rem",
        text: line,
        oldLine,
        newLine: null,
      });
      oldLine += 1;
      return;
    }

    rows.push({
      id: `ctx-${index}`,
      kind: "ctx",
      text: line,
      oldLine,
      newLine,
    });
    oldLine += 1;
    newLine += 1;
  });

  return rows;
};

const getStreamTarget = (entry: StreamSpec) => (entry.visible === 0 ? entry.total : entry.visible);

const stopStreamsForThreadTurn = (draft: DashboardData, threadId: string, turnId: string) => {
  draft.streams = draft.streams.map((entry) =>
    entry.threadId === threadId && entry.turnId === turnId
      ? {
          ...entry,
          total: entry.visible,
        }
      : entry,
  );
};

const copyText = async (value: string) => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
};

const useWorkspace = () => {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("Codex workspace context is missing.");
  }

  return value;
};

export function CodexWorkspaceProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<DashboardData>(createFallbackDashboardData());
  const snapshotRef = useRef(snapshot);
  const runtimeRef = useRef<CodexLiveRuntime | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const mutateLocal = useCallback((mutator: (draft: DashboardData) => void) => {
    setSnapshot((current) => {
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const runtime = new CodexLiveRuntime(createFallbackDashboardData());
    runtimeRef.current = runtime;

    const unsubscribe = runtime.subscribe((next) => {
      setSnapshot(next);
    });

    const reconnect = () => {
      const current = snapshotRef.current.transport;
      if (current.mode === "live" && current.status === "connected") {
        return;
      }

      void runtime.connect().catch(() => undefined);
    };

    reconnect();

    const reconnectTimer = window.setInterval(() => {
      reconnect();
    }, 5000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reconnect();
      }
    };

    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      unsubscribe();
      window.clearInterval(reconnectTimer);
      window.removeEventListener("focus", reconnect);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      runtime.disconnect();
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
    };
  }, []);

  const withLiveFallback = useCallback(
    async <T,>(live: () => Promise<T>, fallback: () => Promise<T> | T) => {
      const current = snapshotRef.current;
      const runtime = runtimeRef.current;
      const liveReady = runtime && current.transport.mode === "live" && current.transport.status === "connected";

      if (liveReady) {
        try {
          return await live();
        } catch {
          return await fallback();
        }
      }

      return await fallback();
    },
    [],
  );

  const createThreadLocal = useCallback(
    async (settings: SettingsState, title?: string) => {
      const threadId = nextId("thread");
      const record = createBlankThreadRecord(threadId, title ?? "New Session", settings);

      mutateLocal((draft) => {
        draft.threads = sortThreads([record, ...draft.threads.filter((entry) => entry.thread.id !== threadId)]);
      });

      return threadId;
    },
    [mutateLocal],
  );

  const sendComposerLocal = useCallback(
    async ({
      threadId,
      mode,
      prompt,
      mentions,
      skills,
      images,
      files,
      settings,
    }: {
      threadId: string;
      mode: WorkspaceMode;
      prompt: string;
      mentions: Array<MentionAttachment>;
      skills: Array<SkillCard>;
      images: Array<ComposerImage>;
      files: Array<ComposerFile>;
      settings: SettingsState;
    }) => {
      const threadCwd = snapshotRef.current.threads.find((entry) => entry.thread.id === threadId)?.thread.cwd ?? "/home/allan/codex-cli-ui";
      const result = createSimulatedTurn({
        threadId,
        prompt,
        mode,
        settings,
        mentions: [...mentions, ...localUploadedFilesToMentions(threadCwd, files)],
        skills,
        images,
        steer: null,
      });

      mutateLocal((draft) => {
        draft.threads = sortThreads(
          draft.threads.map((record) => {
            if (record.thread.id !== threadId) {
              return record;
            }

            return {
              ...record,
              thread: {
                ...record.thread,
                preview: prompt || record.thread.preview,
                updatedAt: Math.floor(Date.now() / 1000),
                status: { type: "active", activeFlags: [] },
                turns: [...record.thread.turns, result.turn],
              },
              plan: result.plan,
              review: mode === "review" ? result.review : record.review,
              terminals: [...result.terminals, ...record.terminals].slice(0, 6),
              tokenUsage: {
                input: record.tokenUsage.input + Math.max(prompt.length * 2, 128),
                output: record.tokenUsage.output,
                cached: record.tokenUsage.cached,
              },
            };
          }),
        );

        draft.streams = [
          ...draft.streams.filter((entry) => entry.threadId !== threadId),
          ...result.streams,
        ];
      });

      const completionTimer = window.setTimeout(() => {
        mutateLocal((draft) => {
          draft.threads = sortThreads(
            draft.threads.map((record) => {
              if (record.thread.id !== threadId) {
                return record;
              }

              return {
                ...record,
                thread: {
                  ...record.thread,
                  updatedAt: Math.floor(Date.now() / 1000),
                  status: { type: "idle" },
                  turns: record.thread.turns.map((turn) => {
                    if (turn.id !== result.turn.id) {
                      return turn;
                    }

                    return {
                      ...turn,
                      status: "completed",
                      items: turn.items.map((item) => {
                        if (item.type === "commandExecution") {
                          return {
                            ...item,
                            status: "completed",
                            exitCode: 0,
                            durationMs: 1840,
                          };
                        }

                        if (item.type === "collabAgentToolCall") {
                          const nextStates = Object.fromEntries(
                            Object.entries(item.agentsStates).map(([id, state]) => [
                              id,
                              {
                                ...state,
                                status: "completed",
                                message: state?.message ?? "Completed.",
                              },
                            ]),
                          );

                          return {
                            ...item,
                            status: "completed",
                            agentsStates: nextStates,
                          };
                        }

                        return item;
                      }),
                    } as Turn;
                  }),
                },
                review: mode === "review" ? result.review : record.review,
                terminals: record.terminals.map((terminal) =>
                  result.terminals.some((entry) => entry.id === terminal.id)
                    ? {
                        ...terminal,
                        status: "idle",
                        lastEvent: "just now",
                      }
                    : terminal,
                ),
                tokenUsage: {
                  input: record.tokenUsage.input,
                  output: record.tokenUsage.output + 512,
                  cached: record.tokenUsage.cached + 96,
                },
              };
            }),
          );

          draft.streams = draft.streams.map((stream) =>
            stream.threadId === threadId && stream.turnId === result.turn.id
              ? {
                  ...stream,
                  visible: stream.total,
                }
              : stream,
          );
        });
      }, 2800);

      timersRef.current.push(completionTimer);
    },
    [mutateLocal],
  );

  const actions = useMemo<WorkspaceActions>(
    () => ({
      createThread: async (settings, title) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.createThread(settings);
          },
          async () => await createThreadLocal(settings, title),
        ),
      resumeThread: async (threadId) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.resumeThread(threadId).catch(() => undefined);
            await runtime.ensureThreadLoaded(threadId).catch(() => undefined);
          },
          async () => undefined,
        ),
      interruptTurn: async (threadId) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.interruptTurn(threadId);
          },
          async () => {
            let interrupted = false;

            mutateLocal((draft) => {
              draft.threads = sortThreads(
                draft.threads.map((record) => {
                  if (record.thread.id !== threadId) {
                    return record;
                  }

                  const activeTurn = [...record.thread.turns].reverse().find((turn) => turn.status === "inProgress");
                  if (!activeTurn) {
                    return record;
                  }

                  interrupted = true;
                  stopStreamsForThreadTurn(draft, threadId, activeTurn.id);

                  return {
                    ...record,
                    thread: {
                      ...record.thread,
                      status: { type: "idle" },
                      turns: record.thread.turns.map((turn) =>
                        turn.id === activeTurn.id
                          ? {
                              ...turn,
                              status: "interrupted",
                            }
                          : turn,
                      ),
                    },
                  };
                }),
              );
            });

            return interrupted;
          },
        ),
      sendComposer: async (args) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.sendComposer(args);
          },
          async () => {
            await sendComposerLocal(args);
          },
        ),
      applySteer: async (args) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.applySteer(args);
          },
          async () => {
            let applied = false;

            mutateLocal((draft) => {
              draft.threads = draft.threads.map((record) => {
                if (record.thread.id !== args.threadId) {
                  return record;
                }

                const activeTurn = [...record.thread.turns].reverse().find((turn) => turn.status === "inProgress");
                if (!activeTurn) {
                  return record;
                }

                applied = true;

                return {
                  ...record,
                  plan: record.plan
                    ? {
                        ...record.plan,
                        explanation: `Steer applied: ${args.prompt}`,
                      }
                    : {
                        explanation: `Steer applied: ${args.prompt}`,
                        steps: [],
                      },
                  thread: {
                    ...record.thread,
                    turns: record.thread.turns.map((turn) => {
                      if (turn.id !== activeTurn.id) {
                        return turn;
                      }

                      return {
                        ...turn,
                        items: turn.items.map((item) =>
                          item.type === "agentMessage"
                            ? {
                                ...item,
                                text: `Steer applied: ${args.prompt}\n\n${item.text}`,
                              }
                            : item,
                        ),
                      };
                    }),
                  },
                };
              });
            });

            return applied;
          },
        ),
      searchMentions: async (cwd, query) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.searchMentions(cwd, query);
          },
          async () => {
            mutateLocal((draft) => {
              const needle = query.trim().toLowerCase();
              const prefix = `${cwd.replace(/\/+$/u, "")}/`;
              draft.mentionCatalog = ALL_MENTIONS.filter((entry) => entry.path.startsWith(prefix))
                .filter((entry) => (needle ? `${entry.name} ${entry.path}`.toLowerCase().includes(needle) : true))
                .slice(0, 18);
            });
          },
        ),
      loadDirectory: async (cwd) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.loadDirectory(cwd);
          },
          async () => {
            mutateLocal((draft) => {
              draft.directoryCatalogRoot = cwd;
              draft.directoryCatalog = deriveLocalDirectoryCatalog(cwd);
            });
          },
        ),
      readFile: async (path) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.readFile(path);
          },
          async () => {
            const href = toBrowseUrl(path);
            if (href === "#") {
              throw new Error("File preview is unavailable for this path.");
            }

            const response = await fetch(href);
            if (!response.ok) {
              throw new Error(`Failed to read ${path}`);
            }

            return await response.text();
          },
        ),
      updateSettings: async (patch) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.updateSettings(patch);
          },
          async () => {
            mutateLocal((draft) => {
              draft.settings = {
                ...draft.settings,
                ...patch,
              };
              draft.lastSavedAt = "just now";
            });
          },
        ),
      toggleFeatureFlag: async (name) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.toggleFeatureFlag(name);
          },
          async () => {
            mutateLocal((draft) => {
              draft.featureFlags = draft.featureFlags.map((entry) =>
                entry.name === name
                  ? {
                      ...entry,
                      enabled: !entry.enabled,
                    }
                  : entry,
              );
              draft.lastSavedAt = "just now";
            });
          },
        ),
      toggleInstalledSkill: async (skillId) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.toggleInstalledSkill(skillId);
          },
          async () => {
            mutateLocal((draft) => {
              draft.installedSkills = draft.installedSkills.map((entry) =>
                entry.id === skillId
                  ? {
                      ...entry,
                      enabled: !entry.enabled,
                    }
                  : entry,
              );
            });
          },
        ),
      installSkill: async (skillId) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.installSkill(skillId);
          },
          async () => {
            mutateLocal((draft) => {
              const target = draft.remoteSkills.find((entry) => entry.id === skillId);
              if (!target) {
                return;
              }

              draft.installedSkills = [
                {
                  ...target,
                  path: `/home/allan/.codex/skills/${target.name}/SKILL.md`,
                  enabled: true,
                  source: "installed",
                },
                ...draft.installedSkills,
              ];
              draft.remoteSkills = draft.remoteSkills.filter((entry) => entry.id !== skillId);
            });
          },
        ),
      toggleMcpAuth: async (serverName) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.toggleMcpAuth(serverName);
          },
          async () => {
            mutateLocal((draft) => {
              draft.mcpServers = draft.mcpServers.map((entry) =>
                entry.name === serverName
                  ? {
                      ...entry,
                      authStatus: entry.authStatus === "notLoggedIn" ? "oAuth" : entry.authStatus,
                    }
                  : entry,
              );
            });
          },
        ),
      cleanTerminals: async (threadId) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.cleanTerminals(threadId);
          },
          async () => {
            mutateLocal((draft) => {
              draft.threads = draft.threads.map((record) =>
                record.thread.id === threadId
                  ? {
                      ...record,
                      terminals: record.terminals.filter((terminal) => terminal.status === "running"),
                    }
                  : record,
              );
            });
          },
        ),
      resolveApproval: async (requestId, approved) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.resolveApproval(requestId, approved);
          },
          async () => {
            mutateLocal((draft) => {
              draft.threads = draft.threads.map((record) => ({
                ...record,
                approvals: record.approvals.map((approval) =>
                  approval.id === requestId
                    ? {
                        ...approval,
                        state: approved ? "approved" : "declined",
                      }
                    : approval,
                ),
              }));
            });
          },
        ),
      submitQuestion: async (requestId, answers) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.submitQuestion(requestId, answers);
          },
          async () => {
            mutateLocal((draft) => {
              draft.threads = draft.threads.map((record) => ({
                ...record,
                approvals: record.approvals.map((approval) =>
                  approval.id === requestId
                    ? {
                        ...approval,
                        state: "submitted",
                        detail: `${approval.detail} · ${answers.join(", ")}`,
                      }
                    : approval,
                ),
              }));
            });
          },
        ),
      submitMcp: async (requestId, action, contentText) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.submitMcp(requestId, action, contentText);
          },
          async () => {
            mutateLocal((draft) => {
              draft.threads = draft.threads.map((record) => ({
                ...record,
                approvals: record.approvals.map((approval) =>
                  approval.id === requestId
                    ? {
                        ...approval,
                        state: action === "accept" ? "submitted" : "declined",
                      }
                    : approval,
                ),
              }));
            });
          },
        ),
      forkThread: async (threadId) => {
        const source = snapshotRef.current.threads.find((entry) => entry.thread.id === threadId);
        const forkId = nextId("thread");

        mutateLocal((draft) => {
          const current = source
            ? structuredClone(source)
            : createBlankThreadRecord(forkId, "Forked Session", draft.settings);

          current.thread.id = forkId;
          current.thread.name = source ? `Fork of ${latestThreadLabel(source)}` : "Forked Session";
          current.thread.preview = source?.thread.preview ?? "Forked session";
          current.thread.createdAt = Math.floor(Date.now() / 1000);
          current.thread.updatedAt = Math.floor(Date.now() / 1000);
          current.thread.status = { type: "idle" };
          current.approvals = [];
          current.terminals = [];

          draft.threads = sortThreads([current, ...draft.threads.filter((entry) => entry.thread.id !== forkId)]);
        });

        return forkId;
      },
      compactThread: async (threadId) => {
        mutateLocal((draft) => {
          draft.threads = draft.threads.map((record) => {
            if (record.thread.id !== threadId) {
              return record;
            }

            const turns = [...record.thread.turns];
            if (turns.length === 0) {
              return record;
            }

            const lastTurn = turns[turns.length - 1];
            if (!lastTurn.items.some((item) => item.type === "contextCompaction")) {
              lastTurn.items = [...lastTurn.items, { type: "contextCompaction", id: nextId("compact") }];
            }

            return {
              ...record,
              plan: record.plan
                ? {
                    ...record.plan,
                    explanation: "Conversation compacted to free context.",
                  }
                : record.plan,
              thread: {
                ...record.thread,
                turns,
              },
            };
          });
        });
      },
    }),
    [createThreadLocal, mutateLocal, sendComposerLocal, withLiveFallback],
  );

  return <WorkspaceContext.Provider value={{ snapshot, actions }}>{children}</WorkspaceContext.Provider>;
}

export function BlankWorkspacePage() {
  return <CodexWorkspacePage />;
}

export function CodexWorkspacePage() {
  const { snapshot, actions } = useWorkspace();
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const route = parseRoute(pathname);
  const uniqueThreads = useMemo(() => {
    const map = new Map<string, ThreadRecord>();

    snapshot.threads.forEach((entry) => {
      const existing = map.get(entry.thread.id);
      if (!existing || entry.thread.updatedAt >= existing.thread.updatedAt) {
        map.set(entry.thread.id, entry);
      }
    });

    return sortThreads([...map.values()]);
  }, [snapshot.threads]);
  const threadLabelById = useMemo(() => {
    const labels: Record<string, string> = {};
    uniqueThreads.forEach((entry) => {
      labels[entry.thread.id] = latestThreadLabel(entry);
    });
    return labels;
  }, [uniqueThreads]);

  const activeThreadId = route.threadId ?? uniqueThreads[0]?.thread.id ?? null;
  const activeThread = activeThreadId
    ? uniqueThreads.find((entry) => entry.thread.id === activeThreadId) ?? null
    : null;
  const activeThreadLabel = activeThread ? threadLabelById[activeThread.thread.id] ?? threadLabel(activeThread.thread) : "New Session";
  const routePanel = sectionToPanel(route.section);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(isDesktopViewport());
  const [panelTab, setPanelTab] = useState<PanelTab>(routePanel ?? "files");
  const [commandOpen, setCommandOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [composer, setComposer] = useState("");
  const [composerMode, setComposerMode] = useState<WorkspaceMode>("chat");
  const [toolbarAuto, setToolbarAuto] = useState(false);
  const [toolbarPlan, setToolbarPlan] = useState(false);
  const [toolbarShell, setToolbarShell] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<Array<MentionAttachment>>([]);
  const [selectedSkills, setSelectedSkills] = useState<Array<SkillCard>>([]);
  const [selectedImages, setSelectedImages] = useState<Array<ComposerImage>>([]);
  const [selectedFiles, setSelectedFiles] = useState<Array<ComposerFile>>([]);
  const [tabIds, setTabIds] = useState<Array<string>>(
    activeThreadId ? [activeThreadId, ...snapshot.threads.slice(1, 2).map((entry) => entry.thread.id)] : [],
  );
  const [commandQuery, setCommandQuery] = useState("");
  const [quickMode, setQuickMode] = useState<QuickMode | null>(null);
  const [quickQuery, setQuickQuery] = useState("");
  const [quickIndex, setQuickIndex] = useState(0);
  const [queuedByThreadId, setQueuedByThreadId] = useState<Record<string, Array<QueuedComposerMessage>>>({});
  const [toasts, setToasts] = useState<Array<ToastItem>>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: ThreadItem | null } | null>(null);
  const [explorerPath, setExplorerPath] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreviewState | null>(null);
  const [selectedDiffEntryId, setSelectedDiffEntryId] = useState<string | null>(null);

  const chatRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerMirrorRef = useRef<HTMLDivElement | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFileInputRef = useRef<HTMLInputElement | null>(null);
  const queueProcessingRef = useRef<Record<string, boolean>>({});
  const toastTimersRef = useRef<Record<string, number>>({});
  const hydratedScrollKeyRef = useRef<string | null>(null);
  const [streamVisible, setStreamVisible] = useState<Record<string, number>>({});
  const deferredComposer = useDeferredValue(composer);
  const deferredQuickQuery = useDeferredValue(quickQuery);

  const visibleTabIds = useMemo(() => {
    const availableIds = new Set(uniqueThreads.map((entry) => entry.thread.id));
    return [...new Set(tabIds.filter((id) => availableIds.has(id)))].slice(0, 6);
  }, [tabIds, uniqueThreads]);
  const activeTurns = useMemo(() => sortTurnsById(activeThread?.thread.turns ?? []), [activeThread?.thread.turns]);
  const activeTurn = [...activeTurns].reverse().find((turn) => turn.status === "inProgress") ?? null;
  const activeQueuedMessages = activeThreadId ? queuedByThreadId[activeThreadId] ?? [] : [];
  const liveOverlay = useMemo(() => deriveLiveOverlay(activeTurn), [activeTurn]);
  const activeUiApproval = approvalModeFromSettings(snapshot.settings);
  const activeThreadTimeLabel = activeThread ? formatClock(activeThread.thread.updatedAt) : formatClock(Math.floor(Date.now() / 1000));
  const activeExplorerPath = useMemo(() => {
    const cwd = activeThread?.thread.cwd ?? null;
    if (!cwd) {
      return null;
    }

    if (!explorerPath || !isPathWithinRoot(cwd, explorerPath)) {
      return cwd;
    }

    return explorerPath;
  }, [activeThread?.thread.cwd, explorerPath]);
  const effectiveComposerSettings = useMemo<SettingsState>(
    () => ({
      ...snapshot.settings,
      collaborationMode: toolbarPlan ? "plan" : "default",
    }),
    [snapshot.settings, toolbarPlan],
  );

  const groupedThreads = useMemo(() => {
    const groups: Record<string, Array<ThreadRecord>> = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    };

    uniqueThreads.forEach((entry) => {
      groups[threadDayGroup(entry.thread.updatedAt)].push(entry);
    });

    return groups;
  }, [uniqueThreads]);

  const modelOptions = snapshot.models.length > 0 ? snapshot.models : FALLBACK_DATA.models;

  const fileChanges = useMemo(
    () =>
      activeTurns.flatMap((turn) =>
        turn.items.filter((item): item is Extract<ThreadItem, { type: "fileChange" }> => item.type === "fileChange"),
      ),
    [activeTurns],
  );

  const diffEntries = useMemo<Array<DiffReviewEntry>>(
    () =>
      activeTurns
        .flatMap((turn) =>
          turn.items.flatMap((item) => {
            if (item.type !== "fileChange") {
              return [];
            }

            const changes =
              item.changes.length > 0
                ? item.changes
                : [
                    {
                      path: "Editing files",
                      kind: { type: "update", move_path: null } as const,
                      diff: "",
                    },
                  ];

            return changes.map((change, index) => {
              const stats = countDiffStats(change.diff);
              return {
                id: diffEntryId(item.id, index, change.path),
                itemId: item.id,
                path: change.path,
                diff: change.diff,
                kind: change.kind,
                status: item.status,
                additions: stats.additions,
                removals: stats.removals,
                hunks: stats.hunks,
              };
            });
          }),
        )
        .reverse(),
    [activeTurns],
  );

  const selectedDiffEntry = useMemo(
    () => diffEntries.find((entry) => entry.id === selectedDiffEntryId) ?? diffEntries[0] ?? null,
    [diffEntries, selectedDiffEntryId],
  );

  const selectedDiffFindings = useMemo(() => {
    if (!activeThread) {
      return [];
    }

    if (!selectedDiffEntry) {
      return activeThread.review;
    }

    const targetPath = normalizeDiffPath(selectedDiffEntry.path);
    return activeThread.review.filter((finding) => {
      const findingPath = normalizeDiffPath(finding.file);
      return findingPath === targetPath || findingPath.endsWith(`/${targetPath}`);
    });
  }, [activeThread, selectedDiffEntry]);

  const agentCalls = useMemo(
    () =>
      activeTurns.flatMap((turn) =>
        turn.items.filter(
          (item): item is Extract<ThreadItem, { type: "collabAgentToolCall" }> => item.type === "collabAgentToolCall",
        ),
      ),
    [activeTurns],
  );

  const latestAgentMessage = useMemo(() => {
    for (const turn of [...activeTurns].reverse()) {
      for (const item of [...turn.items].reverse()) {
        if (item.type === "agentMessage") {
          return item;
        }
      }
    }

    return null;
  }, [activeTurns]);

  const quickEntries = useMemo<Array<QuickEntry>>(() => {
    if (quickMode === "mention") {
      const query = quickQuery.replace(/^@/u, "").trim().toLowerCase();
      const immediateDirectoryEntries =
        activeThread && snapshot.directoryCatalogRoot === activeThread.thread.cwd
          ? snapshot.directoryCatalog.filter((entry) =>
              query ? `${entry.name} ${entry.path}`.toLowerCase().includes(query) : true,
            )
          : [];
      const mergedMentions = new Map<string, MentionAttachment>();

      [...immediateDirectoryEntries, ...snapshot.mentionCatalog].forEach((entry) => {
        if (!mergedMentions.has(entry.path)) {
          mergedMentions.set(entry.path, entry);
        }
      });

      return [...mergedMentions.values()].slice(0, 24).map((entry) => ({
        id: entry.id,
        label: entry.name,
        description: shorten(entry.path, 92),
        mode: "mention",
        value: entry.path,
      }));
    }

    if (quickMode === "skill") {
      return [...snapshot.installedSkills, ...snapshot.remoteSkills].map((entry) => ({
        id: entry.id,
        label: `$${entry.name}`,
        description: entry.description,
        mode: "skill",
        value: entry.name,
      }));
    }

    return SLASH_COMMANDS.map((entry) => ({
      id: entry.cmd,
      label: entry.cmd,
      description: entry.dsc,
      mode: "slash",
      value: entry.cmd,
    }));
  }, [activeThread, quickMode, quickQuery, snapshot.directoryCatalog, snapshot.directoryCatalogRoot, snapshot.installedSkills, snapshot.mentionCatalog, snapshot.remoteSkills]);

  const filteredQuickEntries = useMemo(() => {
    const query = deferredQuickQuery.trim().toLowerCase();
    if (!query) {
      return quickEntries.slice(0, 12);
    }

    return quickEntries
      .filter((entry) => `${entry.label} ${entry.description}`.toLowerCase().includes(query))
      .slice(0, 12);
  }, [deferredQuickQuery, quickEntries]);

  const commandPaletteGroups = useMemo(() => {
    const groups = [
      {
        label: "Session",
        items: [
          { icon: "💬", name: "New Session (/new)", key: "⌘N", action: () => void createSession() },
          { icon: "⑂", name: "Fork Session (/fork)", key: "", action: () => void forkSession() },
          { icon: "🗜", name: "Compact Transcript (/compact)", key: "", action: () => void compactSession() },
          { icon: "🗑", name: "Clear Composer", key: "", action: () => resetComposer() },
        ],
      },
      {
        label: "Navigate",
        items: [
          { icon: "📁", name: "Files Panel", key: "", action: () => openPanel("files") },
          { icon: "⬛", name: "Terminal Output (/ps)", key: "", action: () => openPanel("terminal") },
          { icon: "⑂", name: "Multi-agent Panel", key: "", action: () => openPanel("agents") },
          { icon: "⚙", name: "Config & Feature Flags", key: "⌘,", action: () => openPanel("config") },
        ],
      },
      {
        label: "Slash",
        items: SLASH_COMMANDS.map((entry) => ({
          icon: "/",
          name: `${entry.cmd} — ${entry.dsc}`,
          key: "",
          action: () => runSlash(entry.cmd),
        })),
      },
      {
        label: "Model",
        items: modelOptions.map((entry) => ({
          icon: "🤖",
          name: entry.displayName,
          key: "",
          action: () => void selectModel(entry.id),
        })),
      },
    ];

    const query = commandQuery.trim().toLowerCase();
    if (!query) {
      return groups;
    }

    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => `${item.name} ${group.label}`.toLowerCase().includes(query)),
      }))
      .filter((group) => group.items.length > 0);
  }, [commandQuery, modelOptions]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }

    setTabIds((current) => {
      if (current.includes(activeThreadId)) {
        return current;
      }

      return [activeThreadId, ...current.filter((entry) => entry !== activeThreadId)].slice(0, 6);
    });
  }, [activeThreadId]);

  const existingThreadHistoryPending = useMemo(
    () =>
      route.threadId === activeThread?.thread.id &&
      snapshot.transport.mode === "live" &&
      snapshot.transport.status === "connected" &&
      isExistingThreadHistoryPending(activeThread, activeTurns),
    [activeThread, activeTurns, route.threadId, snapshot.transport.mode, snapshot.transport.status],
  );

  useEffect(() => {
    if (!route.threadId || snapshot.transport.mode !== "live" || snapshot.transport.status !== "connected") {
      return;
    }

    if (!activeThread || !isExistingThreadHistoryPending(activeThread, activeTurns)) {
      return;
    }

    const threadId = route.threadId;
    let attempts = 0;
    const hydrate = () => {
      attempts += 1;
      void actions.resumeThread(threadId);
    };

    hydrate();

    const retryTimer = window.setInterval(() => {
      if (attempts >= 5) {
        window.clearInterval(retryTimer);
        return;
      }

      hydrate();
    }, 1200);

    return () => {
      window.clearInterval(retryTimer);
    };
  }, [
    actions,
    activeThread,
    activeTurns,
    route.threadId,
    snapshot.transport.mode,
    snapshot.transport.status,
  ]);

  useEffect(() => {
    if (!selectedDiffEntryId || !diffEntries.some((entry) => entry.id === selectedDiffEntryId)) {
      setSelectedDiffEntryId(diffEntries[0]?.id ?? null);
    }
  }, [diffEntries, selectedDiffEntryId]);

  useEffect(() => {
    Object.entries(queuedByThreadId).forEach(([threadId, queue]) => {
      if (queue.length === 0 || queueProcessingRef.current[threadId]) {
        return;
      }

      const threadRecord = snapshot.threads.find((entry) => entry.thread.id === threadId);
      const hasInProgressTurn = threadRecord?.thread.turns.some((turn) => turn.status === "inProgress") ?? false;
      if (hasInProgressTurn) {
        return;
      }

      const [nextMessage] = queue;
      if (!nextMessage) {
        return;
      }

      queueProcessingRef.current[threadId] = true;

      setQueuedByThreadId((current) => {
        const currentQueue = current[threadId] ?? [];
        if (currentQueue[0]?.id !== nextMessage.id) {
          return current;
        }

        const rest = currentQueue.slice(1);
        if (rest.length === 0) {
          const { [threadId]: _removed, ...remaining } = current;
          return remaining;
        }

        return {
          ...current,
          [threadId]: rest,
        };
      });

      void actions
        .sendComposer({
          threadId,
          mode: nextMessage.mode,
          prompt: nextMessage.prompt,
          mentions: nextMessage.mentions,
          skills: nextMessage.skills,
          images: nextMessage.images,
          files: nextMessage.files,
          settings: effectiveComposerSettings,
        })
        .catch(() => {
          setQueuedByThreadId((current) => ({
            ...current,
            [threadId]: [nextMessage, ...(current[threadId] ?? [])],
          }));
        })
        .finally(() => {
          delete queueProcessingRef.current[threadId];
        });
    });
  }, [actions, effectiveComposerSettings, queuedByThreadId, snapshot.threads]);

  useEffect(() => {
    if (!routePanel) {
      if (!isDesktopViewport()) {
        setPanelOpen(false);
      }
      return;
    }

    setPanelTab(routePanel);
    setPanelOpen(true);
  }, [routePanel]);

  useEffect(() => {
    if (!activeThread || quickMode !== "mention") {
      return;
    }

    if (snapshot.directoryCatalogRoot !== activeThread.thread.cwd) {
      void actions.loadDirectory(activeThread.thread.cwd);
    }

    const query = deferredQuickQuery.replace(/^@/, "").trim();
    if (!query) {
      return;
    }

    void actions.searchMentions(activeThread.thread.cwd, query);
  }, [actions, activeThread, deferredQuickQuery, quickMode, snapshot.directoryCatalogRoot]);

  useEffect(() => {
    const cwd = activeThread?.thread.cwd;
    if (!cwd) {
      return;
    }

    setExplorerPath((current) => (current && isPathWithinRoot(cwd, current) ? current : cwd));
    setFilePreview((current) => (current && isPathWithinRoot(cwd, current.path) ? current : null));
  }, [activeThread?.thread.cwd]);

  useEffect(() => {
    if (!activeExplorerPath) {
      return;
    }

    void actions.loadDirectory(activeExplorerPath);
  }, [actions, activeExplorerPath]);

  useEffect(() => {
    if (snapshot.transport.mode === "live") {
      const nextVisible = Object.fromEntries(snapshot.streams.map((entry) => [entry.key, entry.visible]));
      setStreamVisible(nextVisible);
      return;
    }

    const nextTargets = Object.fromEntries(snapshot.streams.map((entry) => [entry.key, getStreamTarget(entry)]));

    setStreamVisible((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(nextTargets)) {
        if (!(key in next)) {
          next[key] = 0;
        } else if (next[key] > value) {
          next[key] = value;
        }
      }
      return next;
    });

    const timer = window.setInterval(() => {
      setStreamVisible((current) => {
        let changed = false;
        const next = { ...current };

        snapshot.streams.forEach((entry) => {
          const key = entry.key;
          const target = getStreamTarget(entry);
          const value = next[key] ?? 0;
          const backlog = target - value;
          const speed = Math.max(1, entry.speed, Math.ceil(backlog / 5));

          if (value < target) {
            next[key] = Math.min(target, value + speed);
            changed = true;
          }
        });

        return changed ? next : current;
      });
    }, 24);

    return () => window.clearInterval(timer);
  }, [snapshot.streams, snapshot.transport.mode]);

  useLayoutEffect(() => {
    if (!chatRef.current) {
      return;
    }

    return scrollChatToBottom();
  }, [activeTurns, streamVisible]);

  useLayoutEffect(() => {
    if (!activeThreadId) {
      hydratedScrollKeyRef.current = null;
      return;
    }

    if (existingThreadHistoryPending || activeTurns.length === 0) {
      hydratedScrollKeyRef.current = null;
      return;
    }

    const latestTurnId = activeTurns.at(-1)?.id ?? "empty";
    const scrollKey = `${activeThreadId}:${latestTurnId}:${activeTurns.length}`;
    if (hydratedScrollKeyRef.current === scrollKey) {
      return;
    }

    hydratedScrollKeyRef.current = scrollKey;
    return scrollChatToBottom(true);
  }, [activeThreadId, activeTurns, existingThreadHistoryPending]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        setSidebarOpen(false);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createSession();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        pushToast("Ctrl+G — opening editor bridge", "");
        return;
      }

      if (event.key === "Escape") {
        setCommandOpen(false);
        setModelPickerOpen(false);
        setContextMenu(null);
        closeQuickPicker();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandQuery]);

  useEffect(() => () => selectedImages.forEach((image) => image.url.startsWith("blob:") && URL.revokeObjectURL(image.url)), [selectedImages]);

  function scrollChatToBottom(extraDelay = false) {
    const run = () => {
      if (chatEndRef.current) {
        chatEndRef.current.scrollIntoView({ block: "end" });
      } else if (chatRef.current) {
        chatRef.current.scrollTop = chatRef.current.scrollHeight;
      }
    };

    const frameA = window.requestAnimationFrame(run);
    const frameB = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    const timeoutA = window.setTimeout(run, extraDelay ? 90 : 40);
    const timeoutB = window.setTimeout(run, extraDelay ? 220 : 120);

    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
      window.clearTimeout(timeoutA);
      window.clearTimeout(timeoutB);
    };
  }

  const pushToast = useCallback((message: string, tone: ToastTone) => {
    const id = nextId("toast");

    setToasts((current) => [...current, { id, message, tone }]);

    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      delete toastTimersRef.current[id];
    }, 2600);

    toastTimersRef.current[id] = timer;
  }, []);

  const focusComposerEnd = useCallback((nextValue?: string) => {
    const desiredValue = nextValue;
    window.requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) {
        return;
      }

      node.focus();
      const position = desiredValue?.length ?? node.value.length;
      try {
        node.setSelectionRange(position, position);
      } catch {
        // Mobile browsers can reject selection updates during certain IME states.
      }
    });
  }, []);

  const getComposerInputValue = useCallback(() => textareaRef.current?.value ?? composer, [composer]);

  const setComposerFromInput = useCallback(
    (nextValue: string | ((current: string) => string)) => {
      const currentValue = getComposerInputValue();
      const resolvedValue = typeof nextValue === "function" ? nextValue(currentValue) : nextValue;
      setComposer(resolvedValue);
      return resolvedValue;
    },
    [getComposerInputValue],
  );

  const resetComposer = useCallback(() => {
    setComposer("");
    setSelectedMentions([]);
    setSelectedSkills([]);
    setSelectedFiles([]);
    setSelectedImages((current) => {
      current.forEach((image) => image.url.startsWith("blob:") && URL.revokeObjectURL(image.url));
      return [];
    });
    setQuickMode(null);
    setQuickQuery("");
    setQuickIndex(0);
  }, []);

  const enqueueMessage = useCallback((threadId: string, message: Omit<QueuedComposerMessage, "id">) => {
    const queuedMessage: QueuedComposerMessage = {
      ...message,
      id: nextId("queue"),
      mentions: [...message.mentions],
      skills: [...message.skills],
      files: [...message.files],
      images: [...message.images],
    };

    setQueuedByThreadId((current) => ({
      ...current,
      [threadId]: [...(current[threadId] ?? []), queuedMessage],
    }));
  }, []);

  const removeQueuedMessage = useCallback((threadId: string, messageId: string) => {
    setQueuedByThreadId((current) => {
      const queue = current[threadId] ?? [];
      const next = queue.filter((entry) => entry.id !== messageId);
      if (next.length === queue.length) {
        return current;
      }

      if (next.length === 0) {
        const { [threadId]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [threadId]: next,
      };
    });
  }, []);

  const prependQueuedMessage = useCallback((threadId: string, message: QueuedComposerMessage) => {
    setQueuedByThreadId((current) => ({
      ...current,
      [threadId]: [message, ...(current[threadId] ?? [])],
    }));
  }, []);

  const navigateToThread = useCallback(
    (threadId: string, section: RouteSection = "chat") => {
      if (section === "chat") {
        void navigate({
          to: "/threads/$threadId",
          params: { threadId } as never,
        });
        return;
      }

      void navigate({
        to: "/threads/$threadId/$section",
        params: { threadId, section } as never,
      });
    },
    [navigate],
  );

  const openPanel = useCallback(
    (tab: PanelTab) => {
      setPanelTab(tab);
      setPanelOpen(true);
      setSidebarOpen(false);

      if (activeThreadId) {
        navigateToThread(activeThreadId, panelToSection(tab));
      }
    },
    [activeThreadId, navigateToThread],
  );

  const reviewDiff = useCallback((diffId?: string) => {
    if (diffId) {
      setSelectedDiffEntryId(diffId);
    }
    openPanel("diff");
  }, [openPanel]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    if (activeThreadId) {
      navigateToThread(activeThreadId, "chat");
    }
  }, [activeThreadId, navigateToThread]);

  const createSession = useCallback(async () => {
    const threadId = await actions.createThread(effectiveComposerSettings, "New Session");
    setTabIds((current) => [threadId, ...current.filter((entry) => entry !== threadId)].slice(0, 6));
    navigateToThread(threadId, "chat");
    setSidebarOpen(false);
    setPanelOpen(isDesktopViewport());
    resetComposer();
    pushToast("New session — /new", "ok");
  }, [actions, effectiveComposerSettings, navigateToThread, pushToast, resetComposer]);

  const forkSession = useCallback(async () => {
    if (!activeThreadId) {
      await createSession();
      return;
    }

    const forkId = await actions.forkThread(activeThreadId);
    setTabIds((current) => [forkId, ...current.filter((entry) => entry !== forkId)].slice(0, 6));
    navigateToThread(forkId, "chat");
    pushToast("/fork — session forked", "ok");
  }, [actions, activeThreadId, createSession, navigateToThread, pushToast]);

  const compactSession = useCallback(async () => {
    if (!activeThreadId) {
      return;
    }

    await actions.compactThread(activeThreadId);
    pushToast("/compact — transcript summarized", "ok");
  }, [actions, activeThreadId, pushToast]);

  const selectModel = useCallback(
    async (modelId: string) => {
      await actions.updateSettings({ model: modelId });
      setModelPickerOpen(false);
      pushToast(`Model: ${modelId}`, "");
    },
    [actions, pushToast],
  );

  const cycleApproval = useCallback(async () => {
    const currentIndex = APPROVAL_ORDER.indexOf(activeUiApproval);
    const next = APPROVAL_ORDER[(currentIndex + 1) % APPROVAL_ORDER.length];
    await actions.updateSettings(settingsPatchFromApprovalMode(next));
    pushToast(`Approval: ${APPROVAL_LABELS[next]}`, "");
  }, [actions, activeUiApproval, pushToast]);

  const closeQuickPicker = useCallback(() => {
    setQuickMode(null);
    setQuickQuery("");
    setQuickIndex(0);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (!target.closest("#ctxmenu")) {
        setContextMenu(null);
      }

      if (!target.closest("#hmodel") && !target.closest("#mpicker")) {
        setModelPickerOpen(false);
      }

      if (!target.closest("#ta") && !target.closest("#slashpop")) {
        closeQuickPicker();
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [closeQuickPicker]);

  const replaceCurrentToken = useCallback((value: string) => {
    const nextValue = setComposerFromInput((current) =>
      current.replace(/(?:^|\s)([@$/][^\s]*)$/, (match) => match.replace(/[@$/][^\s]*$/, value)),
    );
    focusComposerEnd(nextValue);
  }, [focusComposerEnd, setComposerFromInput]);

  const attachMention = useCallback(
    (mention: MentionAttachment) => {
      setSelectedMentions((current) =>
        current.some((entry) => entry.id === mention.id || entry.path === mention.path) ? current : [...current, mention],
      );
      closeQuickPicker();
      const nextValue = setComposerFromInput((current) => insertInlineMentionToken(current, mention));
      focusComposerEnd(nextValue);
      pushToast(`/mention — ${mentionInlineToken(mention)} linked`, "ok");
    },
    [closeQuickPicker, focusComposerEnd, pushToast, setComposerFromInput],
  );

  const attachSkill = useCallback(
    (skillName: string) => {
      const skill = [...snapshot.installedSkills, ...snapshot.remoteSkills].find((entry) => entry.name === skillName);
      if (!skill) {
        return;
      }

      if (skill.source === "remote") {
        void actions.installSkill(skill.id);
        pushToast(`Installing $${skill.name}`, "ok");
      } else {
        setSelectedSkills((current) =>
          current.some((entry) => entry.id === skill.id)
            ? current
            : [
                ...current,
                {
                  ...skill,
                  source: "installed",
                },
              ],
        );
        pushToast(`$${skill.name} attached`, "ok");
      }

      closeQuickPicker();
      const nextValue = setComposerFromInput((current) => current.replace(/(?:^|\s)\$[^\s]*$/, ""));
      focusComposerEnd(nextValue);
    },
    [actions, closeQuickPicker, focusComposerEnd, pushToast, setComposerFromInput, snapshot.installedSkills, snapshot.remoteSkills],
  );

  const activeComposerMentions = useMemo(
    () => selectedMentions.filter((mention) => composerHasMentionToken(deferredComposer, mention)),
    [deferredComposer, selectedMentions],
  );

  const runSlash = useCallback(
    async (slash: string, inline = false) => {
      const [command, ...rest] = slash.trim().split(/\s+/);
      const restText = rest.join(" ");

      switch (command) {
        case "/new":
          await createSession();
          break;
        case "/fork":
          await forkSession();
          break;
        case "/compact":
          await compactSession();
          break;
        case "/mention":
          setQuickMode("mention");
          setQuickQuery(restText);
          break;
        case "/model":
          setModelPickerOpen((current) => !current);
          break;
        case "/permissions":
          await cycleApproval();
          break;
        case "/plan":
          setToolbarPlan(true);
          pushToast("Plan mode enabled", "ok");
          break;
        case "/review":
          setComposerMode("review");
          openPanel("diff");
          if (inline && activeThreadId) {
            await actions.sendComposer({
              threadId: activeThreadId,
              mode: "review",
              prompt: restText,
              mentions: activeComposerMentions,
              skills: selectedSkills,
              files: selectedFiles,
              images: selectedImages,
              settings: effectiveComposerSettings,
            });
            resetComposer();
          } else {
            pushToast("/review ready", "ok");
          }
          break;
        case "/ps":
          openPanel("terminal");
          break;
        case "/diff":
          openPanel("diff");
          break;
        case "/skills":
          openPanel("config");
          if (activeThreadId) {
            navigateToThread(activeThreadId, "skills");
          }
          break;
        case "/mcp":
          openPanel("config");
          if (activeThreadId) {
            navigateToThread(activeThreadId, "mcp");
          }
          break;
        case "/status":
          openPanel("config");
          pushToast("Session diagnostics opened", "ok");
          break;
        case "/copy":
          if (latestAgentMessage) {
            await copyText(latestAgentMessage.text);
            pushToast("Copied latest response", "ok");
          }
          break;
        case "/clear":
          resetComposer();
          pushToast("/clear — composer reset", "");
          break;
        case "/experimental":
          openPanel("config");
          break;
        case "/init":
          setComposerFromInput("/init Generate AGENTS.md for this repo");
          focusComposerEnd("/init Generate AGENTS.md for this repo");
          break;
        case "/resume":
        case "/theme":
        case "/feedback":
        case "/logout":
        case "/apps":
        case "/exit":
        case "/quit":
        case "/personality":
          pushToast(`${command} queued`, "");
          break;
        default:
          if (inline && activeThreadId) {
            await actions.sendComposer({
              threadId: activeThreadId,
              mode: composerMode,
              prompt: slash,
              mentions: activeComposerMentions,
              skills: selectedSkills,
              files: selectedFiles,
              images: selectedImages,
              settings: effectiveComposerSettings,
            });
            resetComposer();
          }
      }
    },
    [
      actions,
      activeThreadId,
      compactSession,
      composerMode,
      cycleApproval,
      createSession,
      forkSession,
      latestAgentMessage,
      navigateToThread,
      openPanel,
      pushToast,
      resetComposer,
      focusComposerEnd,
      selectedImages,
      selectedFiles,
      activeComposerMentions,
      selectedSkills,
      setComposerFromInput,
      snapshot.settings,
      snapshot.threads,
    ],
  );

  const removeImage = useCallback((imageId: string) => {
    setSelectedImages((current) => {
      const target = current.find((entry) => entry.id === imageId);
      if (target?.url.startsWith("blob:")) {
        URL.revokeObjectURL(target.url);
      }
      return current.filter((entry) => entry.id !== imageId);
    });
  }, []);

  const onComposerChange = useCallback(
    (value: string) => {
      startTransition(() => {
        setComposer(value);
      });

      const quickMatch = value.match(/(?:^|\s)([@$/])([^\s]*)$/);
      if (!quickMatch) {
        closeQuickPicker();
        return;
      }

      const prefix = quickMatch[1];
      const query = quickMatch[2] ?? "";
      if (prefix === "/") {
        setQuickMode("slash");
        setQuickQuery(`/${query}`);
        setQuickIndex(0);
        return;
      }

      if (prefix === "@") {
        setQuickMode("mention");
        setQuickQuery(query);
        setQuickIndex(0);
        return;
      }

      if (prefix === "$") {
        setQuickMode("skill");
        setQuickQuery(query);
        setQuickIndex(0);
        return;
      }

      closeQuickPicker();
    },
    [closeQuickPicker],
  );

  const onQuickPick = useCallback(
    (entry: QuickEntry) => {
      if (entry.mode === "slash") {
        replaceCurrentToken(`${entry.value} `);
        closeQuickPicker();
        return;
      }

      if (entry.mode === "mention") {
        const mention = snapshot.mentionCatalog.find((item) => item.id === entry.id);
        if (mention) {
          attachMention(mention);
        }
        return;
      }

      attachSkill(entry.value);
    },
    [attachMention, attachSkill, closeQuickPicker, replaceCurrentToken, snapshot.mentionCatalog],
  );

  const onComposerKeyDown = useCallback(
    async (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (quickMode && filteredQuickEntries.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setQuickIndex((current) => Math.min(filteredQuickEntries.length - 1, current + 1));
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setQuickIndex((current) => Math.max(0, current - 1));
          return;
        }

        if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
          event.preventDefault();
          onQuickPick(filteredQuickEntries[quickIndex]);
          return;
        }

        if (event.key === "Escape") {
          closeQuickPicker();
          return;
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        pushToast("Ctrl+G — opening editor bridge", "");
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        await submitComposer(event.currentTarget.value);
      }
    },
    [closeQuickPicker, filteredQuickEntries, onQuickPick, pushToast, quickIndex, quickMode],
  );

  const submitComposer = useCallback(async (rawValue?: string) => {
    const composerValue = rawValue ?? textareaRef.current?.value ?? composer;
    const prompt = composerValue.trim();
    const promptMentions = selectedMentions.filter((mention) => composerHasMentionToken(composerValue, mention));
    if (
      !prompt &&
      promptMentions.length === 0 &&
      selectedSkills.length === 0 &&
      selectedFiles.length === 0 &&
      selectedImages.length === 0
    ) {
      return;
    }

    let threadId = activeThreadId;
    if (!threadId) {
      threadId = await actions.createThread(effectiveComposerSettings, "New Session");
      setTabIds((current) => [threadId!, ...current.filter((entry) => entry !== threadId)].slice(0, 6));
      navigateToThread(threadId, "chat");
    }

    if (prompt.startsWith("/")) {
      await runSlash(prompt, true);
      return;
    }

    const mode = composerMode === "review" || route.section === "review" ? "review" : "chat";
    const nextPrompt = toolbarShell && prompt ? `! ${prompt}` : prompt;

    if (activeTurn) {
      enqueueMessage(threadId, {
        mode,
        prompt: nextPrompt,
        mentions: promptMentions,
        skills: selectedSkills,
        files: selectedFiles,
        images: selectedImages,
      });
      resetComposer();
      pushToast("Message queued", "ok");
      return;
    }

    await actions.sendComposer({
      threadId,
      mode,
      prompt: nextPrompt,
      mentions: promptMentions,
      skills: selectedSkills,
      files: selectedFiles,
      images: selectedImages,
      settings: effectiveComposerSettings,
    });

    resetComposer();
  }, [
    actions,
    activeThreadId,
    activeTurn,
    composer,
    composerMode,
    enqueueMessage,
    navigateToThread,
    pushToast,
    resetComposer,
    route.section,
    runSlash,
    selectedMentions,
    selectedImages,
    selectedFiles,
    selectedSkills,
    snapshot.settings,
    toolbarShell,
  ]);

  const onImagesChosen = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    setSelectedImages((current) => [
      ...current,
        ...files.map((file) => ({
          id: nextId("image"),
          name: file.name,
          url: URL.createObjectURL(file),
          size: formatUploadSize(file.size),
        })),
    ]);

    event.target.value = "";
    pushToast("Image attached", "ok");
  }, [pushToast]);

  const onUploadFilesChosen = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    setSelectedFiles((current) => [
      ...current,
      ...files.map((file) => ({
        id: nextId("file"),
        name: file.name,
        size: formatUploadSize(file.size),
        file,
      })),
    ]);

    event.target.value = "";
    pushToast("File attached", "ok");
  }, [pushToast]);

  const onStopTurn = useCallback(async () => {
    if (!activeThreadId) {
      return;
    }

    const stopped = await actions.interruptTurn(activeThreadId);
    pushToast(stopped ? "Stop requested" : "No active turn to stop", stopped ? "warn" : "");
  }, [actions, activeThreadId, pushToast]);

  const removeSkill = useCallback((skillId: string) => {
    setSelectedSkills((current) => current.filter((entry) => entry.id !== skillId));
  }, []);

  const removeUploadedFile = useCallback((fileId: string) => {
    setSelectedFiles((current) => current.filter((entry) => entry.id !== fileId));
  }, []);

  const steerQueuedMessage = useCallback(
    async (messageId: string) => {
      if (!activeThreadId) {
        return;
      }

      const queuedMessage = (queuedByThreadId[activeThreadId] ?? []).find((entry) => entry.id === messageId);
      if (!queuedMessage) {
        return;
      }

      removeQueuedMessage(activeThreadId, messageId);

      if (activeTurn) {
        const applied = await actions.applySteer({
          threadId: activeThreadId,
          prompt: queuedMessage.prompt,
          mentions: queuedMessage.mentions,
          skills: queuedMessage.skills,
          files: queuedMessage.files,
          images: queuedMessage.images,
        });

        if (applied) {
          pushToast("Queued message sent as steer", "ok");
          return;
        }

        prependQueuedMessage(activeThreadId, queuedMessage);
        pushToast("No active turn to steer", "warn");
        return;
      }

      try {
        await actions.sendComposer({
          threadId: activeThreadId,
          mode: queuedMessage.mode,
          prompt: queuedMessage.prompt,
          mentions: queuedMessage.mentions,
          skills: queuedMessage.skills,
          files: queuedMessage.files,
          images: queuedMessage.images,
          settings: effectiveComposerSettings,
        });
      } catch {
        prependQueuedMessage(activeThreadId, queuedMessage);
      }
    },
    [actions, activeThreadId, activeTurn, effectiveComposerSettings, prependQueuedMessage, pushToast, queuedByThreadId, removeQueuedMessage],
  );

  const removeTab = useCallback(
    (threadId: string) => {
      if (visibleTabIds.length <= 1) {
        pushToast("Cannot close last tab", "");
        return;
      }

      const next = visibleTabIds.filter((entry) => entry !== threadId);
      setTabIds(next);

      if (threadId === activeThreadId && next[0]) {
        navigateToThread(next[0], "chat");
      }
    },
    [activeThreadId, navigateToThread, pushToast, visibleTabIds],
  );

  const currentTokenCount = Math.floor(deferredComposer.length / 3.5).toLocaleString();
  const composerPlaceholder = quickMode
    ? QUICK_HINTS[quickMode]
    : activeTurn
      ? "Queue a follow-up while Codex is still running…"
      : QUICK_HINTS.slash;
  const composerActionLabel = activeTurn ? "Queue" : "↑";
  const handleCopy = useCallback(
    (value: string) => {
      void copyText(value).then(() => pushToast("Copied!", "ok"));
    },
    [pushToast],
  );
  const triggerPlan = useCallback(() => {
    void runSlash("/plan");
  }, [runSlash]);
  const fillComposer = useCallback((value: string) => {
    setComposerFromInput(value);
    focusComposerEnd(value);
  }, [focusComposerEnd, setComposerFromInput]);
  const triggerSlash = useCallback((value: string) => {
    void runSlash(value);
  }, [runSlash]);
  const openItemContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>, item: ThreadItem) => {
    event.preventDefault();
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 172),
      y: Math.min(event.clientY, window.innerHeight - 212),
      item,
    });
  }, []);
  const openExplorerEntry = useCallback(
    async (entry: MentionAttachment) => {
      if (entry.kind === "directory") {
        setExplorerPath(entry.path);
        setFilePreview(null);
        return;
      }

      attachMention(entry);
      setFilePreview({
        path: entry.path,
        name: entry.name,
        content: "",
        loading: true,
        error: null,
      });

      try {
        const content = await actions.readFile(entry.path);
        startTransition(() => {
          setFilePreview({
            path: entry.path,
            name: entry.name,
            content,
            loading: false,
            error: null,
          });
        });
      } catch (error) {
        setFilePreview({
          path: entry.path,
          name: entry.name,
          content: "",
          loading: false,
          error: error instanceof Error ? error.message : "Unable to open this file.",
        });
      }
    },
    [actions, attachMention],
  );
  const renderPanelBody = () => {
    if (!activeThread) {
      return <div className="empty-panel">No active thread.</div>;
    }

    if (panelTab === "files") {
      const changedPaths = new Map<string, "mod" | "new" | "del">();
      const rootPath = activeThread.thread.cwd;
      const currentPath = activeExplorerPath ?? rootPath;
      const directoryEntries = snapshot.directoryCatalogRoot === currentPath ? snapshot.directoryCatalog : [];
      const mentionedPaths = new Set(activeComposerMentions.map((entry) => entry.path));
      const relativePath = currentPath === rootPath ? "" : currentPath.slice(rootPath.length).replace(/^\/+/u, "");
      const breadcrumbs = [
        {
          label: rootPath.split("/").filter(Boolean).pop() ?? rootPath,
          path: rootPath,
        },
        ...relativePath.split("/").filter(Boolean).reduce<Array<{ label: string; path: string }>>((parts, segment) => {
          const previous = parts.at(-1)?.path ?? rootPath;
          parts.push({
            label: segment,
            path: `${previous.replace(/\/+$/u, "")}/${segment}`,
          });
          return parts;
        }, []),
      ];
      const parentPath =
        currentPath === rootPath ? null : currentPath.slice(0, currentPath.lastIndexOf("/")) || rootPath;
      fileChanges.forEach((entry) => {
        entry.changes.forEach((change) => {
          changedPaths.set(
            change.path,
            change.kind.type === "add" ? "new" : change.kind.type === "delete" ? "del" : "mod",
          );
        });
      });

      return (
        <div>
          <div className="panel-head-row">
            {parentPath ? (
              <button className="mini-action" type="button" onClick={() => setExplorerPath(parentPath)}>
                ← Back
              </button>
            ) : null}
            <div className="panel-hint">📁 {currentPath} · {changedPaths.size} modified</div>
          </div>
          <div className="file-breadcrumbs">
            {breadcrumbs.map((crumb) => (
              <button
                className={clsx("file-crumb", crumb.path === currentPath && "active")}
                key={crumb.path}
                type="button"
                onClick={() => {
                  setExplorerPath(crumb.path);
                  setFilePreview((current) => (current && isPathWithinRoot(crumb.path, current.path) ? current : null));
                }}
              >
                {crumb.label}
              </button>
            ))}
          </div>
          {snapshot.directoryCatalogRoot !== currentPath ? <div className="empty-panel">Loading files for this directory…</div> : null}
          {snapshot.directoryCatalogRoot === currentPath && directoryEntries.length === 0 ? (
            <div className="empty-panel">No direct files or folders found in this directory.</div>
          ) : null}
          {directoryEntries.map((entry) => {
            const badge = changedPaths.get(entry.name) ?? changedPaths.get(entry.path.replace(`${activeThread.thread.cwd}/`, ""));
            return (
              <button
                className={clsx(
                  "fi",
                  entry.kind === "directory" && "dir",
                  badge === "mod" && "active",
                  mentionedPaths.has(entry.path) && "mentioned",
                  filePreview?.path === entry.path && "open",
                )}
                key={entry.id}
                type="button"
                onClick={() => void openExplorerEntry(entry)}
              >
                <span>{entry.kind === "directory" ? "📁" : "📄"}</span>
                <span className="fi-n">{entry.name}</span>
                {mentionedPaths.has(entry.path) ? <span className="fbdg mention">@</span> : null}
                {badge ? <span className={clsx("fbdg", badge)}>{badge}</span> : null}
              </button>
            );
          })}
          {filePreview ? <FileEditorPreview preview={filePreview} /> : null}
          <div className="panel-meta">
            <div>Tap a file to mention it and open the editor. Tap folders to drill in.</div>
            <div>Use <code>/mention filename</code> or type <code>@filename</code> in the composer.</div>
          </div>
        </div>
      );
    }

    if (panelTab === "diff") {
      const totalAdditions = diffEntries.reduce((sum, entry) => sum + entry.additions, 0);
      const totalRemovals = diffEntries.reduce((sum, entry) => sum + entry.removals, 0);

      return (
        <div className="diff-review-shell">
          <div className="panel-hint">
            Patch review · {diffEntries.length} changed file{diffEntries.length === 1 ? "" : "s"} · +{totalAdditions} / -{totalRemovals}
          </div>
          {diffEntries.length === 0 ? <div className="empty-panel">No diff items in this thread yet.</div> : null}
          {diffEntries.length > 0 ? (
            <div className="diff-review-layout">
              <div className="diff-review-sidebar">
                {diffEntries.map((entry) => (
                  <button
                    className={clsx("diff-review-entry", selectedDiffEntry?.id === entry.id && "active")}
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedDiffEntryId(entry.id)}
                  >
                    <div className="diff-review-entry-top">
                      <span className={clsx("diff-kind-pill", entry.kind.type === "add" && "new", entry.kind.type === "delete" && "del")}>
                        {diffKindLabel(entry.kind)}
                      </span>
                      <span className={clsx("diff-status", entry.status === "inProgress" && "live", entry.status === "failed" && "err")}>
                        {entry.status === "inProgress" ? "editing" : entry.status}
                      </span>
                    </div>
                    <div className="diff-review-entry-path">{entry.path}</div>
                    <div className="diff-review-entry-meta">
                      <span>+{entry.additions}</span>
                      <span>-{entry.removals}</span>
                      <span>{entry.hunks} hunk{entry.hunks === 1 ? "" : "s"}</span>
                    </div>
                  </button>
                ))}
              </div>

              {selectedDiffEntry ? (
                <div className="diff-review-main">
                  <div className="diff-focus-head">
                    <div className="diff-focus-title">{selectedDiffEntry.path}</div>
                    <div className="diff-focus-meta">
                      <span className={clsx("diff-kind-pill", selectedDiffEntry.kind.type === "add" && "new", selectedDiffEntry.kind.type === "delete" && "del")}>
                        {diffKindLabel(selectedDiffEntry.kind)}
                      </span>
                      <span className={clsx("diff-status", selectedDiffEntry.status === "inProgress" && "live", selectedDiffEntry.status === "failed" && "err")}>
                        {selectedDiffEntry.status === "inProgress" ? "editing" : selectedDiffEntry.status}
                      </span>
                      <span className="diff-stat-chip">+{selectedDiffEntry.additions}</span>
                      <span className="diff-stat-chip">-{selectedDiffEntry.removals}</span>
                      <span className="diff-stat-chip">{selectedDiffEntry.hunks} hunk{selectedDiffEntry.hunks === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  <DiffPatchViewer entry={selectedDiffEntry} />
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedDiffFindings.length > 0 ? (
            <div className="review-list">
              {selectedDiffFindings.map((finding) => (
                <div className={clsx("review-item", finding.severity)} key={finding.id}>
                  <div className="review-header">
                    <span>{finding.severity}</span>
                    <span>{finding.file.split("/").slice(-2).join("/")}</span>
                    <span>:{finding.line}</span>
                  </div>
                  <div className="review-title">{finding.title}</div>
                  <div className="review-summary">{finding.summary}</div>
                </div>
              ))}
            </div>
          ) : activeThread.review.length > 0 ? <div className="empty-panel">No review findings mapped to the selected file.</div> : null}
          {activeThread.approvals.length > 0 ? (
            <div className="panel-actions">
              {activeThread.approvals.map((approval) => (
                <div className="approval-inline" key={approval.id}>
                  <div className="approval-inline-copy">
                    <strong>{approval.title}</strong>
                    <span>{approval.detail}</span>
                  </div>
                  <div className="appr-a">
                    <button className="abtn yes" type="button" onClick={() => void actions.resolveApproval(approval.id, true)}>
                      ✓ Apply
                    </button>
                    <button className="abtn no" type="button" onClick={() => void actions.resolveApproval(approval.id, false)}>
                      ✗ Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    if (panelTab === "terminal") {
      return (
        <div>
          <div className="panel-head-row">
            <div className="panel-hint">Background terminals and PTY snapshots</div>
            <button className="mini-action" type="button" onClick={() => void actions.cleanTerminals(activeThread.thread.id)}>
              Clean
            </button>
          </div>
          {activeThread.terminals.length === 0 ? <div className="empty-panel">No terminal sessions yet.</div> : null}
          {activeThread.terminals.map((terminal) => (
            <div className="terminal-card" key={terminal.id}>
              <div className="terminal-title-row">
                <div>
                  <strong>{terminal.title}</strong>
                  <div className="terminal-meta">{terminal.command}</div>
                </div>
                <span className={clsx("status-chip", terminal.status)}>{terminal.status}</span>
              </div>
              <div className="term">
                {terminal.log.map((line, index) => (
                  <div className={clsx(index === 0 && "t-p")} key={`${terminal.id}-${index}`}>
                    {line}
                  </div>
                ))}
                {terminal.status === "running" ? (
                  <div className="t-p">
                    $ <span className="cur" />
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (panelTab === "agents") {
      const subAgentThreads = snapshot.threads.filter((entry) => entry.thread.agentNickname || entry.thread.agentRole);
      return (
        <div>
          <div className="panel-head-row">
            <div className="panel-hint">⑂ Multi-agent session</div>
            <button className="abtn yes small" type="button" onClick={() => pushToast('spawn_agent("alpha") → started', "ok")}>
              + Spawn
            </button>
          </div>
          {agentCalls.length === 0 && subAgentThreads.length === 0 ? (
            <div className="empty-panel">No subagent activity in this thread yet.</div>
          ) : null}
          {agentCalls.map((call) => (
            <div className="agc" key={call.id}>
              <div className="agh">
                <div className="agdot" />
                <span className="agn">⑂ {call.tool}</span>
                <span className="ags">{call.status}</span>
              </div>
              <div className="agt">{call.prompt ?? "Subagent activity"}</div>
              {call.receiverThreadIds.map((threadId) => {
                const state = call.agentsStates[threadId];
                const width = state?.status === "completed" ? 100 : state?.status === "running" ? 58 : 18;
                return (
                  <div className="agent-progress" key={threadId}>
                    <div className="agent-progress-header">
                      <span>{threadId.slice(0, 12)}</span>
                      <span>{state?.status ?? "pending"}</span>
                    </div>
                    <div className="agprog">
                      <div className="agbar" style={{ width: `${width}%` }} />
                    </div>
                    <div className="agent-progress-copy">{state?.message ?? "No update yet."}</div>
                  </div>
                );
              })}
            </div>
          ))}
          {subAgentThreads.map((thread) => (
            <div className="agc" key={thread.thread.id}>
              <div className="agh">
                <div className="agdot" />
                <span className="agn">⑂ {thread.thread.agentNickname ?? threadLabelById[thread.thread.id] ?? threadLabel(thread.thread)}</span>
                <span className="ags">{thread.thread.status.type}</span>
              </div>
              <div className="agt">{thread.thread.agentRole ?? "Subagent thread"}</div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div>
        <ConfigPanel
          snapshot={snapshot}
          activeThreadLabel={activeThreadLabel}
          actions={actions}
          pushToast={pushToast}
          selectModel={selectModel}
        />
      </div>
    );
  };

  const renderQuickPicker = () => {
    if (!quickMode) {
      return null;
    }

    const isMentionLoading =
      quickMode === "mention" &&
      Boolean(activeThread) &&
      snapshot.directoryCatalogRoot !== (activeThread?.thread.cwd ?? null);
    const quickEmptyLabel =
      quickMode === "mention"
        ? isMentionLoading
          ? "Loading files from the current directory…"
          : "No files found for this query."
        : quickMode === "skill"
          ? "No skills matched."
          : "No commands matched.";

    return (
      <div id="slashpop" style={{ display: "block" }}>
        {filteredQuickEntries.length > 0
          ? filteredQuickEntries.map((entry, index) => (
              <button
                className={clsx("spi", index === quickIndex && "sel")}
                key={entry.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onQuickPick(entry);
                }}
              >
                <span className="sp-cmd">{entry.label}</span>
                <span className="sp-dsc">{entry.description}</span>
              </button>
            ))
          : (
            <div className="sp-empty">{quickEmptyLabel}</div>
          )}
      </div>
    );
  };

  return (
    <main className="codex-ui-shell">
      <header id="hdr">
        <button className="hb mbtn" type="button" onClick={() => setSidebarOpen((current) => !current)} title="Menu">
          ☰
        </button>
        <div className="logo">
          <div className="logo-ico">⬡</div>
          <span>Codex CLI</span>
        </div>
        <div className="hsep" />
        <button
          className={clsx("hbadge", APPROVAL_CLASS[activeUiApproval])}
          id="aprbadge"
          type="button"
          onClick={() => void cycleApproval()}
          title="Cycle approval mode"
        >
          {APPROVAL_LABELS[activeUiApproval]}
        </button>
        <button className="hb" type="button" onClick={() => setCommandOpen(true)} title="Command palette">
          ⌘
        </button>
        <button className="hb" type="button" onClick={() => openPanel("agents")} title="Multi-agent panel">
          ⑂
        </button>
        <button className="hb" type="button" onClick={() => openPanel("files")} title="Files and diff">
          📁
        </button>
        <button className="hb" type="button" onClick={() => openPanel("config")} title="Config and settings">
          ⚙
        </button>
        <button
          className="hmodel"
          id="hmodel"
          type="button"
          ref={modelButtonRef}
          onClick={() => setModelPickerOpen((current) => !current)}
        >
          <div className="mdot" />
          <span id="mlabel">{snapshot.settings.model}</span>
          <span className="hmodel-arrow">▾</span>
        </button>
      </header>

      <div id="layout">
        <button
          id="sbo"
          className={clsx(sidebarOpen && "show")}
          type="button"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />

        <aside id="sb" className={clsx(sidebarOpen && "open")}>
          <button className="snew" type="button" onClick={() => void createSession()}>
            ＋ New Session
          </button>
          <div className="shist">
            {(["Today", "Yesterday", "Earlier"] as const).map((group) =>
              groupedThreads[group].length > 0 ? (
                <div key={group}>
                  <div className="sgl">{group}</div>
                  {groupedThreads[group].map((entry) => (
                    <button
                      className={clsx("si", entry.thread.id === activeThreadId && "active")}
                      key={entry.thread.id}
                      type="button"
                      onClick={() => {
                        navigateToThread(entry.thread.id, "chat");
                        setSidebarOpen(false);
                      }}
                    >
                      <span>{entry.thread.agentNickname ? "⑂" : "💬"}</span>
                      <span className="si-t">{threadLabelById[entry.thread.id] ?? threadLabel(entry.thread)}</span>
                    </button>
                  ))}
                </div>
              ) : null,
            )}
          </div>
          <div className="sbot">
            <button className="slink" type="button" onClick={() => setCommandOpen(true)}>
              <span>⌘</span>
              <span>Command palette</span>
              <span className="skbd">⌘K</span>
            </button>
            <button className="slink" type="button" onClick={() => void runSlash("/review")}>
              <span>🔍</span>
              <span>/review working tree</span>
            </button>
            <button className="slink" type="button" onClick={() => void runSlash("/fork")}>
              <span>⑂</span>
              <span>/fork session</span>
            </button>
            <button className="slink" type="button" onClick={() => void runSlash("/compact")}>
              <span>🗜</span>
              <span>/compact transcript</span>
            </button>
            <button className="slink" type="button" onClick={() => fillComposer("/init Generate AGENTS.md scaffold")}>
              <span>📋</span>
              <span>/init AGENTS.md</span>
            </button>
            <button className="slink" type="button" onClick={() => openPanel("config")}>
              <span>⚙</span>
              <span>config.toml</span>
            </button>
          </div>
        </aside>

        <section id="main">
          <div id="tabs">
            {visibleTabIds.map((threadId) => {
              const threadRecord = uniqueThreads.find((entry) => entry.thread.id === threadId);
              const thread = threadRecord?.thread;
              if (!threadRecord || !thread) {
                return null;
              }

              return (
                <button
                  className={clsx("tab", threadId === activeThreadId && "active")}
                  data-i={threadId}
                  key={threadId}
                  type="button"
                  onClick={() => navigateToThread(threadId, "chat")}
                >
                  <span>{thread.agentNickname ? "⑂" : "💬"}</span>
                  <span>{shorten(threadLabelById[threadRecord.thread.id] ?? threadLabel(threadRecord.thread), 18)}</span>
                  <span
                    className="tab-x"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeTab(threadId);
                    }}
                  >
                    ×
                  </span>
                </button>
              );
            })}
            <button className="tabadd" type="button" onClick={() => void createSession()} title="New session">
              +
            </button>
          </div>

          <div id="chat" ref={chatRef}>
            <ChatTranscript
              activeThread={activeThread}
              activeThreadLabel={activeThreadLabel}
              activeTurns={activeTurns}
              existingThreadHistoryPending={existingThreadHistoryPending}
              activeThreadTimeLabel={activeThreadTimeLabel}
              streamVisible={streamVisible}
              liveOverlay={liveOverlay}
              onReview={reviewDiff}
              onFill={fillComposer}
              onSlash={triggerSlash}
              onCopy={handleCopy}
              onFork={forkSession}
              onPlan={triggerPlan}
              onEdit={fillComposer}
              onContext={openItemContextMenu}
            />
            <div aria-hidden="true" ref={chatEndRef} />
          </div>

          <div id="ia">
            {selectedSkills.length > 0 || selectedFiles.length > 0 || selectedImages.length > 0 ? (
              <div id="ctx-row">
                {selectedSkills.map((skill) => (
                  <div className="ctag" key={skill.id}>
                    <span>📋</span>
                    <span>${skill.name}</span>
                    <button className="ctx-x" type="button" onClick={() => removeSkill(skill.id)}>
                      ×
                    </button>
                  </div>
                ))}
                {selectedFiles.map((file) => (
                  <div className="ctag" key={file.id}>
                    <span>📄</span>
                    <span>{file.name}</span>
                    <button className="ctx-x" type="button" onClick={() => removeUploadedFile(file.id)}>
                      ×
                    </button>
                  </div>
                ))}
                {selectedImages.map((image) => (
                  <div className="ctag" key={image.id}>
                    <span>🖼</span>
                    <span>{image.name}</span>
                    <button className="ctx-x" type="button" onClick={() => removeImage(image.id)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

              {activeQueuedMessages.length > 0 ? (
                <QueuedMessagesStrip
                  messages={activeQueuedMessages}
                  onDelete={(messageId) => activeThreadId && removeQueuedMessage(activeThreadId, messageId)}
                  onSteer={steerQueuedMessage}
                />
              ) : null}

              <div id="ib" className={clsx(activeQueuedMessages.length > 0 && "queue-open")}>
                <div id="toolbar">
                <button className={clsx("tbtn", toolbarAuto && "on")} type="button" onClick={() => setToolbarAuto((current) => !current)}>
                  ⚡ Auto
                </button>
                <button
                  className={clsx("tbtn", toolbarPlan && "on")}
                  type="button"
                  onClick={async () => {
                    const next = !toolbarPlan;
                    setToolbarPlan(next);
                  }}
                >
                  /plan
                </button>
                <div className="tsep2" />
                <button className="tbtn" type="button" onClick={() => {
                  setQuickMode("mention");
                  setQuickQuery("");
                  setQuickIndex(0);
                  textareaRef.current?.focus();
                }}>
                  📎 /mention
                </button>
                <button className="tbtn" type="button" onClick={() => uploadFileInputRef.current?.click()}>
                  📄 File
                </button>
                <button className="tbtn" type="button" onClick={() => imageInputRef.current?.click()}>
                  🖼 Image
                </button>
                <button className={clsx("tbtn", toolbarShell && "on")} type="button" onClick={() => setToolbarShell((current) => !current)}>
                  $ Shell
                </button>
                <button
                  className={clsx("tbtn", snapshot.settings.webSearch && "on")}
                  type="button"
                  onClick={() => void actions.updateSettings({ webSearch: !snapshot.settings.webSearch })}
                >
                  🔍 Web
                </button>
                <div className="tsep2" />
                <button
                  className={clsx("tbtn", composerMode === "review" && "on")}
                  type="button"
                  onClick={() => setComposerMode((current) => (current === "review" ? "chat" : "review"))}
                >
                  🔎 Review
                </button>
                <button className="tbtn" type="button" onClick={() => openPanel("agents")}>
                  ⑂ Agents
                </button>
                <button className="tbtn" type="button" onClick={() => void compactSession()}>
                  🗜 Compact
                </button>
                <button className="tbtn" type="button" onClick={() => pushToast("Ctrl+G — opening editor bridge", "")}>
                  ✏ Editor
                </button>
                </div>

                <div id="irow">
                  <ComposerTextarea
                    composerMirrorRef={composerMirrorRef}
                    mentions={selectedMentions}
                    onKeyDown={onComposerKeyDown}
                    onValueChange={onComposerChange}
                    placeholder={composerPlaceholder}
                    textareaRef={textareaRef}
                    value={composer}
                  />
                <button
                  id="sendbtn"
                  className={clsx(activeTurn && "queue")}
                  type="button"
                  onClick={() => void submitComposer(textareaRef.current?.value)}
                >
                  {composerActionLabel}
                </button>
                <button
                  id="stopbtn"
                  style={{ display: activeTurn ? "flex" : "none" }}
                  type="button"
                  onClick={() => void onStopTurn()}
                >
                  ◼
                </button>
              </div>

              {renderQuickPicker()}

              <div id="ifooter">
                <select
                  id="msel"
                  value={activeUiApproval}
                  onChange={(event) => void actions.updateSettings(settingsPatchFromApprovalMode(event.target.value as UiApprovalMode))}
                >
                  <option value="auto">auto (default)</option>
                  <option value="ro">read-only</option>
                  <option value="fa">full-access (--yolo)</option>
                </select>
                {activeTurn ? <span className="composer-live-note">Active turn running. Sending now queues a follow-up.</span> : null}
                <span>⏎ send · ⇧⏎ newline</span>
                <span>/cmds · $skills · !shell</span>
                <span id="tokcount">{currentTokenCount} / 200k ctx</span>
              </div>
            </div>
          </div>
        </section>

        <aside id="rp" className={clsx(panelOpen && "open")}>
          <div className="rph">
            <span className="rpt" id="rp-title">
              {PANEL_TITLE[panelTab]}
            </span>
            <button className="rpclose" type="button" onClick={closePanel}>
              ×
            </button>
          </div>
          <div className="rptabs" id="rptabs">
            {(["files", "diff", "terminal", "agents", "config"] as const).map((tab) => (
              <button
                className={clsx("rptab", panelTab === tab && "active")}
                key={tab}
                type="button"
                onClick={() => setPanelTab(tab)}
              >
                {PANEL_TITLE[tab]}
              </button>
            ))}
          </div>
          <div className="rpbody" id="rpbody">
            {renderPanelBody()}
          </div>
        </aside>
      </div>

      <div id="statusbar">
        <div className="sbi">
          <div className={clsx("sbd", statusTone(snapshot.transport.status))} />
          {snapshot.transport.status === "connected" ? "Connected" : snapshot.transport.status}
        </div>
        <div className="sbi">📁 {activeThread?.thread.cwd ?? "/home/allan"}</div>
        <div className="sbi">⑂ {activeThread?.thread.gitInfo?.branch ?? "workspace"}</div>
        <div className="sbi" id="sb-st">
          {activeTurn ? "Streaming…" : snapshot.transport.status === "connected" ? "Ready" : "Mock mode"}
        </div>
        <div className="sbi" id="sb-model">
          ⬡ {snapshot.settings.model}
        </div>
        <div className="sbi">{APPROVAL_LABELS[activeUiApproval].toLowerCase()} · {snapshot.settings.sandboxMode}</div>
      </div>

      {modelPickerOpen ? (
        <div
          id="mpicker"
          style={{
            display: "block",
            top: `${(modelButtonRef.current?.getBoundingClientRect().bottom ?? 48) + 4}px`,
            right: `${Math.max(12, window.innerWidth - (modelButtonRef.current?.getBoundingClientRect().right ?? window.innerWidth - 12))}px`,
            left: "auto",
          }}
        >
          {modelOptions.map((entry, index) => (
            <div className="mpi" key={entry.id} onClick={() => void selectModel(entry.id)} onKeyDown={() => undefined} role="button" tabIndex={0}>
              <div className="mpi-n">
                {entry.displayName}
                {entry.id === snapshot.settings.model ? (
                  <>
                    {" "}
                    ✓ <span className="model-rec">active</span>
                  </>
                ) : null}
              </div>
              <div className="mpi-d">{entry.description}</div>
              {index < modelOptions.length - 1 ? <div className="mpsep" /> : null}
            </div>
          ))}
        </div>
      ) : null}

      {commandOpen ? (
        <div id="cmo" className="show" onClick={(event) => event.target === event.currentTarget && setCommandOpen(false)}>
          <div id="cmp">
            <div className="cmr">
              <span className="cm-ico">⌘</span>
              <input
                id="cminput"
                autoFocus
                placeholder="Search commands, slash commands, models…"
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setCommandOpen(false);
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const first = commandPaletteGroups[0]?.items[0];
                    if (first) {
                      setCommandOpen(false);
                      first.action();
                    }
                  }
                }}
              />
            </div>
            <div className="cmlist" id="cmlist">
              {commandPaletteGroups.length === 0 ? (
                <div className="empty-command">No results</div>
              ) : (
                commandPaletteGroups.map((group) => (
                  <div key={group.label}>
                    <div className="cmgl">{group.label}</div>
                    {group.items.map((item) => (
                      <button
                        className="cmi"
                        key={`${group.label}-${item.name}`}
                        type="button"
                        onClick={() => {
                          setCommandOpen(false);
                          item.action();
                        }}
                      >
                        <span>{item.icon}</span>
                        <span className="cmi-nm">{item.name}</span>
                        {item.key ? <span className="cmkbd">{item.key}</span> : null}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          id="ctxmenu"
          className="show"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        >
          <button
            className="ctxi"
            type="button"
            onClick={() => {
              const item = contextMenu.item;
              if (item?.type === "agentMessage") {
                void copyText(item.text).then(() => pushToast("Copied", "ok"));
              }
              if (item?.type === "userMessage") {
                void copyText(getUserText(item)).then(() => pushToast("Copied", "ok"));
              }
              setContextMenu(null);
            }}
          >
            📋 Copy message
          </button>
          <button
            className="ctxi"
            type="button"
            onClick={() => {
              const item = contextMenu.item;
              if (item?.type === "agentMessage") {
                fillComposer(item.text);
              }
              if (item?.type === "userMessage") {
                fillComposer(getUserText(item));
              }
              setContextMenu(null);
            }}
          >
            ✏ Edit &amp; resend
          </button>
          <button className="ctxi" type="button" onClick={() => {
            if (latestAgentMessage) {
              fillComposer(latestAgentMessage.text);
            }
            setContextMenu(null);
          }}>
            🔄 Regenerate
          </button>
          <div className="ctxs" />
          <button className="ctxi" type="button" onClick={() => {
            void forkSession();
            setContextMenu(null);
          }}>
            ⑂ /fork from here
          </button>
          <button className="ctxi" type="button" onClick={() => {
            void runSlash("/plan");
            setContextMenu(null);
          }}>
            📋 /plan from here
          </button>
          <button className="ctxi" type="button" onClick={() => {
            setQuickMode("mention");
            setQuickQuery("");
            setContextMenu(null);
          }}>
            📎 /mention file
          </button>
          <div className="ctxs" />
          <button className="ctxi danger" type="button" onClick={() => {
            pushToast("Deleted", "");
            setContextMenu(null);
          }}>
            🗑 Delete
          </button>
        </div>
      ) : null}

      <div id="toasts">
        {toasts.map((toast) => (
          <div className={clsx("toast", toast.tone)} key={toast.id}>
            {toast.message}
          </div>
        ))}
      </div>

      <input
        ref={uploadFileInputRef}
        className="hidden-input"
        type="file"
        multiple
        onChange={onUploadFilesChosen}
      />

      <input
        ref={imageInputRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        multiple
        onChange={onImagesChosen}
      />
    </main>
  );
}

function WelcomeState({
  onFill,
  onSlash,
}: {
  onFill: (value: string) => void;
  onSlash: (value: string) => void;
}) {
  return (
    <div className="ww">
      <div className="wico">⬡</div>
      <h1>Codex CLI</h1>
      <p>Agentic coding assistant — reads repos, patches files, runs sandboxed commands, streams live turns, and tracks operational state inline.</p>
      <div className="wbadges">
        <div className="wbadge">⚡ Live stream</div>
        <div className="wbadge">🔍 Web search</div>
        <div className="wbadge">⑂ Multi-agent</div>
        <div className="wbadge">🔧 MCP tools</div>
        <div className="wbadge">📋 Skills ($)</div>
        <div className="wbadge">apply_patch</div>
        <div className="wbadge">/ 25 slash cmds</div>
      </div>
      <div className="wsug">
        <button className="sug" type="button" onClick={() => onFill("Refactor the auth middleware to use JWT properly with full TypeScript types")}>
          <div className="sug-i">⚡</div>
          <div className="sug-t">Refactor code</div>
          <div className="sug-d">apply_patch + diffs</div>
        </button>
        <button className="sug" type="button" onClick={() => onSlash("/review")}>
          <div className="sug-i">🔍</div>
          <div className="sug-t">/review</div>
          <div className="sug-d">Audit working tree</div>
        </button>
        <button className="sug" type="button" onClick={() => onFill("Write Jest unit tests for the auth service with 80%+ coverage")}>
          <div className="sug-i">🧪</div>
          <div className="sug-t">Write tests</div>
          <div className="sug-d">Jest + coverage</div>
        </button>
        <button className="sug" type="button" onClick={() => onSlash("/init")}>
          <div className="sug-i">📋</div>
          <div className="sug-t">/init</div>
          <div className="sug-d">Generate AGENTS.md</div>
        </button>
      </div>
      <p className="welcome-foot">/slash cmds · $skills · @file or /mention · !shell · ⌘K palette · Ctrl+G editor</p>
    </div>
  );
}

function LoadingConversationState({ threadLabelText }: { threadLabelText: string }) {
  return (
    <div className="ww">
      <div className="wico">…</div>
      <h1>Loading conversation</h1>
      <p>
        Reattaching this saved thread and pulling its history into the transcript.
      </p>
      <div className="wbadges">
        <div className="wbadge">Thread</div>
        <div className="wbadge">{shorten(threadLabelText, 42)}</div>
        <div className="wbadge">History sync</div>
      </div>
      <p className="welcome-foot">The starter cards are hidden until the saved turns are loaded.</p>
    </div>
  );
}

function QueuedMessagesStrip({
  messages,
  onSteer,
  onDelete,
}: {
  messages: Array<QueuedComposerMessage>;
  onSteer: (messageId: string) => void;
  onDelete: (messageId: string) => void;
}) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="queued-messages">
      <div className="queued-messages-inner">
        {messages.map((message) => {
          const fallbackText =
            message.prompt.trim() ||
            [
              message.images.length > 0 ? `${message.images.length} image` : "",
              message.files.length > 0 ? `${message.files.length} upload` : "",
              message.mentions.length > 0 ? `${message.mentions.length} file` : "",
              message.skills.length > 0 ? `${message.skills.length} skill` : "",
            ]
              .filter(Boolean)
              .join(" · ");

          return (
            <div className="queued-row" key={message.id}>
              <span className="queued-row-icon">💬</span>
              <span className="queued-row-text">{shorten(fallbackText || "Queued follow-up", 96)}</span>
              <div className="queued-row-actions">
                <button className="queued-row-steer" type="button" onClick={() => onSteer(message.id)}>
                  Steer
                </button>
                <button className="queued-row-delete" type="button" aria-label="Delete queued message" onClick={() => onDelete(message.id)}>
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ComposerTextarea = memo(function ComposerTextarea({
  value,
  mentions,
  placeholder,
  textareaRef,
  composerMirrorRef,
  onValueChange,
  onKeyDown,
}: {
  value: string;
  mentions: Array<MentionAttachment>;
  placeholder: string;
  textareaRef: { current: HTMLTextAreaElement | null };
  composerMirrorRef: { current: HTMLDivElement | null };
  onValueChange: (value: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const pendingDraftRef = useRef(value);

  useEffect(() => {
    if (value === pendingDraftRef.current) {
      return;
    }

    pendingDraftRef.current = value;
    setDraft(value);
  }, [value]);

  const activeMentions = useMemo(
    () => mentions.filter((mention) => composerHasMentionToken(draft, mention)),
    [draft, mentions],
  );
  const highlightSegments = useMemo(
    () => (activeMentions.length > 0 ? buildComposerHighlightSegments(draft, activeMentions) : []),
    [activeMentions, draft],
  );

  const syncMirrorScroll = useCallback(() => {
    if (activeMentions.length === 0) {
      return;
    }

    const textarea = textareaRef.current;
    const mirror = composerMirrorRef.current;
    if (!textarea || !mirror) {
      return;
    }

    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
  }, [activeMentions.length, composerMirrorRef, textareaRef]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) {
      return;
    }

    if (!draft) {
      node.style.height = "24px";
    } else {
      node.style.height = "auto";
      node.style.height = `${Math.min(node.scrollHeight, 140)}px`;
    }

    syncMirrorScroll();
  }, [draft, syncMirrorScroll, textareaRef]);

  const handleChange = useCallback(
    (event: ReactChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      pendingDraftRef.current = next;
      setDraft(next);
      onValueChange(next);
    },
    [onValueChange],
  );

  return (
    <div className="composer-text-shell">
      {activeMentions.length > 0 ? (
        <div className="composer-mirror" ref={composerMirrorRef} aria-hidden="true">
          {draft
            ? highlightSegments.map((segment, index) => (
                <span className={clsx("composer-segment", segment.mention && "file")} key={`${segment.text}-${index}`}>
                  {segment.text}
                </span>
              ))
            : null}
        </div>
      ) : null}
      {!draft ? <span className="composer-placeholder">{placeholder}</span> : null}
      <textarea
        id="ta"
        ref={textareaRef}
        rows={1}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        placeholder=""
        spellCheck={false}
        value={draft}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onScroll={syncMirrorScroll}
      />
    </div>
  );
});

const ChatTranscript = memo(function ChatTranscript({
  activeThread,
  activeThreadLabel,
  activeTurns,
  existingThreadHistoryPending,
  activeThreadTimeLabel,
  streamVisible,
  liveOverlay,
  onReview,
  onFill,
  onSlash,
  onCopy,
  onFork,
  onPlan,
  onEdit,
  onContext,
}: {
  activeThread: ThreadRecord | null;
  activeThreadLabel: string;
  activeTurns: Array<Turn>;
  existingThreadHistoryPending: boolean;
  activeThreadTimeLabel: string;
  streamVisible: Record<string, number>;
  liveOverlay: UiLiveOverlay | null;
  onReview: (diffId?: string) => void;
  onFill: (value: string) => void;
  onSlash: (value: string) => void;
  onCopy: (value: string) => void;
  onFork: () => void;
  onPlan: () => void;
  onEdit: (value: string) => void;
  onContext: (event: ReactMouseEvent<HTMLElement>, item: ThreadItem) => void;
}) {
  if (!activeThread) {
    return <WelcomeState onFill={onFill} onSlash={onSlash} />;
  }

  if (existingThreadHistoryPending) {
    return <LoadingConversationState threadLabelText={activeThreadLabel} />;
  }

  if (activeTurns.length === 0) {
    return <WelcomeState onFill={onFill} onSlash={onSlash} />;
  }

  const liveTurn = [...activeTurns].reverse().find((turn) => turn.status === "inProgress") ?? null;
  const hasRenderableLiveItems =
    liveTurn?.items.some((item) => {
      if (item.type === "agentMessage") {
        return item.text.trim().length > 0;
      }

      return item.type === "commandExecution" || item.type === "fileChange";
    }) ?? false;
  const shouldShowLiveOverlay = Boolean(
    liveOverlay && (liveOverlay.reasoningText || liveOverlay.errorText || !hasRenderableLiveItems),
  );

  return (
    <>
      {activeTurns.map((turn) => (
        <div className="turn-block" key={turn.id}>
          {turn.items.map((item) => (
            <ThreadItemView
              item={item}
              key={item.id}
              turnStatus={turn.status}
              threadTimeLabel={activeThreadTimeLabel}
              textVisible={item.type === "agentMessage" ? streamVisible[`${item.id}:text`] : undefined}
              outputVisible={item.type === "commandExecution" ? streamVisible[`${item.id}:aggregatedOutput`] : undefined}
              onCopy={onCopy}
              onFork={onFork}
              onPlan={onPlan}
              onReview={onReview}
              onEdit={onEdit}
              onContext={onContext}
            />
          ))}
        </div>
      ))}
      {shouldShowLiveOverlay ? <LiveOverlayCard overlay={liveOverlay!} /> : null}
    </>
  );
});

const commandStatusLabel = (item: Extract<ThreadItem, { type: "commandExecution" }>) => {
  switch (item.status) {
    case "inProgress":
      return "⟳ Running";
    case "completed":
      return item.exitCode === 0 ? "✓ Completed" : `✗ Exit ${item.exitCode ?? "?"}`;
    case "failed":
      return "✗ Failed";
    case "declined":
      return "⊘ Declined";
    default:
      return item.status;
  }
};

const commandStatusTone = (item: Extract<ThreadItem, { type: "commandExecution" }>) => {
  if (item.status === "inProgress") {
    return "run";
  }

  if (item.status === "completed" && item.exitCode === 0) {
    return "ok";
  }

  return "err";
};

const LiveOverlayCard = memo(function LiveOverlayCard({ overlay }: { overlay: UiLiveOverlay }) {
  const reasoningRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (reasoningRef.current) {
      reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
    }
  }, [overlay.reasoningText]);

  return (
    <div className="live-overlay-card">
      <div className="live-overlay-label">{overlay.activityLabel}</div>
      {overlay.activityDetails.length > 0 ? (
        <div className="live-overlay-details">
          {overlay.activityDetails.map((detail, index) => (
            <code className="live-overlay-detail" key={`${detail}-${index}`}>
              {detail}
            </code>
          ))}
        </div>
      ) : null}
      {overlay.reasoningText ? (
        <p className="live-overlay-reasoning" ref={reasoningRef}>
          {overlay.reasoningText}
        </p>
      ) : null}
      {overlay.errorText ? <p className="live-overlay-error">{overlay.errorText}</p> : null}
    </div>
  );
});

const MessageInlineFlow = memo(function MessageInlineFlow({ text }: { text: string }) {
  const segments = useMemo(() => parseInlineSegments(text), [text]);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return <span key={`text-${index}`}>{segment.value}</span>;
        }

        if (segment.kind === "code") {
          return (
            <code className="message-inline-code" key={`code-${index}`}>
              {segment.value}
            </code>
          );
        }

        const href = toBrowseUrl(segment.path);
        if (href === "#") {
          return (
            <code className="message-inline-code" key={`file-${index}`}>
              {segment.displayPath}
            </code>
          );
        }

        return (
          <a
            className="message-file-link"
            href={href}
            key={`file-${index}`}
            rel="noreferrer noopener"
            target="_blank"
            title={segment.path}
          >
            {segment.displayPath}
          </a>
        );
      })}
    </>
  );
});

function MessageImagePreview({
  url,
  alt,
  markdown,
  className,
}: {
  url: string;
  alt: string;
  markdown?: string;
  className?: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (loadFailed && markdown) {
    return <p className="message-text">{markdown}</p>;
  }

  return (
    <a className="message-image-link" href={url} rel="noreferrer noopener" target="_blank">
      <img
        alt={alt}
        className={clsx("message-image-preview", className)}
        loading="lazy"
        onError={() => setLoadFailed(true)}
        src={url}
      />
    </a>
  );
}

const MessageTextFlow = memo(function MessageTextFlow({ text }: { text: string }) {
  const blocks = useMemo(() => parseMessageBlocks(text), [text]);

  return (
    <div className="message-text-flow">
      {blocks.map((block, index) => {
        if (block.kind === "image") {
          return (
            <MessageImagePreview
              alt={block.alt || "Embedded message image"}
              className="message-markdown-image"
              key={`image-${index}`}
              markdown={block.markdown}
              url={block.url}
            />
          );
        }

        if (!block.value) {
          return null;
        }

        return (
          <p className="message-text" key={`text-${index}`}>
            <MessageInlineFlow text={block.value} />
          </p>
        );
      })}
    </div>
  );
});

const ThreadItemView = memo(function ThreadItemView({
  item,
  turnStatus,
  threadTimeLabel,
  textVisible,
  outputVisible,
  onCopy,
  onFork,
  onPlan,
  onReview,
  onEdit,
  onContext,
}: {
  item: ThreadItem;
  turnStatus: Turn["status"];
  threadTimeLabel: string;
  textVisible?: number;
  outputVisible?: number;
  onCopy: (value: string) => void;
  onFork: () => void;
  onPlan: () => void;
  onReview: (diffId?: string) => void;
  onEdit: (value: string) => void;
  onContext: (event: ReactMouseEvent<HTMLElement>, item: ThreadItem) => void;
}) {
  const [commandExpanded, setCommandExpanded] = useState(item.type === "commandExecution" ? item.status === "inProgress" : false);
  const previousCommandStatusRef = useRef<string | null>(item.type === "commandExecution" ? item.status : null);

  useEffect(() => {
    if (item.type !== "commandExecution") {
      previousCommandStatusRef.current = null;
      return;
    }

    let collapseTimer: number | null = null;

    if (item.status === "inProgress") {
      setCommandExpanded(true);
    } else if (previousCommandStatusRef.current === "inProgress") {
      collapseTimer = window.setTimeout(() => setCommandExpanded(false), 1000);
    }

    previousCommandStatusRef.current = item.status;

    return () => {
      if (collapseTimer !== null) {
        window.clearTimeout(collapseTimer);
      }
    };
  }, [item.type, item.type === "commandExecution" ? item.status : null]);

  if (item.type === "userMessage") {
    const display = getUserMessageDisplay(item);
    const extraAttachments = item.content.filter((entry) => entry.type === "mention" || entry.type === "skill");

    return (
      <div className="msg user" onContextMenu={(event) => onContext(event, item)}>
        <div className="mb">
          {display.images.length > 0 ? (
            <div className="message-image-list">
              {display.images.map((imageUrl, index) => {
                const renderableUrl = toRenderableImageUrl(imageUrl);
                if (!renderableUrl) {
                  return null;
                }

                return (
                  <MessageImagePreview
                    alt="Message image preview"
                    key={`${item.id}-image-${index}`}
                    url={renderableUrl}
                  />
                );
              })}
            </div>
          ) : null}
          {display.fileAttachments.length > 0 || extraAttachments.length > 0 ? (
            <div className="attachment-row">
              {display.fileAttachments.map((attachment) => {
                const href = toBrowseUrl(attachment.path);
                const attachmentLabel = attachmentDisplayLabel(attachment.label, attachment.path);
                return (
                  <span className="attachment-chip" key={`${item.id}-file-${attachment.path}`}>
                    <span>📄</span>
                    {href === "#" ? (
                      <span>{attachmentLabel}</span>
                    ) : (
                      <a className="message-file-link attachment-chip-link" href={href} rel="noreferrer noopener" target="_blank" title={attachment.path}>
                        {attachmentLabel}
                      </a>
                    )}
                  </span>
                );
              })}
              {extraAttachments.map((attachment) => (
                <span className="attachment-chip" key={`${item.id}-${attachment.type}-${attachment.name}`}>
                  <span>{attachment.type === "skill" ? "📋" : "📄"}</span>
                  <span>{attachment.name}</span>
                </span>
              ))}
            </div>
          ) : null}
          {display.text ? <MessageTextFlow text={display.text} /> : null}
          <div className="msg-time">{threadTimeLabel}</div>
        </div>
        <div className="macts">
          <button className="mact" type="button" onClick={() => onCopy(display.text)}>
            📋 Copy
          </button>
          <button className="mact" type="button" onClick={() => onEdit(display.text)}>
            ✏ Edit
          </button>
        </div>
      </div>
    );
  }

  if (item.type === "agentMessage") {
    const text = typeof textVisible === "number" ? item.text.slice(0, textVisible) : item.text;
    const streaming = typeof textVisible === "number" && textVisible < item.text.length;

    return (
      <div className="msg" onContextMenu={(event) => onContext(event, item)}>
        <div className="mh">
          <div className="mav a">⬡</div>
          <span className="mn">Codex</span>
          <span className="mt">{turnStatus === "inProgress" ? "live" : turnStatus}</span>
        </div>
        <div className="mb">
          {text ? <MessageTextFlow text={text} /> : null}
          {streaming ? <div className="live-cursor" /> : null}
        </div>
        <div className="macts">
          <button className="mact" type="button" onClick={() => onFork()}>
            ⑂ /fork
          </button>
          <button className="mact" type="button" onClick={() => onPlan()}>
            📋 /plan
          </button>
          <button className="mact" type="button" onClick={() => onCopy(item.text)}>
            📋
          </button>
        </div>
      </div>
    );
  }

  if (item.type === "reasoning") {
    return null;
  }

  if (item.type === "plan") {
    return (
      <div className="compact-bar">
        <span className="compact-ico">📋</span>
        <span>{item.text}</span>
      </div>
    );
  }

  if (item.type === "commandExecution") {
    const output =
      typeof outputVisible === "number" && item.aggregatedOutput
        ? item.aggregatedOutput.slice(0, outputVisible)
        : item.aggregatedOutput ?? "";
    const badge = commandStatusTone(item);

    return (
      <div className="cmd-inline">
        <button className={clsx("cmd-inline-row", badge, commandExpanded && "open")} type="button" onClick={() => setCommandExpanded((current) => !current)}>
          <span className={clsx("cmd-inline-chevron", commandExpanded && "open")}>▶</span>
          <code className="cmd-inline-label">{item.command || "(command)"}</code>
          <span className="cmd-inline-status">{commandStatusLabel(item)}</span>
        </button>
        {commandExpanded ? (
          <div className="cmd-inline-output">
            <div className="cmd-inline-meta">{item.cwd} · {item.processId ?? "pty"}</div>
            <pre>{output || "(no output)"}</pre>
          </div>
        ) : null}
      </div>
    );
  }

  if (item.type === "fileChange") {
    return <DiffCard item={item} onReview={onReview} />;
  }

  if (item.type === "mcpToolCall") {
    const body = item.result ? JSON.stringify(item.result.structuredContent ?? item.result.content ?? {}, null, 2) : item.error?.message ?? "No output";
    return (
      <div className={clsx("tool", item.error ? "err" : "ok")}>
        <div className="tool-h">
          {item.error ? "✗" : "✓"} MCP · {item.server}/{item.tool}
          <span className="tbadge">{item.status}</span>
        </div>
        <div className="tool-b">
          <pre className="tool-pre">{body}</pre>
        </div>
      </div>
    );
  }

  if (item.type === "dynamicToolCall") {
    return (
      <div className={clsx("tool", item.success ? "ok" : "run")}>
        <div className="tool-h">
          {item.success ? "✓" : "↻"} Tool · {item.tool}
          <span className="tbadge">{item.status}</span>
        </div>
        <div className="tool-b">
          {item.contentItems?.map((entry, index) => (
            <div key={`${item.id}-${index}`}>{JSON.stringify(entry)}</div>
          )) ?? "No tool payload."}
        </div>
      </div>
    );
  }

  if (item.type === "collabAgentToolCall") {
    return (
      <div className="agc">
        <div className="agh">
          <div className="agdot" />
          <span className="agn">⑂ {item.tool}</span>
          <span className="ags">{item.status}</span>
        </div>
        <div className="agt">{item.prompt ?? "Subagent activity"}</div>
        <div className="agprog">
          <div className="agbar" style={{ width: item.status === "completed" ? "100%" : "58%" }} />
        </div>
      </div>
    );
  }

  if (item.type === "webSearch") {
    return (
      <div className="tool ok">
        <div className="tool-h">
          ✓ Web search
          <span className="tbadge">search</span>
        </div>
        <div className="tool-b">{item.query}</div>
      </div>
    );
  }

  if (item.type === "imageView") {
    return (
      <div className="image-card">
        <div className="tool-h">
          🖼 Image
          <span className="tbadge">view</span>
        </div>
        <div className="tool-b">{item.path}</div>
      </div>
    );
  }

  if (item.type === "imageGeneration") {
    return (
      <div className="tool ok">
        <div className="tool-h">
          ✓ Image generation
          <span className="tbadge">{item.status}</span>
        </div>
        <div className="tool-b">
          <div>{item.revisedPrompt}</div>
          <div>{item.result}</div>
        </div>
      </div>
    );
  }

  if (item.type === "enteredReviewMode" || item.type === "exitedReviewMode") {
    return (
      <div className="compact-bar">
        <span className="compact-ico">{item.type === "enteredReviewMode" ? "🔍" : "✓"}</span>
        <span>{item.review}</span>
      </div>
    );
  }

  if (item.type === "contextCompaction") {
    return (
      <div className="compact-bar">
        <span className="compact-ico">🗜</span>
        <span>Conversation compacted to free context tokens.</span>
      </div>
    );
  }

  return null;
});

function DiffCard({
  item,
  onReview,
}: {
  item: Extract<ThreadItem, { type: "fileChange" }>;
  onReview: (diffId?: string) => void;
}) {
  const liveLabel =
    item.status === "inProgress"
      ? "editing"
      : item.status === "completed"
        ? "applied"
        : item.status === "failed"
          ? "failed"
          : item.status;
  const changes =
    item.changes.length > 0
      ? item.changes
      : [
          {
            path: "Editing files",
            kind: { type: "update", move_path: null } as const,
            diff: "",
          },
        ];

  return (
    <>
      {changes.map((change, index) => (
        <div className={clsx("dw", item.status === "inProgress" && "live")} key={`${item.id}-${change.path}-${index}`}>
          <div className="dh">
            📄 {change.path}
            <div className="diff-head-actions">
              <button className="diff-review" type="button" onClick={() => onReview(diffEntryId(item.id, index, change.path))}>
                Review diff
              </button>
              <span className="dstats">
                {change.kind.type === "add" ? <span className="diff-new">new</span> : null}
                {change.kind.type === "update" ? <span className="diff-mod">mod</span> : null}
                {change.kind.type === "delete" ? <span className="diff-del">del</span> : null}
                <span className={clsx("diff-status", item.status === "inProgress" && "live", item.status === "failed" && "err")}>{liveLabel}</span>
              </span>
            </div>
          </div>
          {change.diff ? (
            change.diff.split("\n").map((line, lineIndex) => (
              <div
                className={clsx(
                  "dl",
                  line.startsWith("+") && "add",
                  line.startsWith("-") && "rem",
                  !line.startsWith("+") && !line.startsWith("-") && "ctx",
                )}
                key={`${change.path}-${lineIndex}`}
              >
                {line}
              </div>
            ))
          ) : (
            <div className="dl ctx">Waiting for diff…</div>
          )}
        </div>
      ))}
    </>
  );
}

function DiffPatchViewer({ entry }: { entry: DiffReviewEntry }) {
  const rows = buildDiffReviewLines(entry.diff);

  if (rows.length === 0) {
    return <div className="diff-patch-empty">Waiting for diff…</div>;
  }

  return (
    <div className="diff-patch-viewer">
      {rows.map((row) => (
        <div className={clsx("diff-patch-row", row.kind)} key={row.id}>
          <span className="diff-patch-num">{row.oldLine ?? ""}</span>
          <span className="diff-patch-num">{row.newLine ?? ""}</span>
          <pre className="diff-patch-text">{row.text || " "}</pre>
        </div>
      ))}
    </div>
  );
}

function FileEditorPreview({ preview }: { preview: FilePreviewState }) {
  const lines = preview.loading || preview.error ? [] : preview.content.split("\n");
  const browseHref = toBrowseUrl(preview.path);

  return (
    <div className="file-editor">
      <div className="file-editor-head">
        <div className="file-editor-copy">
          <div className="file-editor-title">{preview.name}</div>
          <div className="file-editor-path">{preview.path}</div>
        </div>
        <div className="file-editor-actions">
          {browseHref !== "#" ? (
            <a className="file-editor-link" href={browseHref} rel="noreferrer noopener" target="_blank">
              Open raw
            </a>
          ) : null}
        </div>
      </div>
      <div className="file-editor-body">
        {preview.loading ? <div className="file-editor-empty">Opening file…</div> : null}
        {!preview.loading && preview.error ? <div className="file-editor-empty">{preview.error}</div> : null}
        {!preview.loading && !preview.error ? (
          <div className="file-editor-code" role="presentation">
            {lines.map((line, index) => (
              <div className="file-editor-line" key={`${preview.path}:${index}`}>
                <span className="file-editor-gutter">{index + 1}</span>
                <code className="file-editor-text">{line || " "}</code>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConfigPanel({
  snapshot,
  activeThreadLabel,
  actions,
  pushToast,
  selectModel,
}: {
  snapshot: DashboardData;
  activeThreadLabel: string;
  actions: WorkspaceActions;
  pushToast: (message: string, tone: ToastTone) => void;
  selectModel: (modelId: string) => Promise<void>;
}) {
  return (
    <div className="config-stack">
      <div className="sg">
        <div className="sg-t">Model</div>
        <div className="sr">
          <span className="sl">model</span>
          <select className="ssel" value={snapshot.settings.model} onChange={(event) => void selectModel(event.target.value)}>
            {snapshot.models.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="sr">
          <span className="sl">reasoning_effort</span>
          <select
            className="ssel"
            value={snapshot.settings.reasoningEffort}
            onChange={(event) => void actions.updateSettings({ reasoningEffort: event.target.value as SettingsState["reasoningEffort"] })}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="xhigh">xhigh</option>
          </select>
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">Approval &amp; Sandbox</div>
        <div className="sr">
          <span className="sl">approval_policy</span>
          <select
            className="ssel"
            value={approvalModeFromSettings(snapshot.settings)}
            onChange={(event) => void actions.updateSettings(settingsPatchFromApprovalMode(event.target.value as UiApprovalMode))}
          >
            <option value="auto">auto</option>
            <option value="ro">read-only</option>
            <option value="fa">full-access</option>
          </select>
        </div>
        <div className="sr">
          <span className="sl">sandbox</span>
          <select
            className="ssel"
            value={snapshot.settings.sandboxMode}
            onChange={(event) => void actions.updateSettings({ sandboxMode: event.target.value as SettingsState["sandboxMode"] })}
          >
            <option value="workspace-write">workspace-write</option>
            <option value="read-only">read-only</option>
            <option value="danger-full-access">danger-full-access</option>
          </select>
        </div>
        <div className="sr">
          <span className="sl">web_search</span>
          <div className={clsx("tog", snapshot.settings.webSearch && "on")} onClick={() => void actions.updateSettings({ webSearch: !snapshot.settings.webSearch })} role="button" tabIndex={0} onKeyDown={() => undefined} />
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">Skills</div>
        {snapshot.installedSkills.map((skill) => (
          <div className="sr" key={skill.id}>
            <span className="sl">{skill.name}</span>
            <div className={clsx("tog", skill.enabled && "on")} onClick={() => void actions.toggleInstalledSkill(skill.id)} role="button" tabIndex={0} onKeyDown={() => undefined} />
          </div>
        ))}
        {snapshot.remoteSkills.length > 0 ? (
          <div className="remote-skill-list">
            {snapshot.remoteSkills.map((skill) => (
              <button
                className="remote-skill-card"
                key={skill.id}
                type="button"
                onClick={() => {
                  void actions.installSkill(skill.id);
                  pushToast(`Installing ${skill.name}`, "ok");
                }}
              >
                <strong>{skill.name}</strong>
                <span>{skill.description}</span>
                <small>{skill.downloads} downloads</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="sg">
        <div className="sg-t">MCP</div>
        {snapshot.mcpServers.map((server) => (
          <div className="mcp-card" key={server.name}>
            <div className="mcp-head">
              <strong>{server.name}</strong>
              <span>{server.authStatus}</span>
            </div>
            <div className="mcp-tools">{Object.keys(server.tools).slice(0, 4).join(" · ")}</div>
            <button className="mini-action" type="button" onClick={() => void actions.toggleMcpAuth(server.name)}>
              {server.authStatus === "notLoggedIn" ? "Connect" : "Refresh"}
            </button>
          </div>
        ))}
      </div>

      <div className="sg">
        <div className="sg-t">
          Feature Flags{" "}
          <button className="feature-refresh" type="button" onClick={() => pushToast("codex features list", "ok")}>
            ⟳
          </button>
        </div>
        {snapshot.featureFlags.map((flag) => (
          <div className="sr" key={flag.name}>
            <span className="sl">
              {flag.name} <small>({flag.stage})</small>
            </span>
            <div className={clsx("tog", flag.enabled && "on")} onClick={() => void actions.toggleFeatureFlag(flag.name)} role="button" tabIndex={0} onKeyDown={() => undefined} />
          </div>
        ))}
      </div>

      <div className="config-preview">
        <div className="config-title">~/.codex/config.toml</div>
        <div># Codex CLI Web UI config</div>
        <div>model = "{snapshot.settings.model}"</div>
        <div>approval_policy = "{snapshot.settings.approvalPolicy}"</div>
        <div>model_reasoning_effort = "{snapshot.settings.reasoningEffort}"</div>
        <div>web_search = "{snapshot.settings.webSearch ? "live" : "disabled"}"</div>
        <br />
        <div>[features]</div>
        {snapshot.featureFlags.slice(0, 4).map((flag) => (
          <div key={flag.name}>
            {flag.name} = {flag.enabled ? "true" : "false"}
          </div>
        ))}
        <br />
        <div># active thread</div>
        <div>thread = "{activeThreadLabel}"</div>
      </div>
    </div>
  );
}
