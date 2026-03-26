import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PropsWithChildren,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import clsx from "clsx";

import type { ThreadItem, Turn } from "../protocol/v2";
import {
  buildGitActivityGraphModel,
  buildGitHistoryGraphModel,
  deriveLiveOverlay,
  summarizeTurnFileChanges,
  toBrowseUrl,
} from "./services/presentation/workspacePresentationService";
import {
  findProviderModel,
  getProviderAdapter,
  listProviderModels,
  persistProviderId,
  type ProviderId,
} from "./services/providers";
import { WorkspaceRuntimeService } from "./services/runtime/WorkspaceRuntimeService";
import { LiveStatusInline } from "./LiveStatusInline";
import {
  createBlankThreadRecord,
  createFallbackDashboardData,
  createSimulatedTurn,
  type ApprovalDecision,
  type ComposerFile,
  type ComposerImage,
  type DashboardData,
  type ApprovalRequest,
  type MentionAttachment,
  type SettingsState,
  type SkillCard,
  type ThreadRecord,
  type WorkspaceMode,
} from "./mockData";
import {
  APPROVAL_CLASS,
  APPROVAL_LABELS,
  APPROVAL_ORDER,
  DEFAULT_UI_THEME_ID,
  PANEL_TITLE,
  QUICK_HINTS,
  SLASH_COMMANDS,
  UI_THEME_OPTIONS,
  UI_THEME_STORAGE_KEY,
  approvalModeFromSettings,
  countDiffStats,
  deriveLocalDirectoryCatalog,
  diffEntryId,
  diffKindLabel,
  formatUploadSize,
  getFileAttachmentPreview,
  getStreamTarget,
  getUiThemeOption,
  getUserText,
  insertInlineMentionToken,
  isDesktopViewport,
  isExistingThreadHistoryPending,
  isPathWithinRoot,
  latestThreadLabel,
  localUploadedFilesToMentions,
  nextId,
  normalizeDiffPath,
  panelToSection,
  parseRoute,
  sectionToPanel,
  settingsPatchFromApprovalMode,
  shorten,
  sortThreads,
  sortTurnsById,
  statusTone,
  stopStreamsForThreadTurn,
  composerHasMentionToken,
  isUiThemeId,
  mentionInlineToken,
  threadDayGroup,
  threadLabel,
} from "./workspaceHelpers";
import { routeSectionToSegment, routeSegmentToSection } from "./workspaceTypes";
import type {
  DiffReviewEntry,
  FilePreviewState,
  GitActivityGraphModel,
  PanelTab,
  QuickEntry,
  QuickMode,
  QueuedComposerMessage,
  RouteSection,
  ToastItem,
  ToastTone,
  UiThemeId,
  WorkspaceActions,
  WorkspaceContextValue,
} from "./workspaceTypes";
import { ChatTranscript } from "./components/ChatTranscript";
import { ApprovalRequestCard } from "./components/ApprovalRequestCard";
import { BrandMark } from "./components/BrandMark";
import { ConnectionLoadingState } from "./components/ConnectionLoadingState";
import { CommitComposerCard } from "./components/CommitComposerCard";
import { FileChangeSummary } from "./components/FileChangeSummary";
import { GitActivityGraph } from "./components/GitActivityGraph";
import { QuestionRequestCard } from "./components/QuestionRequestCard";
import {
  ConfigPanel,
  SkillsLibraryModal,
  ThemePickerPanel,
} from "./components/SettingsPanels";
import { TerminalPanel } from "./components/TerminalPanel";
import {
  ComposerTextarea,
  DiffReviewPage,
  DiffPatchViewer,
  FileExplorerPanel,
  FileEditorPreview,
  ProjectFolderPickerModal,
  QueuedMessagesStrip,
} from "./WorkspaceView";

const MATERIALIZED_THREAD_ID_FIELD = "materializedThreadId";

const getMaterializedThreadId = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const value = (error as Record<string, unknown>)[MATERIALIZED_THREAD_ID_FIELD];
  return typeof value === "string" ? value : null;
};

const buildQuestionAnswerPayload = (
  approval: ApprovalRequest,
  answers: Record<string, string>,
) =>
  Object.fromEntries(
    (approval.questions ?? []).map((question) => [
      question.id,
      [(answers[question.id] ?? "").trim()].filter(Boolean),
    ]),
  );

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

type CommandPaletteAction =
  | { type: "createSession" }
  | { type: "forkSession" }
  | { type: "compactSession" }
  | { type: "openSkills" }
  | { type: "resetComposer" }
  | { type: "openPanel"; tab: PanelTab }
  | { type: "runSlash"; slash: string }
  | { type: "selectModel"; modelId: string };

type CommandPaletteItem = {
  icon: string;
  name: string;
  key: string;
  command: CommandPaletteAction;
};

type CommandPaletteGroup = {
  label: string;
  items: Array<CommandPaletteItem>;
};

const FALLBACK_DATA = createFallbackDashboardData();
const ALL_MENTIONS = FALLBACK_DATA.mentionCatalog;
const INITIAL_VISIBLE_TURNS = 18;
const TURN_HISTORY_BATCH = 14;
const STARTUP_CONNECTION_MESSAGES = [
  "Opening workspace",
  "Setting environment",
  "Initializing modules",
  "Starting services",
];
const STARTUP_CONVERSATION_MESSAGES = [
  "Opening conversation",
  "Reattaching thread",
  "Loading recent history",
  "Syncing transcript",
];
const STARTUP_MESSAGE_SEQUENCE = [
  ...STARTUP_CONNECTION_MESSAGES,
  ...STARTUP_CONVERSATION_MESSAGES,
];

type ChromeIconName =
  | "auto"
  | "plan"
  | "mention"
  | "attach"
  | "image"
  | "terminal"
  | "web"
  | "review"
  | "agents"
  | "compact"
  | "editor"
  | "send"
  | "stop"
  | "branch"
  | "model"
  | "shield";

function ChromeIcon({
  name,
  className,
}: {
  name: ChromeIconName;
  className?: string;
}) {
  const iconClassName = clsx("chrome-icon", className);

  switch (name) {
    case "auto":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <path d="m8.1 1.4-1.7 4 2.3.3-1 4.9 3.9-6-2.4-.3 1.5-3Z" />
        </svg>
      );
    case "plan":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 3.5v9" />
          <path d="M4 5h5" />
          <path d="M4 8h7" />
          <path d="M4 11h4" />
          <circle cx="11.5" cy="8" r="1.5" />
        </svg>
      );
    case "mention":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.3" />
          <path d="M10.8 10.1a2.3 2.3 0 1 1 .4-4.6v3.6c0 .7.4 1 1 1 .9 0 1.4-.8 1.4-2.1A5.4 5.4 0 1 0 8 13.4" />
        </svg>
      );
    case "attach":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 8.5 3.8-3.8a2 2 0 1 1 2.8 2.8L7.9 12.2A3 3 0 0 1 3.6 8l4.3-4.3" />
        </svg>
      );
    case "image":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.5" y="3" width="11" height="10" rx="2" />
          <circle cx="6" cy="6.5" r="1" />
          <path d="m4.5 11 2.4-2.4 1.9 1.9 1.4-1.4 1.3 1.9" />
        </svg>
      );
    case "terminal":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.5" y="3" width="11" height="10" rx="2" />
          <path d="m5.3 6 1.8 1.8-1.8 1.8" />
          <path d="M8.7 9.8h2.2" />
        </svg>
      );
    case "web":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.2" />
          <path d="m10.2 10.2 2.6 2.6" />
        </svg>
      );
    case "review":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 2.8h5l2 2v7.4a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z" />
          <path d="M9.5 2.8v2h2" />
          <path d="M5.7 8h4.6" />
          <path d="M5.7 10.3h3.2" />
        </svg>
      );
    case "agents":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="4.2" cy="8" r="1.5" />
          <circle cx="11.8" cy="5.2" r="1.5" />
          <circle cx="11.8" cy="10.8" r="1.5" />
          <path d="M5.5 7.3 10.4 5.8" />
          <path d="M5.5 8.7 10.4 10.2" />
        </svg>
      );
    case "compact":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 5h9" />
          <path d="M3.5 8h6" />
          <path d="M3.5 11h9" />
          <path d="m11 6.3 1.8 1.7L11 9.7" />
        </svg>
      );
    case "editor":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.4 11.6 11.6 4.4" />
          <path d="m10.4 3.6 2 2" />
          <path d="M4 12.2 3.6 13l.8-.4 1.4-.3-.8-.8Z" />
          <path d="M3.5 3.4h5.2" />
        </svg>
      );
    case "send":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <path d="m8 12.7-.1-8.8" />
          <path d="m5.3 6.1 2.6-2.8 2.8 2.8" />
        </svg>
      );
    case "stop":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.2" />
        </svg>
      );
    case "branch":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="5" cy="4" r="1.4" />
          <circle cx="11" cy="12" r="1.4" />
          <circle cx="11" cy="4" r="1.4" />
          <path d="M5 5.4v4.1c0 1.4 1.1 2.5 2.5 2.5H9.6" />
          <path d="M5 5.4c0 1.4 1.1 2.5 2.5 2.5H9.6" />
        </svg>
      );
    case "model":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <path d="m8 2.6 4.4 2.5v5L8 12.6l-4.4-2.5v-5Z" />
          <path d="m8 2.6 4.4 2.5L8 7.6 3.6 5.1Z" />
          <path d="M8 7.6v5" />
        </svg>
      );
    case "shield":
      return (
        <svg className={iconClassName} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5 12 4v3.6c0 2.4-1.4 4.2-4 5.9-2.6-1.7-4-3.5-4-5.9V4Z" />
        </svg>
      );
  }
}

const compactNumber = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: value >= 100_000 ? 0 : 1,
  }).format(value);

const pathBaseName = (value: string | null | undefined) => {
  if (!value) {
    return "workspace";
  }

  const normalized = value.replace(/\/+$/u, "");
  if (!normalized) {
    return "workspace";
  }

  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? normalized;
};

const trimTrailingPathSeparators = (value: string) => {
  if (value === "/") {
    return "/";
  }

  if (/^[a-z]:[\\/]?$/iu.test(value)) {
    return `${value.slice(0, 2)}\\`;
  }

  return value.replace(/[\\/]+$/u, "");
};

type PathSeparator = "/" | "\\";

type SplitAbsolutePath = {
  root: string;
  separator: PathSeparator;
  segments: Array<string>;
};

const splitAbsolutePath = (value: string): SplitAbsolutePath => {
  const raw = value.trim();
  if (!raw) {
    return {
      root: "",
      separator: "/",
      segments: [] as string[],
    };
  }

  const separator: "/" | "\\" = raw.includes("\\") ? "\\" : "/";
  const normalized = trimTrailingPathSeparators(raw);

  if (/^[a-z]:\\$/iu.test(normalized)) {
    return {
      root: normalized,
      separator: "\\",
      segments: [] as string[],
    };
  }

  if (/^[a-z]:/iu.test(normalized)) {
    const root = `${normalized.slice(0, 2)}\\`;
    const tail = normalized.slice(2).replace(/^[\\/]+/u, "");
    return {
      root,
      separator: "\\",
      segments: tail.split(/[\\/]+/u).filter(Boolean),
    };
  }

  if (normalized.startsWith("/")) {
    return {
      root: "/",
      separator: "/",
      segments: normalized.slice(1).split("/").filter(Boolean),
    };
  }

  return {
    root: "",
    separator,
    segments: normalized.split(/[\\/]+/u).filter(Boolean),
  };
};

const joinAbsolutePath = (
  root: string,
  separator: PathSeparator,
  segments: Array<string>,
) => {
  if (root === "/") {
    return segments.length > 0 ? `/${segments.join("/")}` : "/";
  }

  if (/^[a-z]:\\$/iu.test(root)) {
    return segments.length > 0 ? `${root}${segments.join("\\")}` : root;
  }

  if (root) {
    return segments.length > 0
      ? `${root.replace(/[\\/]+$/u, separator)}${segments.join(separator)}`
      : root;
  }

  return segments.join(separator);
};

const parentDirectoryPath = (value: string) => {
  const { root, separator, segments } = splitAbsolutePath(value);
  if (segments.length === 0) {
    return null;
  }

  return joinAbsolutePath(root, separator, segments.slice(0, -1)) || root || null;
};

const buildAbsolutePathBreadcrumbs = (value: string) => {
  const { root, separator, segments } = splitAbsolutePath(value);
  const breadcrumbs: Array<{ label: string; path: string }> = [];

  if (root) {
    breadcrumbs.push({
      label: root === "/" ? "/" : root.replace(/[\\/]+$/u, ""),
      path: root,
    });
  }

  const accumulatedSegments: Array<string> = [];
  segments.forEach((segment) => {
    accumulatedSegments.push(segment);
    breadcrumbs.push({
      label: segment,
      path: joinAbsolutePath(root, separator, accumulatedSegments),
    });
  });

  if (breadcrumbs.length === 0) {
    breadcrumbs.push({
      label: value,
      path: value,
    });
  }

  return breadcrumbs;
};

const formatUsageWindowShortLabel = (
  label: string,
  windowDurationMins: number | null,
) => {
  if (windowDurationMins !== null) {
    if (windowDurationMins <= 60 * 5) {
      return "5h";
    }

    if (windowDurationMins >= 60 * 24 * 7) {
      return "Week";
    }
  }

  const normalized = label.trim().toLowerCase();
  if (normalized.includes("week")) {
    return "Week";
  }

  if (normalized.includes("5")) {
    return "5h";
  }

  return label;
};

const estimateConversationTokens = (
  turns: Array<Turn>,
  providerId?: ProviderId,
) => {
  let characters = 0;

  for (const turn of turns) {
    for (const item of turn.items) {
      switch (item.type) {
        case "userMessage":
          characters += getUserText(item, providerId).length;
          break;
        case "agentMessage":
        case "plan":
          characters += item.text.length;
          break;
        case "reasoning":
          characters += item.summary.join("\n").length;
          characters += item.content.join("\n").length;
          break;
        case "webSearch":
          characters += item.query.length;
          break;
        case "collabAgentToolCall":
          characters += (item.prompt ?? "").length;
          break;
        default:
          break;
      }
    }
  }

  return Math.max(0, Math.round(characters / 3.7));
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

const waitFor = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const waitForNextPaint = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      resolve();
    });
  });

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }

  return fallback;
};

