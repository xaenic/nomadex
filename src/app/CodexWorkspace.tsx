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
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PropsWithChildren,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import clsx from "clsx";

import type { ThreadItem, Turn } from "../protocol/v2";
import { CodexLiveRuntime } from "./codexLive";
import { deriveLiveOverlay, toBrowseUrl } from "./codexUiBridge";
import { LiveStatusInline } from "./LiveStatusInline";
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
  type ThreadRecord,
  type WorkspaceMode,
} from "./mockData";
import {
  APPROVAL_CLASS,
  APPROVAL_LABELS,
  APPROVAL_ORDER,
  PANEL_TITLE,
  QUICK_HINTS,
  SLASH_COMMANDS,
  approvalModeFromSettings,
  countDiffStats,
  deriveLocalDirectoryCatalog,
  diffEntryId,
  diffKindLabel,
  formatUploadSize,
  getStreamTarget,
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
  mentionInlineToken,
  threadDayGroup,
  threadLabel,
} from "./workspaceHelpers";
import type {
  DiffReviewEntry,
  FilePreviewState,
  PanelTab,
  QuickEntry,
  QuickMode,
  QueuedComposerMessage,
  RouteSection,
  ToastItem,
  ToastTone,
  UiApprovalMode,
  WorkspaceActions,
  WorkspaceContextValue,
} from "./workspaceTypes";
import {
  ChatTranscript,
  ComposerTextarea,
  ConfigPanel,
  DiffReviewPage,
  DiffPatchViewer,
  FileEditorPreview,
  ProjectFolderPickerModal,
  QueuedMessagesStrip,
} from "./WorkspaceView";

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