const useWorkspace = () => {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("Workspace context is missing.");
  }

  return value;
};

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<DashboardData>(createFallbackDashboardData());
  const snapshotRef = useRef(snapshot);
  const runtimeRef = useRef<WorkspaceRuntimeService | null>(null);
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
    const runtime = new WorkspaceRuntimeService(createFallbackDashboardData());
    runtimeRef.current = runtime;

    const unsubscribe = runtime.subscribe((next) => {
      startTransition(() => {
        setSnapshot(next);
      });
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
    async <T,>(
      live: () => Promise<T>,
      fallback: () => Promise<T> | T,
      options?: {
        preferLive?: boolean;
        fallbackOnLiveError?: boolean;
      },
    ) => {
      const current = snapshotRef.current;
      const runtime = runtimeRef.current;
      const shouldAttemptLive =
        Boolean(runtime) &&
        (options?.preferLive ||
          (current.transport.mode === "live" &&
            current.transport.status === "connected"));

      if (!runtime && options?.preferLive) {
        throw new Error("The workspace runtime is still starting. Try again.");
      }

      if (runtime && shouldAttemptLive) {
        const attempts = options?.preferLive ? 3 : 1;
        let lastError: unknown = null;

        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try {
            const next = snapshotRef.current;
            if (
              next.transport.mode !== "live" ||
              next.transport.status !== "connected"
            ) {
              await runtime.connect();
            }

            return await live();
          } catch (error) {
            lastError = error;

            if (attempt < attempts - 1) {
              await waitFor(320 * (attempt + 1));
              continue;
            }

            if (options?.fallbackOnLiveError ?? true) {
              return await fallback();
            }

            throw error;
          }
        }

        throw lastError;
      }

      return await fallback();
    },
    [],
  );

  const createThreadLocal = useCallback(
    async (
      settings: SettingsState,
      options?: {
        title?: string;
        cwd?: string;
      },
    ) => {
      const threadId = nextId("thread");
      const record = createBlankThreadRecord(
        threadId,
        options?.title ?? "New Session",
        settings,
        options?.cwd,
      );

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
      const threadCwd =
        snapshotRef.current.threads.find((entry) => entry.thread.id === threadId)
          ?.thread.cwd ??
        snapshotRef.current.directoryCatalogRoot ??
        ".";
      const result = createSimulatedTurn({
        threadId,
        prompt,
        mode,
        settings,
        mentions: [
          ...mentions,
          ...localUploadedFilesToMentions(
            threadCwd,
            files,
            settings.provider,
          ),
        ],
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
      return threadId;
    },
    [mutateLocal],
  );

  const actions = useMemo<WorkspaceActions>(
    () => ({
      createThread: async (settings, options) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.createThread(settings, {
              cwd: options?.cwd,
            });
          },
          async () => await createThreadLocal(settings, options),
          {
            preferLive: true,
            fallbackOnLiveError: false,
          },
        ),
      resumeThread: async (threadId) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.resumeThread(threadId).catch(() => undefined);
            await runtime.ensureThreadLoaded(threadId).catch(() => undefined);
          },
          async () => undefined,
          {
            preferLive: true,
            fallbackOnLiveError: false,
          },
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
            return await runtime.sendComposer(args);
          },
          async () => {
            return await sendComposerLocal(args);
          },
          {
            preferLive: true,
            fallbackOnLiveError: false,
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
            const steerEntry = {
              id: `steer:${args.threadId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              turnId: "",
              prompt: args.prompt.trim() || "Steer applied",
              createdAt: Date.now(),
              status: "applied" as const,
            };

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
                steerEntry.turnId = activeTurn.id;

                return {
                  ...record,
                  steers: [
                    steerEntry,
                    ...(record.steers ?? []).filter((entry) => entry.id !== steerEntry.id),
                  ],
                };
              });
            });

            return applied;
          },
          {
            preferLive: true,
            fallbackOnLiveError: false,
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
            const href = toBrowseUrl(path, snapshotRef.current.settings.provider);
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
      saveFile: async (path, content) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.writeFile(path, content);
          },
          async () => {
            throw new Error("Saving files requires a live workspace connection.");
          },
          {
            preferLive: true,
            fallbackOnLiveError: false,
          },
        ),
      readGitGraph: async (cwd, limit = 80) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.readGitGraph(cwd, limit);
          },
          async () => "",
        ),
      readGitStatus: async (cwd) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.readGitStatus(cwd);
          },
          async () => "",
        ),
      readWorkspaceCommitPreferences: async (cwd) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.readWorkspaceCommitPreferences(cwd);
          },
          async () => {
            throw new Error(
              "Commit preferences require a live workspace connection.",
            );
          },
          {
            preferLive: true,
            fallbackOnLiveError: false,
          },
        ),
      writeWorkspaceCommitPreferences: async (cwd, patch) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.writeWorkspaceCommitPreferences(cwd, patch);
          },
          async () => {
            throw new Error(
              "Commit preferences require a live workspace connection.",
            );
          },
          {
            preferLive: true,
            fallbackOnLiveError: false,
          },
        ),
      generateCommitMessage: async ({ cwd, providerId }) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.generateCommitMessage({ cwd, providerId });
          },
          async () => {
            throw new Error(
              "Commit drafting requires a live workspace connection.",
            );
          },
          {
            preferLive: true,
            fallbackOnLiveError: false,
          },
        ),
      commitWorkingTree: async ({ cwd, message }) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.commitWorkingTree({ cwd, message });
          },
          async () => {
            throw new Error("Git commit requires a live workspace connection.");
          },
          {
            preferLive: true,
            fallbackOnLiveError: false,
          },
        ),
      checkProviderSetup: async (providerId) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.checkProviderSetup(providerId);
          },
          async () => {
            mutateLocal((draft) => {
              const targetProvider = providerId ?? draft.settings.provider;
              draft.providerSetup[targetProvider] = {
                ...draft.providerSetup[targetProvider],
                status: "error",
                summary: "Setup checks require a live workspace connection.",
                detail: "Reconnect Nomadex to the host bridge, then check again.",
                checkedAt: "just now",
              };
            });
          },
          {
            preferLive: true,
          },
        ),
      startProviderAuth: async (providerId, flow) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.startProviderAuth(providerId, flow);
          },
          async () => {
            mutateLocal((draft) => {
              const targetProvider = providerId ?? draft.settings.provider;
              draft.providerAuth[targetProvider] = {
                ...draft.providerAuth[targetProvider],
                status: "error",
                flow: flow ?? draft.providerAuth[targetProvider].flow,
                summary: "Provider sign-in requires a live workspace connection.",
                detail: "Reconnect Nomadex to the host bridge, then try again.",
                processId: null,
                updatedAt: "just now",
              };
            });
          },
          {
            preferLive: true,
          },
        ),
      submitProviderAuthSecret: async (providerId, secret) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.submitProviderAuthSecret(providerId, secret);
          },
          async () => {
            mutateLocal((draft) => {
              const targetProvider = providerId ?? draft.settings.provider;
              draft.providerAuth[targetProvider] = {
                ...draft.providerAuth[targetProvider],
                status: "error",
                summary: "Provider sign-in requires a live workspace connection.",
                detail: "Reconnect Nomadex to the host bridge, then try again.",
                processId: null,
                updatedAt: "just now",
              };
            });
          },
          {
            preferLive: true,
          },
        ),
      cancelProviderAuth: async (providerId) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.cancelProviderAuth(providerId);
          },
          async () => {
            mutateLocal((draft) => {
              const targetProvider = providerId ?? draft.settings.provider;
              draft.providerAuth[targetProvider] = {
                ...draft.providerAuth[targetProvider],
                status: "idle",
                summary: "No sign-in in progress.",
                detail: null,
                authUrl: null,
                userCode: null,
                processId: null,
                updatedAt: "just now",
              };
            });
          },
          {
            preferLive: true,
          },
        ),
      switchProviderAccount: async (providerId, flow) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.switchProviderAccount(providerId, flow);
          },
          async () => {
            mutateLocal((draft) => {
              const targetProvider = providerId ?? draft.settings.provider;
              draft.providerAuth[targetProvider] = {
                ...draft.providerAuth[targetProvider],
                status: "error",
                flow: flow ?? draft.providerAuth[targetProvider].flow,
                summary: "Provider account switching requires a live workspace connection.",
                detail: "Reconnect Nomadex to the host bridge, then try again.",
                processId: null,
                updatedAt: "just now",
              };
            });
          },
          {
            preferLive: true,
          },
        ),
      updateSettings: async (patch) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.updateSettings(patch);
          },
          async () => {
            if (patch.provider) {
              persistProviderId(patch.provider);
            }
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
      startChatGptLogin: async () =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.startChatGptLogin();
          },
          async () => {
            mutateLocal((draft) => {
              draft.account.loginInProgress = true;
              draft.account.pendingLoginId = nextId("login");
              draft.account.loginError = null;
            });
            return "https://chatgpt.com/";
          },
        ),
      completeChatGptLogin: async (callbackUrl) =>
        await withLiveFallback(
          async () => {
            const response = await fetch(
              getProviderAdapter(snapshotRef.current.settings.provider).authCompletePath,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ callbackUrl }),
              },
            );

            const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
            if (!response.ok) {
              throw new Error(payload?.error ?? payload?.message ?? "Failed to complete mobile login");
            }

            const runtime = runtimeRef.current!;
            await runtime.refreshAccount();
          },
          async () => {
            mutateLocal((draft) => {
              draft.account = {
                ...draft.account,
                planType: "ChatGPT Pro",
                workspace: "mobile relay account",
                authMode: "chatgpt",
                loggedIn: true,
                requiresOpenaiAuth: false,
                loginInProgress: false,
                pendingLoginId: null,
                loginError: null,
              };
            });
          },
        ),
      loginWithApiKey: async (apiKey) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.loginWithApiKey(apiKey);
          },
          async () => {
            mutateLocal((draft) => {
              draft.account = {
                ...draft.account,
                planType: "API key",
                workspace: "API key session",
                authMode: "apiKey",
                loggedIn: true,
                requiresOpenaiAuth: false,
                loginInProgress: false,
                pendingLoginId: null,
                loginError: null,
              };
            });
          },
        ),
      logoutAccount: async () =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.logoutAccount();
          },
          async () => {
            mutateLocal((draft) => {
              draft.account = {
                ...draft.account,
                planType: "Signed out",
                workspace: "No active account",
                authMode: "signedOut",
                loggedIn: false,
                loginInProgress: false,
                pendingLoginId: null,
                loginError: null,
                usageWindows: [],
                rateUsed: 0,
                rateLimit: 100,
                credits: "Sign in to view rate limits",
              };
            });
          },
        ),
      refreshAccount: async () =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.refreshAccount();
          },
          async () => undefined,
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
      startProjectTerminal: async (threadId, cwd) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            return await runtime.startProjectTerminal(threadId, cwd);
          },
          async () => {
            throw new Error("Interactive terminals require a live workspace connection.");
          },
          {
            preferLive: true,
            fallbackOnLiveError: false,
          },
        ),
      sendTerminalInput: async (_threadId, terminalId, input) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.sendTerminalInput(terminalId, input);
          },
          async () => {
            throw new Error("Interactive terminals require a live workspace connection.");
          },
          {
            preferLive: true,
            fallbackOnLiveError: false,
          },
        ),
      terminateTerminal: async (_threadId, terminalId) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.terminateTerminal(terminalId);
          },
          async () => {
            throw new Error("Interactive terminals require a live workspace connection.");
          },
          {
            preferLive: true,
            fallbackOnLiveError: false,
          },
        ),
      resolveApproval: async (requestId, decision) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.resolveApproval(requestId, decision);
          },
          async () => {
            mutateLocal((draft) => {
              draft.threads = draft.threads.map((record) => ({
                ...record,
                approvals: record.approvals.map((approval) =>
                  approval.id === requestId
                    ? {
                        ...approval,
                        state:
                          decision === "accept" || decision === "acceptForSession"
                            ? "approved"
                            : "declined",
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
                        detail: `${approval.detail} · ${Object.values(answers)
                          .flat()
                          .filter(Boolean)
                          .join(", ")}`,
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
      rollbackToTurn: async (threadId, targetTurnId) =>
        await withLiveFallback(
          async () => {
            const runtime = runtimeRef.current!;
            await runtime.rollbackToTurn(threadId, targetTurnId);
          },
          async () => {
            mutateLocal((draft) => {
              draft.threads = draft.threads.map((record) => {
                if (record.thread.id !== threadId) {
                  return record;
                }

                const completedTurns = record.thread.turns.filter(
                  (turn) => turn.status !== "inProgress",
                );
                const rollbackStartIndex = completedTurns.findIndex(
                  (turn) => turn.id === targetTurnId,
                );
                if (rollbackStartIndex === -1) {
                  return record;
                }
                const removedTurnIds = new Set(
                  completedTurns.slice(rollbackStartIndex).map((turn) => turn.id),
                );

                if (removedTurnIds.size === 0) {
                  return record;
                }

                const nextTurns = record.thread.turns.filter(
                  (turn) => !removedTurnIds.has(turn.id),
                );

                return {
                  ...record,
                  thread: {
                    ...record.thread,
                    turns: nextTurns,
                    updatedAt: Math.floor(Date.now() / 1000),
                  },
                  steers: (record.steers ?? []).filter(
                    (entry) => !removedTurnIds.has(entry.turnId),
                  ),
                  approvals: record.approvals.filter(
                    (approval) => !approval.turnId || !removedTurnIds.has(approval.turnId),
                  ),
                };
              });
            });
          },
          {
            preferLive: true,
            fallbackOnLiveError: false,
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
  return <WorkspacePage />;
}

export function WorkspacePage() {
  const { snapshot, actions } = useWorkspace();
  const navigate = useNavigate();
  const location = useRouterState({
    select: (state) => state.location,
  });
  const route = parseRoute(location.pathname);
  const invalidThreadSection = useMemo(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts[0] !== "threads" || !parts[1] || !parts[2]) {
      return null;
    }

    return routeSegmentToSection(parts[2]) ? null : parts[2];
  }, [location.pathname]);
  const routeSearch = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
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
  const [desktopViewport, setDesktopViewport] = useState(() => isDesktopViewport());
  const editorPath = route.section === "editor" ? routeSearch.get("path") : null;
  const editorLine = useMemo(() => {
    const raw = route.section === "editor" ? routeSearch.get("line") : null;
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [route.section, routeSearch]);
  const editorSource = useMemo<RouteSection>(() => {
    const source = route.section === "editor" ? routeSearch.get("from") : null;
    switch (source) {
      case "ops":
      case "review":
      case "agents":
      case "skills":
      case "mcp":
      case "settings":
      case "chat":
        return source;
      default:
        return "chat";
    }
  }, [route.section, routeSearch]);
  const reviewDiffId =
    route.section === "review" ? routeSearch.get("diff") : null;
  const reviewSource = useMemo<RouteSection>(() => {
    const source = route.section === "review" ? routeSearch.get("from") : null;
    switch (source) {
      case "ops":
      case "agents":
      case "skills":
      case "mcp":
      case "settings":
      case "chat":
        return source;
      default:
        return "chat";
    }
  }, [route.section, routeSearch]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => isDesktopViewport());
  const [mobilePanelClosing, setMobilePanelClosing] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>(routePanel ?? "files");
  const [commandOpen, setCommandOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [skillsModalOpen, setSkillsModalOpen] = useState(false);
  const [projectPickerStarting, setProjectPickerStarting] = useState(false);
  const [projectPickerPath, setProjectPickerPath] = useState(
    FALLBACK_DATA.directoryCatalogRoot || ".",
  );
  const [composer, setComposer] = useState("");
  const [composerMode, setComposerMode] = useState<WorkspaceMode>("chat");
  const [toolbarAuto, setToolbarAuto] = useState(false);
  const [toolbarPlan, setToolbarPlan] = useState(false);
  const [toolbarShell, setToolbarShell] = useState(false);
  const [terminalDockPrimed, setTerminalDockPrimed] = useState(false);
  const [terminalDockReady, setTerminalDockReady] = useState(false);
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
  const [editorHasUnsavedChanges, setEditorHasUnsavedChanges] = useState(false);
  const [selectedDiffEntryId, setSelectedDiffEntryId] = useState<string | null>(null);
  const [visibleTurnStartByThreadId, setVisibleTurnStartByThreadId] = useState<Record<string, number>>({});
  const [questionAnswersByRequestId, setQuestionAnswersByRequestId] = useState<
    Record<string, Record<string, string>>
  >({});
  const [mcpResponseByRequestId, setMcpResponseByRequestId] = useState<Record<string, string>>({});
  const terminalDockPaintFrameRef = useRef<number | null>(null);
  const terminalDockLaunchFrameRef = useRef<number | null>(null);
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
  const [gitActivityGraph, setGitActivityGraph] = useState<GitActivityGraphModel | null>(null);
  const [gitActivityGraphLoading, setGitActivityGraphLoading] = useState(false);
  const [gitActivityGraphError, setGitActivityGraphError] = useState<string | null>(null);
  const [gitActivityRefreshNonce, setGitActivityRefreshNonce] = useState(0);
  const [commitProviderId, setCommitProviderId] = useState<ProviderId>(snapshot.settings.provider);
  const [commitPreferencesPath, setCommitPreferencesPath] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitGenerating, setCommitGenerating] = useState(false);
  const [commitCommitting, setCommitCommitting] = useState(false);
  const [modelPickerPosition, setModelPickerPosition] = useState({ top: 52, right: 12 });
  const [composerSyncKey, setComposerSyncKey] = useState(0);

  useEffect(() => {
    if (!invalidThreadSection || !route.threadId) {
      return;
    }

    void navigate({
      to: "/threads/$threadId",
      params: { threadId: route.threadId } as never,
      replace: true,
    });
  }, [invalidThreadSection, navigate, route.threadId]);

  const [uiTheme, setUiTheme] = useState<UiThemeId>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_UI_THEME_ID;
    }

    const storedTheme = window.localStorage.getItem(UI_THEME_STORAGE_KEY);
    return isUiThemeId(storedTheme) ? storedTheme : DEFAULT_UI_THEME_ID;
  });

  const chatRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerMirrorRef = useRef<HTMLDivElement | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFileInputRef = useRef<HTMLInputElement | null>(null);
  const queueProcessingRef = useRef<Record<string, boolean>>({});
  const queueAwaitingIdleRef = useRef<Record<string, boolean>>({});
  const toastTimersRef = useRef<Record<string, number>>({});
  const composerInputFrameRef = useRef<number | null>(null);
  const latestComposerInputRef = useRef(composer);
  const gitActivityGraphCacheRef = useRef<Record<string, string>>({});
  const initialTransportConnectSeenRef = useRef(false);
  const editorFileChangeActivityKeyRef = useRef("");
  const editorTrackingTargetRef = useRef("");
  const pendingChatRestoreThreadIdRef = useRef<string | null>(null);
  const pendingHistoryPrependRef = useRef<{
    threadId: string;
    previousHeight: number;
    previousTop: number;
  } | null>(null);
  const hydratedScrollKeyRef = useRef<string | null>(null);
  const chatPinnedToBottomRef = useRef(true);
  const chatScrollStateRef = useRef<Record<string, { pinned: boolean; top: number }>>({});
  const streamVisibleRef = useRef<Record<string, number>>({});
  const [streamVisible, setStreamVisible] = useState<Record<string, number>>({});
  const [queueWakeSignal, setQueueWakeSignal] = useState(0);
  const deferredComposer = useDeferredValue(composer);
  const deferredQuickQuery = useDeferredValue(quickQuery);

  useEffect(() => {
    latestComposerInputRef.current = composer;
  }, [composer]);

  const [showStartupConnectionLoader, setShowStartupConnectionLoader] = useState(true);

  useEffect(
    () => () => {
      if (composerInputFrameRef.current !== null) {
        window.cancelAnimationFrame(composerInputFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const updateViewport = () => {
      setDesktopViewport((current) => {
        const next = isDesktopViewport();
        return current === next ? current : next;
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport, { passive: true });

    return () => {
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  const updateModelPickerPosition = useCallback(() => {
    const rect = modelButtonRef.current?.getBoundingClientRect();
    setModelPickerPosition({
      top: (rect?.bottom ?? 48) + 4,
      right: Math.max(12, window.innerWidth - (rect?.right ?? window.innerWidth - 12)),
    });
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const activeTheme = getUiThemeOption(uiTheme);
    const root = document.documentElement;
    root.dataset.uiTheme = activeTheme.id;
    root.style.setProperty("color-scheme", activeTheme.mode);
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, uiTheme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", activeTheme.themeColor);
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute("content", activeTheme.mode);
    document
      .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
      ?.setAttribute("content", activeTheme.mode === "light" ? "default" : "black-translucent");
  }, [uiTheme]);

  useLayoutEffect(() => {
    if (!modelPickerOpen) {
      return;
    }

    const update = () => {
      updateModelPickerPosition();
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [modelPickerOpen, updateModelPickerPosition]);

  const visibleTabIds = useMemo(() => {
    const availableIds = new Set(uniqueThreads.map((entry) => entry.thread.id));
    return [...new Set(tabIds.filter((id) => availableIds.has(id)))].slice(0, 6);
  }, [tabIds, uniqueThreads]);
  const activeTurns = useMemo(() => sortTurnsById(activeThread?.thread.turns ?? []), [activeThread?.thread.turns]);
  const activeDefaultVisibleTurnStart = useMemo(
    () => Math.max(0, activeTurns.length - INITIAL_VISIBLE_TURNS),
    [activeTurns.length],
  );
  const activeVisibleTurnStart = useMemo(() => {
    if (!activeThreadId) {
      return activeDefaultVisibleTurnStart;
    }

    const storedStart = visibleTurnStartByThreadId[activeThreadId];
    if (storedStart == null) {
      return activeDefaultVisibleTurnStart;
    }

    const maxStart = activeTurns.length === 0 ? 0 : Math.max(0, activeTurns.length - 1);
    return Math.max(0, Math.min(storedStart, maxStart));
  }, [activeDefaultVisibleTurnStart, activeThreadId, activeTurns.length, visibleTurnStartByThreadId]);
  const renderedTurns = useMemo(
    () => activeTurns.slice(activeVisibleTurnStart),
    [activeTurns, activeVisibleTurnStart],
  );
  const transcriptScrollKey = useMemo(
    () =>
      activeTurns
        .map((turn) => `${turn.id}:${turn.status}:${turn.items.length}:${turn.error?.message ?? ""}`)
        .join("|"),
    [activeTurns],
  );
  const activeTurn = [...activeTurns].reverse().find((turn) => turn.status === "inProgress") ?? null;
  const normalizedEditorPath = useMemo(
    () => (editorPath ? normalizeDiffPath(editorPath) : null),
    [editorPath],
  );
  const normalizedEditorRelativePath = useMemo(() => {
    if (!normalizedEditorPath) {
      return null;
    }

    const cwd = activeThread?.thread.cwd
      ? normalizeDiffPath(activeThread.thread.cwd).replace(/\/+$/u, "")
      : null;
    if (!cwd) {
      return null;
    }

    return normalizedEditorPath.startsWith(`${cwd}/`)
      ? normalizedEditorPath.slice(cwd.length + 1)
      : null;
  }, [activeThread?.thread.cwd, normalizedEditorPath]);
  const editorFileChangeActivityKey = useMemo(() => {
    if (route.section !== "editor" || !normalizedEditorPath) {
      return "";
    }

    const trackedPaths = new Set(
      [normalizedEditorPath, normalizedEditorRelativePath].filter(
        (value): value is string => Boolean(value),
      ),
    );

    return activeTurns
      .flatMap((turn) =>
        summarizeTurnFileChanges(turn)
          .filter((entry) => trackedPaths.has(normalizeDiffPath(entry.path)))
          .map(
            (entry) =>
              `${turn.id}:${entry.itemId}:${entry.path}:${entry.kind}:${entry.status}:${turn.status}`,
          ),
      )
      .join("|");
  }, [
    activeTurns,
    normalizedEditorPath,
    normalizedEditorRelativePath,
    route.section,
  ]);
  const activeQueuedMessages = activeThreadId ? queuedByThreadId[activeThreadId] ?? [] : [];
  const liveOverlay = useMemo(() => deriveLiveOverlay(activeTurn), [activeTurn]);
  const activeTurnFileChanges = useMemo(() => summarizeTurnFileChanges(activeTurn), [activeTurn]);
  const panelVisible =
    !mobilePanelClosing &&
    panelOpen &&
    route.section !== "editor" &&
    route.section !== "review";
  const mobilePanelVisible = panelVisible && !desktopViewport;
  const sidebarVisible = desktopViewport || sidebarOpen;
  // Keep the workspace mounted behind mobile overlays so chat/editor state does not remount
  // when opening or closing the session rail.
  const mainVisible = true;
  const mainCovered = !desktopViewport && mobilePanelVisible;
  const fullScreenOverlayOpen =
    commandOpen ||
    themePickerOpen ||
    projectPickerOpen ||
    skillsModalOpen;
  const pendingApprovalsCount = useMemo(
    () => activeThread?.approvals.filter((approval) => approval.state === "pending").length ?? 0,
    [activeThread?.approvals],
  );
  const activePendingApprovals = useMemo(
    () => activeThread?.approvals.filter((approval) => approval.state === "pending") ?? [],
    [activeThread?.approvals],
  );
  const activeUiApproval = approvalModeFromSettings(snapshot.settings);
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

  useEffect(() => {
    const activeRequestIds = new Set(
      snapshot.threads.flatMap((record) =>
        record.approvals
          .filter((approval) => approval.kind === "question" && approval.state === "pending")
          .map((approval) => approval.id),
      ),
    );

    setQuestionAnswersByRequestId((current) => {
      const nextEntries = Object.entries(current).filter(([requestId]) =>
        activeRequestIds.has(requestId),
      );

      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }

      return Object.fromEntries(nextEntries);
    });
  }, [snapshot.threads]);

  useEffect(() => {
    const activeRequestIds = new Set(
      snapshot.threads.flatMap((record) =>
        record.approvals
          .filter((approval) => approval.kind === "mcp" && approval.state === "pending")
          .map((approval) => approval.id),
      ),
    );

    setMcpResponseByRequestId((current) => {
      const nextEntries = Object.entries(current).filter(([requestId]) =>
        activeRequestIds.has(requestId),
      );

      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }

      return Object.fromEntries(nextEntries);
    });
  }, [snapshot.threads]);

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

  const activeProvider = useMemo(
    () =>
      snapshot.providers.find((entry) => entry.id === snapshot.settings.provider) ??
      getProviderAdapter(snapshot.settings.provider),
    [snapshot.providers, snapshot.settings.provider],
  );
  const modelOptions = useMemo(
    () =>
      listProviderModels(
        activeProvider.id,
        snapshot.models.length > 0 ? snapshot.models : FALLBACK_DATA.models,
      ),
    [activeProvider.id, snapshot.models],
  );
  const activeModelOption = useMemo(
    () =>
      findProviderModel(
        activeProvider.id,
        snapshot.settings.model,
        snapshot.models.length > 0 ? snapshot.models : FALLBACK_DATA.models,
      ),
    [activeProvider.id, snapshot.settings.model, snapshot.models],
  );
  const providerModelLabel = `${activeProvider.displayName} · ${activeModelOption?.displayName ?? (snapshot.settings.model === "default" ? "provider default" : snapshot.settings.model)}`;
  const activeThemeOption = useMemo(
    () => getUiThemeOption(uiTheme),
    [uiTheme],
  );

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

  const relatedRepoThreads = useMemo(
    () => uniqueThreads.filter((entry) => entry.thread.cwd === activeThread?.thread.cwd),
    [activeThread?.thread.cwd, uniqueThreads],
  );
  const activeWorkspaceCwd = useMemo(
    () =>
      activeThread?.thread.cwd?.trim() ||
      snapshot.directoryCatalogRoot ||
      null,
    [activeThread?.thread.cwd, snapshot.directoryCatalogRoot],
  );

  const selectedDiffEntry = useMemo(
    () => diffEntries.find((entry) => entry.id === selectedDiffEntryId) ?? diffEntries[0] ?? null,
    [diffEntries, selectedDiffEntryId],
  );

  useEffect(() => {
    if (!activeThread) {
      setCommitProviderId(snapshot.settings.provider);
      setCommitPreferencesPath(null);
      setCommitMessage("");
      return;
    }

    if (!activeWorkspaceCwd) {
      setCommitProviderId(snapshot.settings.provider);
      setCommitPreferencesPath(null);
      return;
    }

    let cancelled = false;
    setCommitMessage("");

    void actions
      .readWorkspaceCommitPreferences(activeWorkspaceCwd)
      .then((preferences) => {
        if (cancelled) {
          return;
        }

        setCommitProviderId(preferences.provider);
        setCommitPreferencesPath(preferences.filePath);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setCommitProviderId(snapshot.settings.provider);
        setCommitPreferencesPath(null);
      });

    return () => {
      cancelled = true;
    };
  }, [actions, activeThread, activeWorkspaceCwd, snapshot.settings.provider]);

  useEffect(() => {
    if (!activeThread) {
      setGitActivityGraph(null);
      setGitActivityGraphLoading(false);
      setGitActivityGraphError(null);
      return;
    }

    const fallbackGraph = buildGitActivityGraphModel({
      activeThread,
      relatedThreads: relatedRepoThreads,
    });
    setGitActivityGraph(fallbackGraph);
    setGitActivityGraphError(null);

    if (panelTab !== "graph") {
      setGitActivityGraphLoading(false);
      return;
    }

    const cacheKey = `${activeThread.thread.cwd}:${activeThread.thread.gitInfo?.sha ?? "workspace"}`;
    const cachedRawLog = gitActivityGraphCacheRef.current[cacheKey] ?? "";
    let cancelled = false;
    setGitActivityGraphLoading(true);

    void Promise.allSettled([
      cachedRawLog
        ? Promise.resolve(cachedRawLog)
        : actions.readGitGraph(activeThread.thread.cwd, 80),
      actions.readGitStatus(activeThread.thread.cwd),
    ])
      .then(([rawLogResult, rawStatusResult]) => {
        if (cancelled) {
          return;
        }

        const rawLog = rawLogResult.status === "fulfilled" ? rawLogResult.value : "";
        const rawStatus =
          rawStatusResult.status === "fulfilled" ? rawStatusResult.value : "";

        const fallbackWithStatus = buildGitActivityGraphModel({
          activeThread,
          relatedThreads: relatedRepoThreads,
          rawStatus,
        });
        const liveGraph =
          rawLog.trim().length > 0
            ? buildGitHistoryGraphModel({
                activeThread,
                rawLog,
                rawStatus,
              })
            : null;
        const nextGraph = liveGraph ?? fallbackWithStatus ?? fallbackGraph;

        if (rawLog.trim().length > 0) {
          gitActivityGraphCacheRef.current[cacheKey] = rawLog;
        }

        setGitActivityGraphError(
          rawLogResult.status === "rejected"
            ? errorMessage(rawLogResult.reason, "Unable to read git history.")
            : null,
        );
        setGitActivityGraph(nextGraph);
      })
      .finally(() => {
        if (!cancelled) {
          setGitActivityGraphLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actions, activeThread, gitActivityRefreshNonce, panelTab, relatedRepoThreads]);

  const gitWorkingTree = gitActivityGraph?.workingTree ?? null;
  const gitWorkingTreeDirty = Boolean(gitWorkingTree?.dirty);
  const commitDraftHasChanges =
    gitWorkingTreeDirty || fileChanges.some((entry) => entry.status !== "failed");
  const gitHasStagedChanges = Boolean(
    gitWorkingTree?.buckets.some(
      (bucket) => bucket.id === "staged" && bucket.entries.length > 0,
    ),
  );
  const gitCommitBranchLabel =
    gitActivityGraph?.branchLabel ||
    activeThread?.thread.gitInfo?.branch ||
    "current branch";

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
  const projectPickerEntries = useMemo(
    () =>
      snapshot.directoryCatalogRoot === projectPickerPath
        ? snapshot.directoryCatalog.filter(
            (entry) => entry.kind === "directory",
          )
        : [],
    [projectPickerPath, snapshot.directoryCatalog, snapshot.directoryCatalogRoot],
  );
  const projectPickerParentPath = useMemo(
    () => parentDirectoryPath(projectPickerPath),
    [projectPickerPath],
  );
  const projectPickerBreadcrumbs = useMemo(
    () => buildAbsolutePathBreadcrumbs(projectPickerPath),
    [projectPickerPath],
  );

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

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setTabIds((current) => {
        if (current.includes(activeThreadId)) {
          return current;
        }

        return [activeThreadId, ...current.filter((entry) => entry !== activeThreadId)].slice(0, 6);
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThreadId]);

  useLayoutEffect(() => {
    if (!activeThreadId) {
      return;
    }

    if (pendingChatRestoreThreadIdRef.current === activeThreadId) {
      return;
    }

    delete chatScrollStateRef.current[activeThreadId];
    setVisibleTurnStartByThreadId((current) => {
      if (!(activeThreadId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[activeThreadId];
      return next;
    });
    chatPinnedToBottomRef.current = true;
    pendingHistoryPrependRef.current = null;
    hydratedScrollKeyRef.current = null;
  }, [activeThreadId]);

  const activeConversationHydrationPending = useMemo(
    () =>
      snapshot.transport.mode === "live" &&
      snapshot.transport.status === "connected" &&
      Boolean(activeThread) &&
      isExistingThreadHistoryPending(activeThread, activeTurns),
    [activeThread, activeTurns, snapshot.transport.mode, snapshot.transport.status],
  );

  const routeConversationLoaderPending = useMemo(() => {
    if (
      route.section !== "chat" ||
      !route.threadId ||
      snapshot.transport.mode !== "live"
    ) {
      return false;
    }

    if (snapshot.transport.status === "connecting") {
      return true;
    }

    if (snapshot.transport.status !== "connected") {
      return false;
    }

    if (!activeThread || activeThread.thread.id !== route.threadId) {
      const routeThreadKnown = snapshot.threads.some(
        (record) => record.thread.id === route.threadId,
      );
      return snapshot.threads.length === 0 || routeThreadKnown;
    }

    return isExistingThreadHistoryPending(activeThread, activeTurns);
  }, [
    activeThread,
    activeTurns,
    route.section,
    route.threadId,
    snapshot.threads,
    snapshot.transport.mode,
    snapshot.transport.status,
  ]);

  const existingThreadHistoryPending = useMemo(
    () =>
      route.threadId === activeThread?.thread.id &&
      activeConversationHydrationPending,
    [activeConversationHydrationPending, activeThread?.thread.id, route.threadId],
  );

  useEffect(() => {
    if (!showStartupConnectionLoader) {
      return;
    }

    if (snapshot.transport.status === "connecting") {
      initialTransportConnectSeenRef.current = true;
      return;
    }

    if (!initialTransportConnectSeenRef.current) {
      return;
    }

    if (routeConversationLoaderPending) {
      return;
    }

    setShowStartupConnectionLoader(false);
  }, [routeConversationLoaderPending, showStartupConnectionLoader, snapshot.transport.status]);

  const requestQueuePump = useCallback(() => {
    setQueueWakeSignal((current) => current + 1);
  }, []);

  const syncMaterializedThreadId = useCallback(
    (
      previousThreadId: string,
      nextThreadId: string,
      section: RouteSection = "chat",
    ) => {
      if (!previousThreadId || !nextThreadId || previousThreadId === nextThreadId) {
        return;
      }

      setTabIds((current) => {
        const replaced = current.map((entry) => (entry === previousThreadId ? nextThreadId : entry));
        if (!replaced.includes(nextThreadId)) {
          replaced.unshift(nextThreadId);
        }

        return [...new Set(replaced)].slice(0, 6);
      });

      setQueuedByThreadId((current) => {
        const previousQueue = current[previousThreadId] ?? [];
        if (previousQueue.length === 0) {
          return current;
        }

        const next = { ...current };
        delete next[previousThreadId];
        next[nextThreadId] = [...previousQueue, ...(next[nextThreadId] ?? [])];
        return next;
      });

      if (queueProcessingRef.current[previousThreadId]) {
        queueProcessingRef.current[nextThreadId] = queueProcessingRef.current[previousThreadId];
        delete queueProcessingRef.current[previousThreadId];
      }

      if (queueAwaitingIdleRef.current[previousThreadId]) {
        queueAwaitingIdleRef.current[nextThreadId] = queueAwaitingIdleRef.current[previousThreadId];
        delete queueAwaitingIdleRef.current[previousThreadId];
      }

      if (chatScrollStateRef.current[previousThreadId]) {
        chatScrollStateRef.current[nextThreadId] = chatScrollStateRef.current[previousThreadId];
        delete chatScrollStateRef.current[previousThreadId];
      }

      if (pendingChatRestoreThreadIdRef.current === previousThreadId) {
        pendingChatRestoreThreadIdRef.current = nextThreadId;
      }

      if (pendingHistoryPrependRef.current?.threadId === previousThreadId) {
        pendingHistoryPrependRef.current = {
          ...pendingHistoryPrependRef.current,
          threadId: nextThreadId,
        };
      }

      setVisibleTurnStartByThreadId((current) => {
        if (!(previousThreadId in current)) {
          return current;
        }

        const next = { ...current };
        next[nextThreadId] = next[previousThreadId] ?? next[nextThreadId] ?? 0;
        delete next[previousThreadId];
        return next;
      });

      if (route.threadId === previousThreadId) {
        if (section === "chat") {
          void navigate({
            to: "/threads/$threadId",
            params: { threadId: nextThreadId } as never,
          });
        } else {
          void navigate({
            to: "/threads/$threadId/$section",
            params: {
              threadId: nextThreadId,
              section: routeSectionToSegment(section),
            } as never,
          });
        }
      }

      requestQueuePump();
    },
    [navigate, requestQueuePump, route.threadId],
  );

  const sendComposerAndSyncThread = useCallback(
    async (
      args: Parameters<WorkspaceActions["sendComposer"]>[0],
      section: RouteSection = "chat",
    ) => {
      try {
        const nextThreadId = await actions.sendComposer(args);
        syncMaterializedThreadId(args.threadId, nextThreadId, section);
        return nextThreadId;
      } catch (error) {
        const materializedThreadId = getMaterializedThreadId(error);
        if (materializedThreadId) {
          syncMaterializedThreadId(args.threadId, materializedThreadId, section);
        }

        throw error;
      }
    },
    [actions, syncMaterializedThreadId],
  );

  const updateQuestionAnswer = useCallback(
    (requestId: string, questionId: string, value: string) => {
      setQuestionAnswersByRequestId((current) => ({
        ...current,
        [requestId]: {
          ...(current[requestId] ?? {}),
          [questionId]: value,
        },
      }));
    },
    [],
  );

  const submitQuestionApproval = useCallback(
    async (approval: ApprovalRequest) => {
      const answers = buildQuestionAnswerPayload(
        approval,
        questionAnswersByRequestId[approval.id] ?? {},
      );

      await actions.submitQuestion(approval.id, answers);
      setQuestionAnswersByRequestId((current) => {
        if (!(approval.id in current)) {
          return current;
        }

        const next = { ...current };
        delete next[approval.id];
        return next;
      });
    },
    [actions, questionAnswersByRequestId],
  );

  const updateMcpResponseDraft = useCallback((requestId: string, value: string) => {
    setMcpResponseByRequestId((current) => ({
      ...current,
      [requestId]: value,
    }));
  }, []);

  const resolvePendingApproval = useCallback(
    async (approval: ApprovalRequest, decision: ApprovalDecision) => {
      await actions.resolveApproval(approval.id, decision);
    },
    [actions],
  );

  const submitMcpApproval = useCallback(
    async (approval: ApprovalRequest, action: "accept" | "decline" | "cancel") => {
      await actions.submitMcp(
        approval.id,
        action,
        mcpResponseByRequestId[approval.id] ?? "",
      );
      setMcpResponseByRequestId((current) => {
        if (!(approval.id in current)) {
          return current;
        }

        const next = { ...current };
        delete next[approval.id];
        return next;
      });
    },
    [actions, mcpResponseByRequestId],
  );

  const renderApprovalRequest = useCallback(
    (approval: ApprovalRequest) =>
      approval.kind === "question" ? (
        <QuestionRequestCard
          answers={questionAnswersByRequestId[approval.id] ?? {}}
          approval={approval}
          key={approval.id}
          onAnswerChange={(questionId, value) =>
            updateQuestionAnswer(approval.id, questionId, value)
          }
          onSubmit={() => void submitQuestionApproval(approval)}
        />
      ) : (
        <ApprovalRequestCard
          approval={approval}
          key={approval.id}
          mcpContentText={mcpResponseByRequestId[approval.id] ?? ""}
          onMcpContentChange={(value) => updateMcpResponseDraft(approval.id, value)}
          onResolve={(decision) => void resolvePendingApproval(approval, decision)}
          onSubmitMcp={(action) => void submitMcpApproval(approval, action)}
        />
      ),
    [
      mcpResponseByRequestId,
      questionAnswersByRequestId,
      resolvePendingApproval,
      submitMcpApproval,
      submitQuestionApproval,
      updateMcpResponseDraft,
      updateQuestionAnswer,
    ],
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
    if (route.section !== "review") {
      return;
    }

    const targetDiffId =
      reviewDiffId && diffEntries.some((entry) => entry.id === reviewDiffId)
        ? reviewDiffId
        : diffEntries[0]?.id ?? null;

    setSelectedDiffEntryId((current) =>
      current === targetDiffId ? current : targetDiffId,
    );
  }, [diffEntries, reviewDiffId, route.section]);

  useEffect(() => {
    if (!selectedDiffEntryId || !diffEntries.some((entry) => entry.id === selectedDiffEntryId)) {
      const frame = window.requestAnimationFrame(() => {
        setSelectedDiffEntryId(diffEntries[0]?.id ?? null);
      });

      return () => {
        window.cancelAnimationFrame(frame);
      };
    }
  }, [diffEntries, selectedDiffEntryId]);

  useEffect(() => {
    if (snapshot.transport.mode === "live" && snapshot.transport.status !== "connected") {
      return;
    }

    Object.entries(queuedByThreadId).forEach(([threadId, queue]) => {
      if (queue.length === 0 || queueProcessingRef.current[threadId]) {
        return;
      }

      const threadRecord = snapshot.threads.find((entry) => entry.thread.id === threadId);
      const hasInProgressTurn = threadRecord?.thread.turns.some((turn) => turn.status === "inProgress") ?? false;

      if (queueAwaitingIdleRef.current[threadId]) {
        if (hasInProgressTurn) {
          return;
        }

        delete queueAwaitingIdleRef.current[threadId];
      }

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
          const remaining = { ...current };
          delete remaining[threadId];
          return remaining;
        }

        return {
          ...current,
          [threadId]: rest,
        };
      });

      void sendComposerAndSyncThread({
          threadId,
          mode: nextMessage.mode,
          prompt: nextMessage.prompt,
          mentions: nextMessage.mentions,
          skills: nextMessage.skills,
          images: nextMessage.images,
          files: nextMessage.files,
          settings: effectiveComposerSettings,
        })
        .then((resolvedThreadId) => {
          queueAwaitingIdleRef.current[resolvedThreadId] = true;
        })
        .catch((error) => {
          const resolvedThreadId = getMaterializedThreadId(error) ?? threadId;
          setQueuedByThreadId((current) => ({
            ...current,
            [resolvedThreadId]: [nextMessage, ...(current[resolvedThreadId] ?? [])],
          }));
          requestQueuePump();
        })
        .finally(() => {
          delete queueProcessingRef.current[threadId];
        });
    });
  }, [
    effectiveComposerSettings,
    queuedByThreadId,
    queueWakeSignal,
    requestQueuePump,
    sendComposerAndSyncThread,
    snapshot.threads,
    snapshot.transport.mode,
    snapshot.transport.status,
  ]);

  useEffect(() => {
    const wakeIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      requestQueuePump();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestQueuePump();
      }
    };

    window.addEventListener("focus", wakeIfVisible);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", wakeIfVisible);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [requestQueuePump]);

  useLayoutEffect(() => {
    if (route.section === "editor" || route.section === "review") {
      setPanelOpen(false);
      return;
    }

    if (!desktopViewport && mobilePanelClosing) {
      setPanelOpen(false);
      return;
    }

    if (!routePanel) {
      if (!desktopViewport) {
        setPanelOpen(false);
      }
      return;
    }

    setPanelTab((current) => {
      if (current === routePanel) {
        return current;
      }

      if (routePanel === "files" && current === "graph") {
        return current;
      }

      return routePanel;
    });
    setPanelOpen((current) => (current ? current : true));
  }, [desktopViewport, mobilePanelClosing, route.section, routePanel]);

  useEffect(() => {
    if (!mobilePanelClosing) {
      return;
    }

    if (desktopViewport || !routePanel) {
      setMobilePanelClosing(false);
    }
  }, [desktopViewport, mobilePanelClosing, routePanel]);

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

    const frame = window.requestAnimationFrame(() => {
      setExplorerPath((current) => (current && isPathWithinRoot(cwd, current) ? current : cwd));
      setFilePreview((current) => (current && isPathWithinRoot(cwd, current.path) ? current : null));
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.thread.cwd]);

  useEffect(() => {
    if (!activeExplorerPath) {
      return;
    }

    void actions.loadDirectory(activeExplorerPath);
  }, [actions, activeExplorerPath]);

  useEffect(() => {
    if (!projectPickerOpen) {
      return;
    }

    void actions.loadDirectory(projectPickerPath);
  }, [actions, projectPickerOpen, projectPickerPath]);

  useEffect(() => {
    if (route.section !== "editor" || !editorPath) {
      return;
    }

    if (
      filePreview?.path === editorPath &&
      !filePreview.loading &&
      filePreview.error === null
    ) {
      return;
    }

    const normalizedName =
      editorPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ??
      editorPath;

    let cancelled = false;

    void actions
      .readFile(editorPath)
      .then((content) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setFilePreview({
            path: editorPath,
            name: normalizedName,
            content,
            loading: false,
            error: null,
            line: editorLine,
          });
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setFilePreview({
          path: editorPath,
          name: normalizedName,
          content: "",
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to open this file.",
          line: editorLine,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [actions, editorLine, editorPath, filePreview, route.section]);

  useEffect(() => {
    if (route.section !== "editor" || !editorPath) {
      editorTrackingTargetRef.current = "";
      editorFileChangeActivityKeyRef.current = "";
      setEditorHasUnsavedChanges(false);
      return;
    }

    const trackingTarget = `${route.section}:${editorPath}`;
    if (editorTrackingTargetRef.current === trackingTarget) {
      return;
    }

    editorTrackingTargetRef.current = trackingTarget;
    editorFileChangeActivityKeyRef.current = editorFileChangeActivityKey;
    setEditorHasUnsavedChanges(false);
  }, [editorFileChangeActivityKey, editorPath, route.section]);

  useEffect(() => {
    if (
      route.section !== "editor" ||
      !editorPath ||
      !editorFileChangeActivityKey ||
      editorHasUnsavedChanges ||
      filePreview?.path !== editorPath ||
      filePreview.loading
    ) {
      return;
    }

    if (editorFileChangeActivityKeyRef.current === editorFileChangeActivityKey) {
      return;
    }

    editorFileChangeActivityKeyRef.current = editorFileChangeActivityKey;
    const normalizedName =
      editorPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ??
      editorPath;
    const previousContent = filePreview.content;
    let cancelled = false;
    let retryTimer: number | null = null;

    const refreshOpenEditor = async (allowRetry: boolean) => {
      try {
        const nextContent = await actions.readFile(editorPath);
        if (cancelled) {
          return;
        }

        if (allowRetry && nextContent === previousContent) {
          retryTimer = window.setTimeout(() => {
            void refreshOpenEditor(false);
          }, 160);
          return;
        }

        startTransition(() => {
          setFilePreview((current) =>
            current?.path === editorPath
              ? {
                  ...current,
                  content: nextContent,
                  loading: false,
                  error: null,
                  line: editorLine,
                }
              : current,
          );
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setFilePreview({
          path: editorPath,
          name: normalizedName,
          content: previousContent,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to refresh this file.",
          line: editorLine,
        });
      }
    };

    void refreshOpenEditor(true);

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [
    actions,
    editorFileChangeActivityKey,
    editorHasUnsavedChanges,
    editorLine,
    editorPath,
    filePreview,
    route.section,
  ]);

  useEffect(() => {
    const liveMode = snapshot.transport.mode === "live";
    const streamEntries = snapshot.streams;

    if (liveMode) {
      const frame = window.requestAnimationFrame(() => {
        const nextVisible: Record<string, number> = {};

        for (const entry of streamEntries) {
          const target = getStreamTarget(entry);
          nextVisible[entry.key] = target;
        }

        streamVisibleRef.current = nextVisible;
        startTransition(() => {
          setStreamVisible(nextVisible);
        });
      });

      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    const syncVisible = () => {
      const currentVisible = streamVisibleRef.current;
      let changed = Object.keys(currentVisible).length !== streamEntries.length;
      const nextVisible: Record<string, number> = {};

      for (const entry of streamEntries) {
        const target = getStreamTarget(entry);
        const nextValue = Math.min(currentVisible[entry.key] ?? 0, target);
        nextVisible[entry.key] = nextValue;
        if ((currentVisible[entry.key] ?? undefined) !== nextValue) {
          changed = true;
        }
      }

      if (changed) {
        streamVisibleRef.current = nextVisible;
        startTransition(() => {
          setStreamVisible(nextVisible);
        });
      }
    };

    const frame = window.requestAnimationFrame(syncVisible);

    const timer = window.setInterval(() => {
      const currentVisible = streamVisibleRef.current;
      const nextVisible: Record<string, number> = {};
      let changed = Object.keys(currentVisible).length !== streamEntries.length;

      for (const entry of streamEntries) {
        const target = getStreamTarget(entry);
        const value = Math.min(currentVisible[entry.key] ?? 0, target);
        const backlog = target - value;
        const speed = Math.max(1, entry.speed, Math.ceil(backlog / 5));
        const nextValue =
          value < target ? Math.min(target, value + speed) : value;

        nextVisible[entry.key] = nextValue;
        if (nextValue !== value) {
          changed = true;
        }
      }

      if (!changed) {
        return;
      }

      streamVisibleRef.current = nextVisible;
      startTransition(() => {
        setStreamVisible(nextVisible);
      });
    }, 24);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [snapshot.streams, snapshot.transport.mode]);

  const isChatNearBottom = useCallback((node: HTMLDivElement) => {
    const remaining = node.scrollHeight - node.scrollTop - node.clientHeight;
    return remaining <= 72;
  }, []);

  const saveChatScrollState = useCallback((threadId = activeThreadId) => {
    const node = chatRef.current;
    if (!node || !threadId) {
      return;
    }

    const pinned = isChatNearBottom(node);
    chatPinnedToBottomRef.current = pinned;
    setShowScrollToBottomButton((current) => (current === !pinned ? current : !pinned));
    chatScrollStateRef.current[threadId] = {
      pinned,
      top: node.scrollTop,
    };
  }, [activeThreadId, isChatNearBottom]);

  const revealOlderTurns = useCallback(() => {
    if (!activeThreadId || activeVisibleTurnStart <= 0 || existingThreadHistoryPending) {
      return;
    }

    const node = chatRef.current;
    if (!node) {
      return;
    }

    if (pendingHistoryPrependRef.current?.threadId === activeThreadId) {
      return;
    }

    pendingHistoryPrependRef.current = {
      threadId: activeThreadId,
      previousHeight: node.scrollHeight,
      previousTop: node.scrollTop,
    };

    setVisibleTurnStartByThreadId((current) => {
      const currentStart = current[activeThreadId] ?? activeDefaultVisibleTurnStart;
      const nextStart = Math.max(0, currentStart - TURN_HISTORY_BATCH);
      if (nextStart === currentStart) {
        pendingHistoryPrependRef.current = null;
        return current;
      }

      return {
        ...current,
        [activeThreadId]: nextStart,
      };
    });
  }, [activeDefaultVisibleTurnStart, activeThreadId, activeVisibleTurnStart, existingThreadHistoryPending]);

  const flushChatToBottom = useCallback((force = false) => {
    const node = chatRef.current;
    if (!node) {
      return;
    }

    if (!force && !chatPinnedToBottomRef.current) {
      return;
    }

    node.scrollTop = node.scrollHeight;
    chatPinnedToBottomRef.current = true;
    setShowScrollToBottomButton(false);
    if (activeThreadId) {
      chatScrollStateRef.current[activeThreadId] = {
        pinned: true,
        top: node.scrollTop,
      };
    }
  }, [activeThreadId]);

  useEffect(() => {
    const node = chatRef.current;
    if (!node || !activeThreadId || route.section === "editor" || route.section === "review") {
      return;
    }

    const syncPinnedState = () => {
      const pinned = isChatNearBottom(node);
      chatPinnedToBottomRef.current = pinned;
      setShowScrollToBottomButton((current) => (current === !pinned ? current : !pinned));
      chatScrollStateRef.current[activeThreadId] = {
        pinned,
        top: node.scrollTop,
      };
    };

    syncPinnedState();
    const handleScroll = () => {
      syncPinnedState();
      if (node.scrollTop <= 48) {
        revealOlderTurns();
      }
    };

    node.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      syncPinnedState();
      node.removeEventListener("scroll", handleScroll);
    };
  }, [activeThreadId, isChatNearBottom, revealOlderTurns, route.section]);

  const scrollChatToBottom = useCallback((options?: { extraDelay?: boolean; force?: boolean }) => {
    let frame: number | null = null;
    let timeout: number | null = null;
    let attempts = 0;

    const run = () => {
      flushChatToBottom(options?.force ?? false);

      const node = chatRef.current;
      if (!node) {
        return;
      }

      const remaining = node.scrollHeight - node.scrollTop - node.clientHeight;
      attempts += 1;
      if (remaining > 2 && attempts < 8) {
        frame = window.requestAnimationFrame(run);
      }
    };

    frame = window.requestAnimationFrame(run);
    timeout = options?.extraDelay ? window.setTimeout(run, 90) : null;

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };
  }, [flushChatToBottom]);

  useLayoutEffect(() => {
    if (!chatRef.current) {
      return;
    }

    flushChatToBottom();
  }, [flushChatToBottom, streamVisible, transcriptScrollKey]);

  useLayoutEffect(() => {
    if (!activeThreadId || route.section === "editor" || route.section === "review") {
      return;
    }

    const saved =
      pendingChatRestoreThreadIdRef.current === activeThreadId
        ? chatScrollStateRef.current[activeThreadId]
        : undefined;
    chatPinnedToBottomRef.current = saved?.pinned ?? true;
    setShowScrollToBottomButton(!(saved?.pinned ?? true));
  }, [activeThreadId, route.section]);

  useLayoutEffect(() => {
    if (!activeThreadId || route.section === "editor" || route.section === "review") {
      return;
    }

    const restore = () => {
      const node = chatRef.current;
      if (!node) {
        return;
      }

      const shouldRestoreSavedScroll =
        pendingChatRestoreThreadIdRef.current === activeThreadId;
      const saved = shouldRestoreSavedScroll
        ? chatScrollStateRef.current[activeThreadId]
        : undefined;

      if (!shouldRestoreSavedScroll) {
        flushChatToBottom(true);
        return;
      }

      if (!saved) {
        pendingChatRestoreThreadIdRef.current = null;
        flushChatToBottom(true);
        return;
      }

      if (saved.pinned) {
        pendingChatRestoreThreadIdRef.current = null;
        flushChatToBottom(true);
        return;
      }

      const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      node.scrollTop = Math.min(saved.top, maxScrollTop);
      pendingChatRestoreThreadIdRef.current = null;
      saveChatScrollState(activeThreadId);
    };

    restore();
    const frame = window.requestAnimationFrame(restore);
    const timeout = window.setTimeout(restore, 90);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [activeThreadId, flushChatToBottom, route.section, saveChatScrollState]);

  useLayoutEffect(() => {
    const pending = pendingHistoryPrependRef.current;
    if (!pending || pending.threadId !== activeThreadId) {
      return;
    }

    const node = chatRef.current;
    if (!node) {
      return;
    }

    const heightDelta = node.scrollHeight - pending.previousHeight;
    node.scrollTop = pending.previousTop + heightDelta;
    pendingHistoryPrependRef.current = null;
    saveChatScrollState(activeThreadId);
  }, [activeThreadId, renderedTurns.length, saveChatScrollState]);

  useEffect(() => () => {
    if (route.section === "editor" || route.section === "review") {
      return;
    }

    saveChatScrollState(activeThreadId);
  }, [activeThreadId, route.section, saveChatScrollState]);

  useEffect(() => {
    if (!activeThreadId) {
      setShowScrollToBottomButton(false);
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
    return scrollChatToBottom({ extraDelay: true, force: true });
  }, [activeThreadId, activeTurns, existingThreadHistoryPending, scrollChatToBottom]);

  const jumpToLatestMessages = useCallback(() => {
    scrollChatToBottom({ extraDelay: true, force: true });
  }, [scrollChatToBottom]);

  useEffect(() => () => selectedImages.forEach((image) => image.url.startsWith("blob:") && URL.revokeObjectURL(image.url)), [selectedImages]);

  const pushToast = useCallback((message: string, tone: ToastTone) => {
    const id = nextId("toast");

    setToasts((current) => [...current, { id, message, tone }]);

    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      delete toastTimersRef.current[id];
    }, 2600);

    toastTimersRef.current[id] = timer;
  }, []);

  const refreshGitPanel = useCallback(() => {
    gitActivityGraphCacheRef.current = {};
    setGitActivityRefreshNonce((current) => current + 1);
  }, []);

  const refreshWorkspacePanelsAfterRollback = useCallback(async () => {
    refreshGitPanel();
    setSelectedDiffEntryId(null);

    const preferredDirectory = activeExplorerPath ?? activeWorkspaceCwd;
    if (preferredDirectory) {
      try {
        await actions.loadDirectory(preferredDirectory);
      } catch {
        if (activeWorkspaceCwd && activeWorkspaceCwd !== preferredDirectory) {
          setExplorerPath(activeWorkspaceCwd);
          await actions.loadDirectory(activeWorkspaceCwd).catch(() => undefined);
        }
      }
    }

    if (editorPath) {
      const normalizedName =
        editorPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ??
        editorPath;

      setFilePreview({
        path: editorPath,
        name: normalizedName,
        content: "",
        loading: true,
        error: null,
        line: editorLine,
      });
    }
  }, [
    actions,
    activeExplorerPath,
    activeWorkspaceCwd,
    editorLine,
    editorPath,
    refreshGitPanel,
  ]);

  const updateCommitProvider = useCallback(
    async (providerId: ProviderId) => {
      const previous = commitProviderId;
      setCommitProviderId(providerId);

      if (!activeThread) {
        return;
      }

      if (!activeWorkspaceCwd) {
        setCommitProviderId(previous);
        pushToast("Open the repository folder first.", "warn");
        return;
      }

      try {
        const preferences = await actions.writeWorkspaceCommitPreferences(
          activeWorkspaceCwd ?? activeThread.thread.cwd,
          { provider: providerId },
        );
        setCommitPreferencesPath(preferences.filePath);
        refreshGitPanel();
      } catch (error) {
        setCommitProviderId(previous);
        pushToast(
          errorMessage(
            error,
            "Failed to save the commit provider for this project.",
          ),
          "err",
        );
      }
    },
    [
      actions,
      activeThread,
      activeWorkspaceCwd,
      commitProviderId,
      pushToast,
      refreshGitPanel,
    ],
  );

  const generateCommitDraft = useCallback(async () => {
    if (!activeThread || commitGenerating || commitCommitting) {
      return;
    }

    if (!activeWorkspaceCwd) {
      pushToast("Open the repository folder first.", "warn");
      return;
    }

    setCommitGenerating(true);

    try {
      const message = await actions.generateCommitMessage({
        cwd: activeWorkspaceCwd,
        providerId: commitProviderId,
      });
      setCommitMessage(message);
      pushToast("Drafted a commit message.", "ok");
    } catch (error) {
      pushToast(
        errorMessage(error, "Failed to draft a commit message."),
        "err",
      );
    } finally {
      setCommitGenerating(false);
    }
  }, [
    actions,
    activeThread,
    activeWorkspaceCwd,
    commitCommitting,
    commitGenerating,
    commitProviderId,
    pushToast,
  ]);

  const commitWorkingTreeDraft = useCallback(async () => {
    if (!activeThread || commitGenerating || commitCommitting) {
      return;
    }

    if (!activeWorkspaceCwd) {
      pushToast("Open the repository folder first.", "warn");
      return;
    }

    if (!commitMessage.trim()) {
      pushToast("Enter a commit message first.", "warn");
      return;
    }

    setCommitCommitting(true);

    try {
      const result = await actions.commitWorkingTree({
        cwd: activeWorkspaceCwd,
        message: commitMessage,
      });
      setCommitMessage("");
      refreshGitPanel();
      pushToast(
        result.stagedAll
          ? "Staged all files and created the commit."
          : "Created the commit.",
        "ok",
      );
    } catch (error) {
      pushToast(errorMessage(error, "Failed to create the commit."), "err");
    } finally {
      setCommitCommitting(false);
    }
  }, [
    actions,
    activeThread,
    activeWorkspaceCwd,
    commitCommitting,
    commitGenerating,
    commitMessage,
    pushToast,
    refreshGitPanel,
  ]);

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
      setComposerSyncKey((current) => current + 1);
      return resolvedValue;
    },
    [getComposerInputValue],
  );

  const resetComposer = useCallback(() => {
    setComposer("");
    setComposerSyncKey((current) => current + 1);
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
        const rest = { ...current };
        delete rest[threadId];
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
    (
      threadId: string,
      section: RouteSection = "chat",
      options?: { immediate?: boolean },
    ) => {
      if (threadId !== activeThreadId) {
        // A cross-thread open should always behave like a fresh thread load,
        // not like "return to chat" inside the previous thread.
        pendingChatRestoreThreadIdRef.current = null;
        pendingHistoryPrependRef.current = null;
        chatPinnedToBottomRef.current = true;
      }

      const runNavigation = () => {
        if (section === "chat") {
          void navigate({
            to: "/threads/$threadId",
            params: { threadId } as never,
          });
          return;
        }

        void navigate({
          to: "/threads/$threadId/$section",
          params: {
            threadId,
            section: routeSectionToSegment(section),
          } as never,
        });
      };

      // User-driven section changes inside the same thread should feel instant.
      if (options?.immediate || activeThreadId === threadId) {
        runNavigation();
        return;
      }

      startTransition(runNavigation);
    },
    [activeThreadId, navigate],
  );

  const openThreadFromSidebar = useCallback((threadId: string) => {
    pendingChatRestoreThreadIdRef.current = null;
    pendingHistoryPrependRef.current = null;
    hydratedScrollKeyRef.current = null;
    chatPinnedToBottomRef.current = true;
    setShowScrollToBottomButton(false);
    delete chatScrollStateRef.current[threadId];
    setVisibleTurnStartByThreadId((current) => {
      if (!(threadId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[threadId];
      return next;
    });
    setSidebarOpen(false);
    navigateToThread(threadId, "chat", { immediate: true });

    if (threadId === activeThreadId) {
      window.requestAnimationFrame(() => {
        scrollChatToBottom({ extraDelay: true, force: true });
      });
    }
  }, [activeThreadId, navigateToThread, scrollChatToBottom]);

  const openThreadFile = useCallback(
    (
      path: string,
      options?: {
        line?: number | null;
        source?: RouteSection;
      },
    ) => {
      if (!activeThreadId) {
        return;
      }

      const nextLine =
        typeof options?.line === "number" && options.line > 0
          ? options.line
          : null;
      const source = options?.source ?? "chat";
      const normalizedName =
        path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;

      saveChatScrollState();
      if (source === "chat") {
        pendingChatRestoreThreadIdRef.current = activeThreadId;
      }

      setFilePreview((current) =>
        current?.path === path
          ? {
              ...current,
              loading: true,
              error: null,
              line: nextLine,
            }
          : {
              path,
              name: normalizedName,
              content: "",
              loading: true,
              error: null,
              line: nextLine,
            },
      );

      void navigate({
        to: "/threads/$threadId/$section",
        params: {
          threadId: activeThreadId,
          section: routeSectionToSegment("editor"),
        } as never,
        search: {
          path,
          line: nextLine ? String(nextLine) : undefined,
          from: source,
        } as never,
      });
    },
    [activeThreadId, navigate, saveChatScrollState],
  );

  const openPanel = useCallback(
    (tab: PanelTab) => {
      if (tab === "terminal") {
        setTerminalDockPrimed(true);
        setToolbarShell(true);
        return;
      }

      setMobilePanelClosing(false);
      setPanelTab(tab);
      setPanelOpen(true);
      setSidebarOpen(false);

      if (activeThreadId) {
        navigateToThread(activeThreadId, panelToSection(tab));
      }
    },
    [activeThreadId, navigateToThread],
  );

  const toggleSidebar = useCallback(() => {
    if (desktopViewport) {
      return;
    }

    setMobilePanelClosing(false);
    setPanelOpen(false);
    setSidebarOpen((current) => !current);
  }, [desktopViewport]);

  const reviewDiff = useCallback(
    (diffId?: string, source: RouteSection = "chat") => {
      if (!activeThreadId) {
        return;
      }

      const nextDiffId =
        diffId ?? selectedDiffEntry?.id ?? diffEntries[0]?.id ?? null;

      if (nextDiffId) {
        setSelectedDiffEntryId(nextDiffId);
      }

      saveChatScrollState();
      if (source === "chat") {
        pendingChatRestoreThreadIdRef.current = activeThreadId;
      }

      void navigate({
        to: "/threads/$threadId/$section",
        params: {
          threadId: activeThreadId,
          section: routeSectionToSegment("review"),
        } as never,
        search: {
          diff: nextDiffId ?? undefined,
          from: source,
        } as never,
      });
    },
    [activeThreadId, diffEntries, navigate, saveChatScrollState, selectedDiffEntry],
  );

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    if (!activeThreadId) {
      return;
    }

    if (!desktopViewport) {
      setMobilePanelClosing(true);
      window.requestAnimationFrame(() => {
        navigateToThread(activeThreadId, "chat", { immediate: true });
      });
      return;
    }

    navigateToThread(activeThreadId, "chat", { immediate: true });
  }, [activeThreadId, desktopViewport, navigateToThread]);

  useEffect(() => {
    if (route.section === "skills") {
      setSkillsModalOpen(true);
    }
  }, [route.section]);

  const openSkillsLibrary = useCallback(() => {
    setSkillsModalOpen(true);
    setSidebarOpen(false);
  }, []);

  const closeSkillsLibrary = useCallback(() => {
    setSkillsModalOpen(false);
    if (route.section === "skills" && activeThreadId) {
      navigateToThread(activeThreadId, "chat");
    }
  }, [activeThreadId, navigateToThread, route.section]);

  const openThemePicker = useCallback(() => {
    setThemePickerOpen(true);
    setSidebarOpen(false);
    setModelPickerOpen(false);
    setCommandOpen(false);
  }, []);

  const closeThemePicker = useCallback(() => {
    setThemePickerOpen(false);
  }, []);

  const createSessionInCwd = useCallback(
    async (cwd: string) => {
      if (projectPickerStarting) {
        return null;
      }

      setProjectPickerStarting(true);

      try {
        const threadId = await actions.createThread(effectiveComposerSettings, {
          title: "New Session",
          cwd,
        });

        setProjectPickerPath(cwd);
        setTabIds((current) =>
          [threadId, ...current.filter((entry) => entry !== threadId)].slice(
            0,
            6,
          ),
        );
        navigateToThread(threadId, "chat");
        setSidebarOpen(false);
        setPanelOpen(desktopViewport);
        resetComposer();
        pushToast(`New session — ${cwd}`, "ok");
        return threadId;
      } catch (error) {
        const message = errorMessage(
          error,
          snapshot.transport.error ?? "Failed to start session",
        );
        pushToast(message, "err");
        return null;
      } finally {
        setProjectPickerStarting(false);
      }
    },
    [
      actions,
      desktopViewport,
      effectiveComposerSettings,
      navigateToThread,
      projectPickerStarting,
      pushToast,
      resetComposer,
      snapshot.transport.error,
    ],
  );

  const openProjectPicker = useCallback(() => {
    setProjectPickerPath((current) => {
      if (current && current.trim().length > 0) {
        return current;
      }

      return activeThread?.thread.cwd ?? FALLBACK_DATA.directoryCatalogRoot ?? ".";
    });
    setProjectPickerOpen(true);
    setSidebarOpen(false);
    setCommandOpen(false);
  }, [activeThread]);

  const confirmProjectPicker = useCallback(async (cwd?: string) => {
    const threadId = await createSessionInCwd(cwd ?? projectPickerPath);
    if (threadId) {
      setProjectPickerOpen(false);
    }
  }, [createSessionInCwd, projectPickerPath]);

  const createSession = useCallback(async () => {
    openProjectPicker();
  }, [openProjectPicker]);

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

  const [rollbackPendingTurnId, setRollbackPendingTurnId] = useState<string | null>(null);

  const rollbackTurn = useCallback(async (turnId: string) => {
    if (!activeThreadId) {
      return;
    }

    if (rollbackPendingTurnId) {
      return;
    }

    if (activeTurn) {
      pushToast("Wait for the current response to finish before rolling back.", "err");
      return;
    }

    const confirmed = window.confirm(
      "Roll back from this prompt? This will remove this prompt and every later message, then undo the file changes from those turns.",
    );
    if (!confirmed) {
      return;
    }

    const rollbackPrompt =
      activeTurns
        .find((turn) => turn.id === turnId)
        ?.items.filter(
          (
            item,
          ): item is Extract<ThreadItem, { type: "userMessage" }> =>
            item.type === "userMessage",
        )
        .map((item) => getUserText(item, snapshot.settings.provider))
        .find((value) => value.trim().length > 0) ?? "";

    try {
      setRollbackPendingTurnId(turnId);
      await actions.rollbackToTurn(activeThreadId, turnId);
      await refreshWorkspacePanelsAfterRollback();
      if (rollbackPrompt.trim().length > 0) {
        setComposerMode("chat");
        setComposerFromInput(rollbackPrompt);
        focusComposerEnd(rollbackPrompt);
      }
      pushToast("/rollback — reverted to selected prompt", "ok");
    } catch (error) {
      pushToast(
        errorMessage(error, "Failed to roll back from the selected prompt."),
        "err",
      );
    } finally {
      setRollbackPendingTurnId((current) => (current === turnId ? null : current));
    }
  }, [
    actions,
    activeThreadId,
    activeTurn,
    activeTurns,
    focusComposerEnd,
    pushToast,
    rollbackPendingTurnId,
    refreshWorkspacePanelsAfterRollback,
    setComposerFromInput,
    snapshot.settings.provider,
  ]);

  const selectModel = useCallback(
    async (modelId: string) => {
      await actions.updateSettings({ model: modelId });
      setModelPickerOpen(false);
      pushToast(`Model: ${modelId}`, "");
    },
    [actions, pushToast],
  );

  const selectTheme = useCallback((themeId: UiThemeId) => {
    setUiTheme(themeId);
    setThemePickerOpen(false);
    pushToast(`Theme: ${themeId}`, "");
  }, [pushToast]);

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
        setThemePickerOpen(false);
        setProjectPickerOpen(false);
        setContextMenu(null);
        closeQuickPicker();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeQuickPicker, createSession, pushToast]);

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

      if (!target.closest("#htheme") && !target.closest("#tpicker")) {
        setThemePickerOpen(false);
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
            await sendComposerAndSyncThread({
              threadId: activeThreadId,
              mode: "review",
              prompt: restText,
              mentions: activeComposerMentions,
              skills: selectedSkills,
              files: selectedFiles,
              images: selectedImages,
              settings: effectiveComposerSettings,
            }, "review");
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
          openSkillsLibrary();
          break;
        case "/mcp":
          openPanel("config");
          if (activeThreadId) {
            navigateToThread(activeThreadId, "mcp");
          }
          break;
        case "/theme":
          openThemePicker();
          pushToast("Theme picker opened", "ok");
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
        case "/feedback":
        case "/apps":
        case "/exit":
        case "/quit":
        case "/personality":
          pushToast(`${command} queued`, "");
          break;
        case "/logout":
          await actions.logoutAccount();
          pushToast("Signed out of account", "ok");
          break;
        default:
          if (inline && activeThreadId) {
            await sendComposerAndSyncThread({
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
      openThemePicker,
      openSkillsLibrary,
      pushToast,
      resetComposer,
      sendComposerAndSyncThread,
      focusComposerEnd,
      selectedImages,
      selectedFiles,
      activeComposerMentions,
      selectedSkills,
      setComposerFromInput,
      effectiveComposerSettings,
    ],
  );

  const commandPaletteGroups = useMemo<Array<CommandPaletteGroup>>(() => {
    const groups: Array<CommandPaletteGroup> = [
      {
        label: "Session",
        items: [
          { icon: "💬", name: "New Session (/new)", key: "⌘N", command: { type: "createSession" } },
          { icon: "⑂", name: "Fork Session (/fork)", key: "", command: { type: "forkSession" } },
          { icon: "🗜", name: "Compact Transcript (/compact)", key: "", command: { type: "compactSession" } },
          { icon: "🗑", name: "Clear Composer", key: "", command: { type: "resetComposer" } },
        ],
      },
      {
        label: "Navigate",
        items: [
          { icon: "📁", name: "Files Panel", key: "", command: { type: "openPanel", tab: "files" } },
          { icon: "⎇", name: "Branches Panel", key: "", command: { type: "openPanel", tab: "graph" } },
          { icon: "⬛", name: "Terminal Dock (/ps)", key: "", command: { type: "openPanel", tab: "terminal" } },
          { icon: "⑂", name: "Multi-agent Panel", key: "", command: { type: "openPanel", tab: "agents" } },
          { icon: "📋", name: "Skills Library (/skills)", key: "", command: { type: "openSkills" } },
          { icon: "⚙", name: "Config & Feature Flags", key: "⌘,", command: { type: "openPanel", tab: "config" } },
        ],
      },
      {
        label: "Slash",
        items: SLASH_COMMANDS.map((entry) => ({
          icon: "/",
          name: `${entry.cmd} — ${entry.dsc}`,
          key: "",
          command: { type: "runSlash", slash: entry.cmd },
        })),
      },
      ...(modelOptions.length > 0
        ? [
            {
              label: "Model",
              items: modelOptions.map((entry) => ({
                icon: "🤖",
                name: entry.displayName,
                key: "",
                command: { type: "selectModel" as const, modelId: entry.id },
              })),
            },
          ]
        : []),
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

  const runCommandPaletteItem = useCallback(
    (command: CommandPaletteAction) => {
      switch (command.type) {
        case "createSession":
          void createSession();
          break;
        case "forkSession":
          void forkSession();
          break;
        case "compactSession":
          void compactSession();
          break;
        case "openSkills":
          openSkillsLibrary();
          break;
        case "resetComposer":
          resetComposer();
          break;
        case "openPanel":
          openPanel(command.tab);
          break;
        case "runSlash":
          void runSlash(command.slash);
          break;
        case "selectModel":
          void selectModel(command.modelId);
          break;
      }
    },
    [compactSession, createSession, forkSession, openPanel, openSkillsLibrary, resetComposer, runSlash, selectModel],
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
      latestComposerInputRef.current = value;
      if (composerInputFrameRef.current !== null) {
        return;
      }

      composerInputFrameRef.current = window.requestAnimationFrame(() => {
        composerInputFrameRef.current = null;
        const nextValue = latestComposerInputRef.current;

        startTransition(() => {
          setComposer(nextValue);
        });

        const quickMatch = nextValue.match(/(?:^|\s)([@$/])([^\s]*)$/);
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
      });
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

  const submitComposer = useCallback(async (rawValue?: string) => {
    const composerValue = rawValue ?? textareaRef.current?.value ?? composer;
    const prompt = composerValue.trim();
    const promptMentions = selectedMentions.filter((mention) => composerHasMentionToken(composerValue, mention));
    const composerDraft = {
      composerValue,
      mentions: [...selectedMentions],
      skills: [...selectedSkills],
      files: [...selectedFiles],
      images: [...selectedImages],
    };
    if (
      !prompt &&
      promptMentions.length === 0 &&
      selectedSkills.length === 0 &&
      selectedFiles.length === 0 &&
      selectedImages.length === 0
    ) {
      return;
    }

    try {
      let threadId = activeThreadId;
      const threadExists = threadId
        ? snapshot.threads.some((entry) => entry.thread.id === threadId)
        : false;
      if (!threadId || !threadExists) {
        threadId = await actions.createThread(effectiveComposerSettings, {
          title: "New Session",
          cwd: projectPickerPath,
        });
        setTabIds((current) =>
          [threadId!, ...current.filter((entry) => entry !== threadId)].slice(
            0,
            6,
          ),
        );
        navigateToThread(threadId, "chat");
      }

      if (prompt.startsWith("/")) {
        await runSlash(prompt, true);
        return;
      }

      const mode =
        composerMode === "review" || route.section === "review"
          ? "review"
          : "chat";
      const nextPrompt = prompt;
      const canClearImmediately = selectedImages.length === 0;

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

      if (canClearImmediately) {
        resetComposer();
        await waitForNextPaint();
      }

      threadId = await sendComposerAndSyncThread({
        threadId,
        mode,
        prompt: nextPrompt,
        mentions: promptMentions,
        skills: selectedSkills,
        files: selectedFiles,
        images: selectedImages,
        settings: effectiveComposerSettings,
      });

      if (!canClearImmediately) {
        resetComposer();
      }
    } catch (error) {
      if (composerDraft.images.length === 0 && !getComposerInputValue().trim()) {
        setComposer(composerDraft.composerValue);
        setComposerSyncKey((current) => current + 1);
        setSelectedMentions(composerDraft.mentions);
        setSelectedSkills(composerDraft.skills);
        setSelectedFiles(composerDraft.files);
        setQuickMode(null);
        setQuickQuery("");
        setQuickIndex(0);
      }

      const message = errorMessage(
        error,
        snapshot.transport.error ?? "Failed to send message",
      );
      pushToast(message, "err");
    }
  }, [
    actions,
    activeThreadId,
    activeTurn,
    composer,
    composerMode,
    enqueueMessage,
    getComposerInputValue,
    navigateToThread,
    pushToast,
    resetComposer,
    route.section,
    runSlash,
    sendComposerAndSyncThread,
    snapshot.transport.error,
    snapshot.threads,
    selectedMentions,
    selectedImages,
    selectedFiles,
    selectedSkills,
    effectiveComposerSettings,
    projectPickerPath,
  ]);

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
    [closeQuickPicker, filteredQuickEntries, onQuickPick, pushToast, quickIndex, quickMode, submitComposer],
  );

  const attachImages = useCallback(
    (files: Array<File>, source: "attach" | "paste") => {
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) {
        return 0;
      }

      const timestamp = Date.now();
      setSelectedImages((current) => [
        ...current,
        ...imageFiles.map((file, index) => {
          const mimeExtension = file.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
          return {
            id: nextId("image"),
            name: file.name || `pasted-image-${timestamp}-${index + 1}.${mimeExtension}`,
            url: URL.createObjectURL(file),
            size: formatUploadSize(file.size),
            file,
          };
        }),
      ]);

      pushToast(
        imageFiles.length === 1
          ? source === "paste"
            ? "Image pasted"
            : "Image attached"
          : source === "paste"
            ? `${imageFiles.length} images pasted`
            : `${imageFiles.length} images attached`,
        "ok",
      );

      return imageFiles.length;
    },
    [pushToast],
  );

  const onComposerPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardFiles = Array.from(event.clipboardData.files ?? []);
      const itemFiles =
        clipboardFiles.length > 0
          ? clipboardFiles
          : Array.from(event.clipboardData.items ?? [])
              .filter((item) => item.kind === "file")
              .map((item) => item.getAsFile())
              .filter((file): file is File => Boolean(file));

      if (attachImages(itemFiles, "paste") === 0) {
        return;
      }

      event.preventDefault();
    },
    [attachImages],
  );

  const onImagesChosen = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    attachImages(files, "attach");
    event.target.value = "";
  }, [attachImages]);

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
        await sendComposerAndSyncThread({
          threadId: activeThreadId,
          mode: queuedMessage.mode,
          prompt: queuedMessage.prompt,
          mentions: queuedMessage.mentions,
          skills: queuedMessage.skills,
          files: queuedMessage.files,
          images: queuedMessage.images,
          settings: effectiveComposerSettings,
        });
      } catch (error) {
        prependQueuedMessage(getMaterializedThreadId(error) ?? activeThreadId, queuedMessage);
      }
    },
    [actions, activeThreadId, activeTurn, effectiveComposerSettings, prependQueuedMessage, pushToast, queuedByThreadId, removeQueuedMessage, sendComposerAndSyncThread],
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

  const composerPlaceholder = quickMode
    ? QUICK_HINTS[quickMode]
    : activeTurn
      ? "Queue a follow-up while the agent is still running…"
      : QUICK_HINTS.slash;
  const conversationTokenEstimate = useMemo(
    () => estimateConversationTokens(activeTurns, snapshot.settings.provider),
    [activeTurns, snapshot.settings.provider],
  );
  const contextUsageLabel = `${compactNumber(conversationTokenEstimate)} / 200k`;
  const footerUsageWindows = useMemo(
    () =>
      [...snapshot.account.usageWindows]
        .sort(
          (left, right) =>
            (left.windowDurationMins ?? Number.MAX_SAFE_INTEGER) -
            (right.windowDurationMins ?? Number.MAX_SAFE_INTEGER),
        )
        .slice(0, 2),
    [snapshot.account.usageWindows],
  );
  const connectionLabel =
    snapshot.transport.status === "connected" ? "Connected" : snapshot.transport.status;
  const projectStatusLabel = pathBaseName(activeThread?.thread.cwd);
  const branchStatusLabel = activeThread?.thread.gitInfo?.branch ?? "workspace";
  const accessStatusLabel = APPROVAL_LABELS[activeUiApproval].toLowerCase();
  const activityStatusLabel = activeTurn ? "Streaming" : "Idle";
  const shellTerminals = useMemo(
    () =>
      activeThread?.terminals.filter((terminal) => terminal.source === "shell") ?? [],
    [activeThread?.terminals],
  );
  const hasStandaloneTerminal = shellTerminals.length > 0;
  const startBottomShell = useCallback(() => {
    if (!activeThreadId || !activeThread?.thread.cwd || hasStandaloneTerminal) {
      return;
    }

    void actions
      .startProjectTerminal(activeThreadId, activeThread.thread.cwd)
      .catch((error) => {
        pushToast(
          error instanceof Error
            ? error.message
            : "Unable to start the project shell.",
          "err",
        );
      });
  }, [
    actions,
    activeThread?.thread.cwd,
    activeThreadId,
    hasStandaloneTerminal,
    pushToast,
  ]);

  useEffect(() => {
    if (!toolbarShell || !terminalDockPrimed || terminalDockReady) {
      return;
    }

    if (typeof window === "undefined") {
      setTerminalDockReady(true);
      return;
    }

    terminalDockPaintFrameRef.current = window.requestAnimationFrame(() => {
      terminalDockPaintFrameRef.current = null;
      setTerminalDockReady(true);
    });

    return () => {
      if (terminalDockPaintFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalDockPaintFrameRef.current);
        terminalDockPaintFrameRef.current = null;
      }
    };
  }, [terminalDockPrimed, terminalDockReady, toolbarShell]);

  useEffect(() => {
    if (!toolbarShell || !terminalDockReady || !activeThreadId || !activeThread?.thread.cwd || hasStandaloneTerminal) {
      return;
    }

    if (typeof window === "undefined") {
      startBottomShell();
      return;
    }

    terminalDockLaunchFrameRef.current = window.requestAnimationFrame(() => {
      terminalDockLaunchFrameRef.current = null;
      startBottomShell();
    });

    return () => {
      if (terminalDockLaunchFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalDockLaunchFrameRef.current);
        terminalDockLaunchFrameRef.current = null;
      }
    };
  }, [
    activeThread?.thread.cwd,
    activeThreadId,
    hasStandaloneTerminal,
    startBottomShell,
    terminalDockReady,
    toolbarShell,
  ]);

  const openBottomTerminal = useCallback(() => {
    if (toolbarShell) {
      return;
    }

    setTerminalDockPrimed(true);
    setToolbarShell(true);
  }, [toolbarShell]);
  const closeBottomTerminal = useCallback(() => {
    if (typeof window !== "undefined") {
      if (terminalDockPaintFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalDockPaintFrameRef.current);
        terminalDockPaintFrameRef.current = null;
      }

      if (terminalDockLaunchFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalDockLaunchFrameRef.current);
        terminalDockLaunchFrameRef.current = null;
      }
    }

    setToolbarShell(false);
  }, []);
  const handleCopy = useCallback(
    (value: string) => {
      void copyText(value).then(() => pushToast("Copied!", "ok"));
    },
    [pushToast],
  );
  const handleTranscriptOpenFile = useCallback(
    (path: string, line?: number | null) => {
      openThreadFile(path, {
        line,
        source: "chat",
      });
    },
    [openThreadFile],
  );
  const handleTranscriptReview = useCallback(
    (diffId?: string) => {
      reviewDiff(diffId);
    },
    [reviewDiff],
  );
  const handleLiveFileChangeOpen = useCallback(
    (path: string) => {
      openThreadFile(path, {
        source: "chat",
      });
    },
    [openThreadFile],
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
  const closeEditor = useCallback(() => {
    if (!activeThreadId) {
      return;
    }

    if (editorSource === "ops") {
      setPanelTab("files");
      setPanelOpen(true);
      navigateToThread(activeThreadId, "ops");
      return;
    }

    navigateToThread(activeThreadId, editorSource);
  }, [activeThreadId, editorSource, navigateToThread]);
  const closeReview = useCallback(() => {
    if (!activeThreadId) {
      return;
    }

    if (reviewSource === "ops") {
      setPanelTab("files");
      setPanelOpen(true);
      navigateToThread(activeThreadId, "ops");
      return;
    }

    navigateToThread(activeThreadId, reviewSource);
  }, [activeThreadId, navigateToThread, reviewSource]);
  const editorPreviewState = useMemo<FilePreviewState | null>(() => {
    if (route.section !== "editor" || !editorPath) {
      return null;
    }

    if (filePreview?.path === editorPath) {
      return {
        ...filePreview,
        line: editorLine,
      };
    }

    return {
      path: editorPath,
      name:
        editorPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ??
        editorPath,
      content: "",
      loading: true,
      error: null,
      line: editorLine,
    };
  }, [editorLine, editorPath, filePreview, route.section]);
  const saveEditorFile = useCallback(
    async (path: string, content: string) => {
      await actions.saveFile(path, content);
      setFilePreview((current) =>
        current?.path === path
          ? {
              ...current,
              content,
              loading: false,
              error: null,
            }
          : current,
      );
      pushToast(`Saved ${path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path}`, "ok");
    },
    [actions, pushToast],
  );
  const editorBackLabel = editorSource === "ops" ? "Back to Files" : "Back to Chat";
  const openExplorerEntry = useCallback(
    async (entry: MentionAttachment) => {
      if (entry.kind === "directory") {
        setExplorerPath(entry.path);
        setFilePreview(null);
        return;
      }

      openThreadFile(entry.path, {
        source: "ops",
      });
    },
    [openThreadFile],
  );
  const renderPanelBody = () => {
    if (!activeThread) {
      return <div className="empty-panel">No active thread.</div>;
    }

    if (panelTab === "graph") {
      return gitActivityGraph ? (
        <div className="graph-panel-stack">
          <CommitComposerCard
            branchLabel={gitCommitBranchLabel}
            committing={commitCommitting}
            dirty={commitDraftHasChanges}
            generating={commitGenerating}
            hasStagedChanges={gitHasStagedChanges}
            message={commitMessage}
            onCommit={() => void commitWorkingTreeDraft()}
            onGenerate={() => void generateCommitDraft()}
            onMessageChange={setCommitMessage}
            onProviderChange={(providerId) => {
              void updateCommitProvider(providerId);
            }}
            preferencesPath={commitPreferencesPath}
            providers={snapshot.providers}
            selectedProviderId={commitProviderId}
            summary={gitWorkingTree?.summary ?? "Working tree clean"}
          />
          {gitActivityGraph.source === "session" ? (
            <div className="panel-hint">
              {gitActivityGraphError
                ? "Showing session-derived history because local git output is unavailable."
                : "Showing session-derived history."}
            </div>
          ) : gitActivityGraphLoading ? (
            <div className="panel-hint">Refreshing git history…</div>
          ) : null}
          <GitActivityGraph model={gitActivityGraph} onOpenThread={openThreadFromSidebar} />
        </div>
      ) : (
        <div className="empty-panel">
          {gitActivityGraphLoading ? "Loading git history…" : "No repository graph available for this session yet."}
        </div>
      );
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
        <FileExplorerPanel
          breadcrumbs={breadcrumbs}
          currentPath={currentPath}
          directoryEntries={directoryEntries}
          editorPath={route.section === "editor" ? editorPath : null}
          loading={snapshot.directoryCatalogRoot !== currentPath}
          mentionedPaths={mentionedPaths}
          modifiedByPath={changedPaths}
          onNavigate={(path) => {
            setExplorerPath(path);
            setFilePreview((current) => (current && isPathWithinRoot(path, current.path) ? current : null));
          }}
          onOpenEntry={openExplorerEntry}
          parentPath={parentPath}
          rootPath={rootPath}
        />
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
          {activePendingApprovals.length > 0 ? (
            <div className="panel-actions">
              {activePendingApprovals.map((approval) => renderApprovalRequest(approval))}
            </div>
          ) : null}
        </div>
      );
    }

    if (panelTab === "terminal") {
      return <div className="empty-panel">Terminal moved to the bottom dock. Use the Shell toggle above the prompt.</div>;
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
          activeTheme={uiTheme}
          onOpenSkills={openSkillsLibrary}
          onOpenTheme={openThemePicker}
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

  const startupLoaderShowingConversation =
    showStartupConnectionLoader && routeConversationLoaderPending;
  const fullPageConversationLoader =
    !showStartupConnectionLoader &&
    routeConversationLoaderPending;

  if (showStartupConnectionLoader) {
    return (
      <main className="workspace-shell connection-loading-shell">
        <ConnectionLoadingState
          messages={STARTUP_MESSAGE_SEQUENCE}
          metaText={
            startupLoaderShowingConversation
              ? `Restoring ${shorten(activeThreadLabel, 42)}`
              : "Connecting to workspace backend"
          }
          visibleRangeEnd={
            startupLoaderShowingConversation
              ? STARTUP_MESSAGE_SEQUENCE.length - 1
              : STARTUP_CONNECTION_MESSAGES.length - 1
          }
          visibleRangeStart={
            startupLoaderShowingConversation
              ? STARTUP_CONNECTION_MESSAGES.length
              : 0
          }
        />
      </main>
    );
  }

  if (fullPageConversationLoader) {
    return (
      <main className="workspace-shell connection-loading-shell">
        <ConnectionLoadingState
          messages={[
            "Opening conversation",
            "Reattaching thread",
            "Loading recent history",
            "Syncing transcript",
          ]}
          metaText={`Restoring ${shorten(activeThreadLabel, 42)}`}
        />
      </main>
    );
  }

  return (
    <main className={clsx("workspace-shell", fullScreenOverlayOpen && "overlay-open")}>
      <header id="hdr">
        <button className="hb mbtn" type="button" onClick={toggleSidebar} title="Menu">
          ☰
        </button>
        <div className="logo">
          <BrandMark alt="" className="logo-ico" />
          <span>Nomadex</span>
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
        <button className="hb" type="button" onClick={openSkillsLibrary} title="Skills library">
          📋
        </button>
        <button className="hb" type="button" onClick={() => openPanel("config")} title="Config and settings">
          ⚙
        </button>
        <button
          className="htheme"
          id="htheme"
          type="button"
          onClick={() => {
            setModelPickerOpen(false);
            setThemePickerOpen((current) => !current);
          }}
          title="Theme picker"
        >
          <span className="theme-dot" />
          <span className="theme-label">{activeThemeOption.name}</span>
          <span className="hmodel-arrow">▾</span>
        </button>
        <button
          className="hmodel"
          id="hmodel"
          type="button"
          disabled={modelOptions.length === 0}
          ref={modelButtonRef}
          onClick={() => {
            if (modelOptions.length === 0) {
              return;
            }
            setThemePickerOpen(false);
            setModelPickerOpen((current) => !current);
          }}
          title={
            modelOptions.length === 0
              ? `${activeProvider.displayName} uses its own CLI model configuration`
              : undefined
          }
        >
          <div className="mdot" />
          <span id="mlabel">{providerModelLabel}</span>
          <span className="hmodel-arrow">▾</span>
        </button>
      </header>

      <div id="layout">
        {!desktopViewport && sidebarOpen ? (
          <button
            id="sbo"
            className="show"
            type="button"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        {sidebarVisible ? (
          <aside id="sb" className={clsx(!desktopViewport && sidebarOpen && "open")}>
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
                      onClick={() => openThreadFromSidebar(entry.thread.id)}
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
            <button className="slink" type="button" onClick={openSkillsLibrary}>
              <span>📋</span>
              <span>Skills library</span>
            </button>
            <button className="slink" type="button" onClick={openThemePicker}>
              <span>◐</span>
              <span>Theme picker</span>
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
        ) : null}

        {mainVisible ? (
        <section id="main" className={clsx(mainCovered && "covered")}>
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

          {route.section === "editor" ? (
            <div id="editor-page">
              {editorPreviewState ? (
                <FileEditorPreview
                  backLabel={editorBackLabel}
                  onBack={closeEditor}
                  onDirtyChange={setEditorHasUnsavedChanges}
                  onSave={saveEditorFile}
                  preview={editorPreviewState}
                  providerId={snapshot.settings.provider}
                  variant="page"
                />
              ) : (
                <div className="empty-panel">No file selected.</div>
              )}
            </div>
          ) : route.section === "review" ? (
            <DiffReviewPage
              backLabel={reviewSource === "ops" ? "Back to Files" : "Back to Chat"}
              diffEntries={diffEntries}
              findings={selectedDiffFindings}
              onBack={closeReview}
              onSelectEntry={(entryId) => reviewDiff(entryId, reviewSource)}
              selectedEntryId={selectedDiffEntryId}
            />
          ) : (
            <>
              <div id="chat" ref={chatRef}>
                <ChatTranscript
                  activeThread={activeThread}
                  activeThreadLabel={activeThreadLabel}
                  activeTurns={renderedTurns}
                  existingThreadHistoryPending={existingThreadHistoryPending}
                  rollbackPendingTurnId={rollbackPendingTurnId}
                  onContext={openItemContextMenu}
                  onCopy={handleCopy}
                  onEdit={fillComposer}
                  onFill={fillComposer}
                  onFork={forkSession}
                  onOpenFile={handleTranscriptOpenFile}
                  onPlan={triggerPlan}
                  onRollback={rollbackTurn}
                  onReview={handleTranscriptReview}
                  onSlash={triggerSlash}
                  providerId={snapshot.settings.provider}
                  streamVisible={streamVisible}
                />
                <LiveStatusInline
                  overlay={liveOverlay}
                  pendingApprovalsCount={pendingApprovalsCount}
                  queuedCount={activeQueuedMessages.length}
                />
                <div aria-hidden="true" ref={chatEndRef} />
              </div>

              <div id="ia">
                {showScrollToBottomButton ? (
                  <div className="chat-jump-row">
                    <button
                      className="chat-jump-button"
                      type="button"
                      onClick={jumpToLatestMessages}
                    >
                      ↓ Latest
                    </button>
                  </div>
                ) : null}
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
                    {selectedFiles.map((file) => {
                      const preview = getFileAttachmentPreview(file.name);

                      return (
                        <div
                          className={clsx(
                            "ctag ctag-file",
                            `file-tone-${preview.tone}`,
                          )}
                          key={file.id}
                        >
                          <span aria-hidden="true" className="file-chip-preview">
                            <span className="file-chip-ext">{preview.badge}</span>
                          </span>
                          <span className="file-chip-copy">
                            <span className="file-chip-title">{preview.title}</span>
                            <span className="file-chip-meta">{file.size}</span>
                          </span>
                          <button className="ctx-x" type="button" onClick={() => removeUploadedFile(file.id)}>
                            ×
                          </button>
                        </div>
                      );
                    })}
                    {selectedImages.map((image) => (
                      <div className="ctag ctag-image" key={image.id}>
                        <img
                          alt={image.name}
                          className="ctag-thumb"
                          loading="lazy"
                          src={image.url}
                        />
                        <span className="ctag-label">{image.name}</span>
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

                {activeTurnFileChanges.length > 0 ? (
                  <FileChangeSummary
                    entries={activeTurnFileChanges}
                    onOpenFile={handleLiveFileChangeOpen}
                    title="Changing"
                    variant="live"
                  />
                ) : null}

                {activePendingApprovals.length > 0 ? (
                  <div className="question-request-stack">
                    {activePendingApprovals.map((approval) => renderApprovalRequest(approval))}
                  </div>
                ) : null}

                {(terminalDockPrimed || toolbarShell) && activeThread ? (
                  <div className={clsx("workspace-terminal-dock", !toolbarShell && "hidden")}>
                    <div className="workspace-terminal-dock-bar">
                      <button
                        className="workspace-terminal-dock-tab active"
                        type="button"
                      >
                        Terminal
                      </button>
                      <button
                        className="workspace-terminal-dock-close"
                        onClick={closeBottomTerminal}
                        type="button"
                      >
                        Hide
                      </button>
                    </div>
                    <div className="workspace-terminal-dock-body">
                      {terminalDockReady ? (
                        <TerminalPanel
                          cwd={activeThread.thread.cwd}
                          onSendInput={(terminalId, input) => actions.sendTerminalInput(activeThread.thread.id, terminalId, input)}
                          onStartShell={() => actions.startProjectTerminal(activeThread.thread.id, activeThread.thread.cwd)}
                          onTerminate={(terminalId) => actions.terminateTerminal(activeThread.thread.id, terminalId)}
                          terminals={shellTerminals}
                        />
                      ) : (
                        <div className="workspace-terminal-dock-loading">Opening terminal</div>
                      )}
                    </div>
                  </div>
                ) : null}

                <div id="ib" className={clsx(activeQueuedMessages.length > 0 && "queue-open")}>
                  <div id="toolbar">
                <button className={clsx("tbtn", toolbarAuto && "on")} type="button" onClick={() => setToolbarAuto((current) => !current)}>
                  <ChromeIcon name="auto" />
                  <span className="tbtn-label">Auto</span>
                </button>
                <button
                  className={clsx("tbtn", toolbarPlan && "on")}
                  type="button"
                  onClick={async () => {
                    const next = !toolbarPlan;
                    setToolbarPlan(next);
                  }}
                >
                  <ChromeIcon name="plan" />
                  <span className="tbtn-label">Plan</span>
                </button>
                <div className="tsep2" />
                <button className="tbtn" type="button" onClick={() => {
                  setQuickMode("mention");
                  setQuickQuery("");
                  setQuickIndex(0);
                  textareaRef.current?.focus();
                }}>
                  <ChromeIcon name="mention" />
                  <span className="tbtn-label">Mention</span>
                </button>
                <button className="tbtn" type="button" onClick={() => uploadFileInputRef.current?.click()}>
                  <ChromeIcon name="attach" />
                  <span className="tbtn-label">Files</span>
                </button>
                <button className="tbtn" type="button" onClick={() => imageInputRef.current?.click()}>
                  <ChromeIcon name="image" />
                  <span className="tbtn-label">Image</span>
                </button>
                <button
                  className={clsx("tbtn", toolbarShell && "on")}
                  type="button"
                  onClick={() => void (toolbarShell ? closeBottomTerminal() : openBottomTerminal())}
                >
                  <ChromeIcon name="terminal" />
                  <span className="tbtn-label">Shell</span>
                </button>
                <button
                  className={clsx("tbtn", snapshot.settings.webSearch && "on")}
                  type="button"
                  onClick={() => void actions.updateSettings({ webSearch: !snapshot.settings.webSearch })}
                >
                  <ChromeIcon name="web" />
                  <span className="tbtn-label">Web</span>
                </button>
                <div className="tsep2" />
                <button
                  className={clsx("tbtn", composerMode === "review" && "on")}
                  type="button"
                  onClick={() => setComposerMode((current) => (current === "review" ? "chat" : "review"))}
                >
                  <ChromeIcon name="review" />
                  <span className="tbtn-label">Review</span>
                </button>
                <button className="tbtn" type="button" onClick={() => openPanel("agents")}>
                  <ChromeIcon name="agents" />
                  <span className="tbtn-label">Agents</span>
                </button>
                <button className="tbtn" type="button" onClick={() => void compactSession()}>
                  <ChromeIcon name="compact" />
                  <span className="tbtn-label">Trim</span>
                </button>
                <button className="tbtn" type="button" onClick={() => pushToast("Ctrl+G — opening editor bridge", "")}>
                  <ChromeIcon name="editor" />
                  <span className="tbtn-label">Editor</span>
                </button>
                </div>

                <div id="irow">
                  <ComposerTextarea
                    key={composerSyncKey}
                    composerMirrorRef={composerMirrorRef}
                    mentions={selectedMentions}
                    onKeyDown={onComposerKeyDown}
                    onPaste={onComposerPaste}
                    onValueChange={onComposerChange}
                    placeholder={composerPlaceholder}
                    textareaRef={textareaRef}
                    value={composer}
                  />
                <button
                  id="sendbtn"
                  type="button"
                  aria-label={activeTurn ? "Queue message" : "Send message"}
                  onClick={() => void submitComposer(textareaRef.current?.value)}
                >
                  <ChromeIcon name="send" />
                </button>
                <button
                  id="stopbtn"
                  style={{ display: activeTurn ? "flex" : "none" }}
                  type="button"
                  aria-label="Stop current turn"
                  onClick={() => void onStopTurn()}
                >
                  <ChromeIcon name="stop" />
                </button>
              </div>

              {renderQuickPicker()}

              <div id="ifooter">
                <div className="composer-footer-meta">
                  <div className="composer-shortcuts">
                    <span className="composer-hint">Shift+Enter</span>
                  </div>
                  <div className="composer-usage-metric">
                    <span className="composer-usage-label">Context</span>
                    <span id="tokcount">{contextUsageLabel}</span>
                  </div>
                  <div className="composer-limit-list">
                    {footerUsageWindows.map((windowEntry) => (
                      <div className="composer-limit-chip" key={windowEntry.id}>
                        <span className="composer-limit-name">
                          {formatUsageWindowShortLabel(
                            windowEntry.label,
                            windowEntry.windowDurationMins,
                          )}
                        </span>
                        <span className="composer-limit-value">
                          {Math.round(windowEntry.usedPercent)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
              </div>
            </>
          )}
        </section>
        ) : null}

        {desktopViewport || panelVisible ? (
        <aside id="rp" className={clsx(panelVisible && "open")}>
          <div className="rph">
            <span className="rpt" id="rp-title">
              {PANEL_TITLE[panelTab]}
            </span>
            <button className="rpclose" type="button" onClick={closePanel}>
              ×
            </button>
          </div>
          <div className="rptabs" id="rptabs">
            {(["files", "graph", "diff", "agents", "config"] as const).map((tab) => (
              <button
                className={clsx("rptab", panelTab === tab && "active")}
                key={tab}
                type="button"
                onClick={() => {
                  if (tab === "diff") {
                    reviewDiff(
                      selectedDiffEntry?.id ?? diffEntries[0]?.id,
                      route.section === "ops" ? "ops" : "chat",
                    );
                    return;
                  }

                  setPanelTab(tab);
                }}
              >
                {PANEL_TITLE[tab]}
              </button>
            ))}
          </div>
          <div className="rpbody" id="rpbody">
            {panelVisible ? renderPanelBody() : null}
          </div>
        </aside>
        ) : null}
      </div>

      <div id="statusbar">
        <div className="sbi sbi-transport">
          <div className={clsx("sbd", statusTone(snapshot.transport.status))} />
          <span>{connectionLabel}</span>
        </div>
        <div className="sbi sbi-branch">
          <ChromeIcon name="branch" />
          <span className="sb-project sb-fulltext">{projectStatusLabel}</span>
          <span className="sb-divider">/</span>
          <span className="sb-fulltext">{branchStatusLabel}</span>
        </div>
        <div className="sbi sbi-model" id="sb-model">
          <ChromeIcon name="model" />
          <span>{providerModelLabel}</span>
        </div>
        <div className="sbi sbi-access">
          <ChromeIcon name="shield" />
          <span>{accessStatusLabel}</span>
        </div>
        <div className="sbi" id="sb-st">
          {activityStatusLabel}
        </div>
      </div>

      {modelPickerOpen && modelOptions.length > 0 ? (
        <div
          id="mpicker"
          style={{
            display: "block",
            top: `${modelPickerPosition.top}px`,
            right: `${modelPickerPosition.right}px`,
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

      {themePickerOpen ? (
        <ThemePickerPanel
          activeTheme={uiTheme}
          onClose={closeThemePicker}
          onSelect={selectTheme}
          themes={UI_THEME_OPTIONS}
        />
      ) : null}

      {projectPickerOpen ? (
        <ProjectFolderPickerModal
          activePath={projectPickerPath}
          breadcrumbs={projectPickerBreadcrumbs}
          busy={projectPickerStarting}
          entries={projectPickerEntries}
          loading={snapshot.directoryCatalogRoot !== projectPickerPath}
          onClose={() => setProjectPickerOpen(false)}
          onNavigate={setProjectPickerPath}
          onPick={(path) => {
            setProjectPickerPath(path);
            void confirmProjectPicker(path);
          }}
          parentPath={projectPickerParentPath}
        />
      ) : null}

      {skillsModalOpen ? (
        <SkillsLibraryModal
          actions={actions}
          onClose={closeSkillsLibrary}
          pushToast={pushToast}
          snapshot={snapshot}
        />
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
                      runCommandPaletteItem(first.command);
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
                          runCommandPaletteItem(item.command);
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
                void copyText(
                  getUserText(item, snapshot.settings.provider),
                ).then(() => pushToast("Copied", "ok"));
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
                fillComposer(getUserText(item, snapshot.settings.provider));
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