type CommandPaletteAction =
  | { type: "createSession" }
  | { type: "forkSession" }
  | { type: "compactSession" }
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
const SESSION_PROJECT_ROOT = "/home/allan";

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
        throw new Error("Codex runtime is still starting. Try again.");
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
      const threadCwd = snapshotRef.current.threads.find((entry) => entry.thread.id === threadId)?.thread.cwd ?? "/home/allan/codex-console";
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
            await runtime.sendComposer(args);
          },
          async () => {
            await sendComposerLocal(args);
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
            const response = await fetch("/codex-auth/complete", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ callbackUrl }),
            });

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
  const location = useRouterState({
    select: (state) => state.location,
  });
  const route = parseRoute(location.pathname);
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
  const [panelOpen, setPanelOpen] = useState(isDesktopViewport());
  const [panelTab, setPanelTab] = useState<PanelTab>(routePanel ?? "files");
  const [commandOpen, setCommandOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectPickerStarting, setProjectPickerStarting] = useState(false);
  const [projectPickerPath, setProjectPickerPath] =
    useState(SESSION_PROJECT_ROOT);
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
  const [modelPickerPosition, setModelPickerPosition] = useState({ top: 52, right: 12 });
  const [composerSyncKey, setComposerSyncKey] = useState(0);

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
  const streamVisibleRef = useRef<Record<string, number>>({});
  const [streamVisible, setStreamVisible] = useState<Record<string, number>>({});
  const [streamTextFx, setStreamTextFx] = useState<
    Record<string, { from: number; to: number }>
  >({});
  const deferredQuickQuery = useDeferredValue(quickQuery);

  const updateModelPickerPosition = useCallback(() => {
    const rect = modelButtonRef.current?.getBoundingClientRect();
    setModelPickerPosition({
      top: (rect?.bottom ?? 48) + 4,
      right: Math.max(12, window.innerWidth - (rect?.right ?? window.innerWidth - 12)),
    });
  }, []);

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
  const activeTurn = [...activeTurns].reverse().find((turn) => turn.status === "inProgress") ?? null;
  const activeQueuedMessages = activeThreadId ? queuedByThreadId[activeThreadId] ?? [] : [];
  const liveOverlay = useMemo(() => deriveLiveOverlay(activeTurn), [activeTurn]);
  const pendingApprovalsCount = useMemo(
    () => activeThread?.approvals.filter((approval) => approval.state === "pending").length ?? 0,
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
  const projectPickerEntries = useMemo(
    () =>
      snapshot.directoryCatalogRoot === projectPickerPath
        ? snapshot.directoryCatalog.filter(
            (entry) => entry.kind === "directory",
          )
        : [],
    [projectPickerPath, snapshot.directoryCatalog, snapshot.directoryCatalogRoot],
  );
  const projectPickerParentPath = useMemo(() => {
    if (projectPickerPath === SESSION_PROJECT_ROOT) {
      return null;
    }

    const lastSlashIndex = projectPickerPath.lastIndexOf("/");
    if (lastSlashIndex <= 0) {
      return SESSION_PROJECT_ROOT;
    }

    return projectPickerPath.slice(0, lastSlashIndex) || SESSION_PROJECT_ROOT;
  }, [projectPickerPath]);
  const projectPickerBreadcrumbs = useMemo(() => {
    const normalizedRoot = SESSION_PROJECT_ROOT.replace(/\/+$/u, "");
    const normalizedPath = projectPickerPath.replace(/\/+$/u, "");
    const relative =
      normalizedPath === normalizedRoot
        ? ""
        : normalizedPath.slice(normalizedRoot.length).replace(/^\/+/u, "");

    return [
      {
        label:
          normalizedRoot.split("/").filter(Boolean).pop() ?? normalizedRoot,
        path: normalizedRoot,
      },
      ...relative.split("/").filter(Boolean).reduce<
        Array<{
          label: string;
          path: string;
        }>
      >((parts, segment) => {
        const previous = parts.at(-1)?.path ?? normalizedRoot;
        parts.push({
          label: segment,
          path: `${previous.replace(/\/+$/u, "")}/${segment}`,
        });
        return parts;
      }, []),
    ];
  }, [projectPickerPath]);

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
          const remaining = { ...current };
          delete remaining[threadId];
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
    if (route.section === "editor" || route.section === "review") {
      const frame = window.requestAnimationFrame(() => {
        setPanelOpen(false);
      });

      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    const frame = window.requestAnimationFrame(() => {
      if (!routePanel) {
        if (!isDesktopViewport()) {
          setPanelOpen(false);
        }
        return;
      }

      setPanelTab(routePanel);
      setPanelOpen(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [route.section, routePanel]);

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
    const liveMode = snapshot.transport.mode === "live";
    const streamEntries = snapshot.streams;

    if (liveMode) {
      const frame = window.requestAnimationFrame(() => {
        const previousVisible = streamVisibleRef.current;
        const nextVisible: Record<string, number> = {};
        const nextTextFx: Record<string, { from: number; to: number }> = {};

        for (const entry of streamEntries) {
          const target = getStreamTarget(entry);
          const previous = previousVisible[entry.key] ?? 0;

          nextVisible[entry.key] = target;
          if (entry.field === "text" && target > previous) {
            nextTextFx[entry.key] = {
              from: previous,
              to: target,
            };
          }
        }

        streamVisibleRef.current = nextVisible;
        startTransition(() => {
          setStreamVisible(nextVisible);
          setStreamTextFx(nextTextFx);
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
      startTransition(() => {
        setStreamTextFx({});
      });
    };

    const frame = window.requestAnimationFrame(syncVisible);

    const timer = window.setInterval(() => {
      const currentVisible = streamVisibleRef.current;
      const nextVisible: Record<string, number> = {};
      const nextTextFx: Record<string, { from: number; to: number }> = {};
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
          if (entry.field === "text") {
            nextTextFx[entry.key] = {
              from: value,
              to: nextValue,
            };
          }
        }
      }

      if (!changed) {
        return;
      }

      streamVisibleRef.current = nextVisible;
      startTransition(() => {
        setStreamVisible(nextVisible);
        setStreamTextFx(nextTextFx);
      });
    }, 24);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [snapshot.streams, snapshot.transport.mode]);

  const scrollChatToBottom = useCallback((extraDelay = false) => {
    const run = () => {
      if (chatEndRef.current) {
        chatEndRef.current.scrollIntoView({ block: "end" });
      } else if (chatRef.current) {
        chatRef.current.scrollTop = chatRef.current.scrollHeight;
      }
    };

    const frame = window.requestAnimationFrame(run);
    const timeout = extraDelay ? window.setTimeout(run, 90) : null;

    return () => {
      window.cancelAnimationFrame(frame);
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };
  }, []);

  useEffect(() => {
    if (!chatRef.current) {
      return;
    }

    return scrollChatToBottom();
  }, [activeTurns, scrollChatToBottom, streamVisible]);

  useEffect(() => {
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
  }, [activeThreadId, activeTurns, existingThreadHistoryPending, scrollChatToBottom]);

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

      setFilePreview((current) =>
        current?.path === path && !current.loading
          ? {
              ...current,
              line: nextLine,
            }
          : {
              path,
              name: normalizedName,
              content: current?.path === path ? current.content : "",
              loading: current?.path === path ? current.loading : true,
              error: null,
              line: nextLine,
            },
      );

      void navigate({
        to: "/threads/$threadId/$section",
        params: { threadId: activeThreadId, section: "editor" } as never,
        search: {
          path,
          line: nextLine ? String(nextLine) : undefined,
          from: source,
        } as never,
      });
    },
    [activeThreadId, navigate],
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

      void navigate({
        to: "/threads/$threadId/$section",
        params: { threadId: activeThreadId, section: "review" } as never,
        search: {
          diff: nextDiffId ?? undefined,
          from: source,
        } as never,
      });
    },
    [activeThreadId, diffEntries, navigate, selectedDiffEntry],
  );

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    if (activeThreadId) {
      navigateToThread(activeThreadId, "chat");
    }
  }, [activeThreadId, navigateToThread]);

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
        setPanelOpen(isDesktopViewport());
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

      return activeThread?.thread.cwd ?? SESSION_PROJECT_ROOT;
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
    () => selectedMentions.filter((mention) => composerHasMentionToken(composer, mention)),
    [composer, selectedMentions],
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
        case "/apps":
        case "/exit":
        case "/quit":
        case "/personality":
          pushToast(`${command} queued`, "");
          break;
        case "/logout":
          await actions.logoutAccount();
          pushToast("Signed out of Codex", "ok");
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
          { icon: "⬛", name: "Terminal Output (/ps)", key: "", command: { type: "openPanel", tab: "terminal" } },
          { icon: "⑂", name: "Multi-agent Panel", key: "", command: { type: "openPanel", tab: "agents" } },
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
      {
        label: "Model",
        items: modelOptions.map((entry) => ({
          icon: "🤖",
          name: entry.displayName,
          key: "",
          command: { type: "selectModel", modelId: entry.id },
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
    [compactSession, createSession, forkSession, openPanel, resetComposer, runSlash, selectModel],
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
      const nextPrompt = toolbarShell && prompt ? `! ${prompt}` : prompt;
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
    navigateToThread,
    pushToast,
    resetComposer,
    route.section,
    runSlash,
    snapshot.transport.error,
    snapshot.threads,
    selectedMentions,
    selectedImages,
    selectedFiles,
    selectedSkills,
    effectiveComposerSettings,
    projectPickerPath,
    toolbarShell,
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

  const currentTokenCount = Math.floor(composer.length / 3.5).toLocaleString();
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
                  route.section === "editor" && editorPath === entry.path && "open",
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
          <div className="panel-meta">
            <div>Tap a file to open the full editor. Tap folders to drill in.</div>
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
          <span>Codex Console</span>
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

          {route.section === "editor" ? (
            <div id="editor-page">
              {editorPreviewState ? (
                <FileEditorPreview
                  backLabel={editorBackLabel}
                  onBack={closeEditor}
                  preview={editorPreviewState}
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
                  activeTurns={activeTurns}
                  existingThreadHistoryPending={existingThreadHistoryPending}
                  streamTextFx={streamTextFx}
                  onContext={openItemContextMenu}
                  onCopy={handleCopy}
                  onEdit={fillComposer}
                  onFill={fillComposer}
                  onFork={forkSession}
                  onOpenFile={(path, line) =>
                    openThreadFile(path, {
                      line,
                      source: "chat",
                    })
                  }
                  onPlan={triggerPlan}
                  onReview={(diffId) => reviewDiff(diffId)}
                  onSlash={triggerSlash}
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
                    key={composerSyncKey}
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
                <span>⏎ send · ⇧⏎ newline</span>
                <span>/cmds · $skills · !shell</span>
                <span id="tokcount">{currentTokenCount} / 200k ctx</span>
              </div>
            </div>
              </div>
            </>
          )}
        </section>

        <aside id="rp" className={clsx(panelOpen && route.section !== "editor" && route.section !== "review" && "open")}>
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
