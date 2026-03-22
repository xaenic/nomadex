import type { Personality } from "../protocol/Personality";
import type { FuzzyFileSearchResult } from "../protocol/FuzzyFileSearchResult";
import type { CollaborationMode } from "../protocol/CollaborationMode";
import type {
  CollaborationModeListResponse,
  CommandExecutionRequestApprovalParams,
  Config,
  ConfigReadResponse,
  ExperimentalFeature,
  ExperimentalFeatureListResponse,
  FileChangeRequestApprovalParams,
  FileUpdateChange,
  FsReadDirectoryEntry,
  FsReadDirectoryResponse,
  FsReadFileResponse,
  GetAccountRateLimitsResponse,
  GetAccountResponse,
  LoginAccountResponse,
  ListMcpServerStatusResponse,
  ModelListResponse,
  RateLimitSnapshot,
  RemoteSkillSummary,
  ReviewStartResponse,
  SkillMetadata,
  SkillsListResponse,
  SkillsRemoteReadResponse,
  Thread,
  ThreadItem,
  ThreadReadResponse,
  ThreadResumeResponse,
  ThreadStartResponse,
  Turn,
  TurnError,
  TurnInterruptResponse,
  TurnStartResponse,
  UserInput,
} from "../protocol/v2";
import {
  createFallbackDashboardData,
  type ApprovalRequest,
  type CollaborationPreset,
  type ComposerFile,
  type ComposerImage,
  type DashboardData,
  type FeatureFlag as UiFeatureFlag,
  type MentionAttachment,
  type RemoteSkillCard,
  type SettingsState,
  type SkillCard,
  type TerminalSession,
  type ThreadPlan,
  type ThreadRecord,
  type WorkspaceMode,
} from "./mockData";

type EventListener = (snapshot: DashboardData) => void;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

type ServerEnvelope = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

const inferProxyWsUrl = () => {
  if (typeof window === "undefined") {
    return "ws://127.0.0.1:3901";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/codex-ws`;
};

const resolveWsUrls = () => {
  const urls: string[] = [];
  const addUrl = (value: string | undefined) => {
    if (!value || urls.includes(value)) {
      return;
    }

    urls.push(value);
  };

  if (typeof window === "undefined") {
    addUrl(import.meta.env.VITE_CODEX_WS_URL);
    addUrl("ws://127.0.0.1:3901");
    return urls;
  }

  addUrl(import.meta.env.VITE_CODEX_WS_URL);
  addUrl(inferProxyWsUrl());
  return urls;
};

const WS_URL_CANDIDATES = resolveWsUrls();
const DEFAULT_WS_URL = WS_URL_CANDIDATES[0] ?? "ws://127.0.0.1:3901";

const DEFAULT_STEER_SUGGESTIONS = [
  "Keep the answer terse and operational.",
  "Call out blockers before proposing polish.",
  "Prefer concrete file references over abstractions.",
];

const APPROVAL_OPTIONS: Array<SettingsState["approvalPolicy"]> = ["untrusted", "on-failure", "on-request", "never"];
const PERSONALITY_OPTIONS: Array<SettingsState["personality"]> = ["none", "friendly", "pragmatic"];

const toArray = <T>(value: Array<T> | null | undefined) => value ?? [];

const relativeNow = () => "just now";

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const safeString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "message" in error.data &&
    typeof error.data.message === "string"
  ) {
    return error.data.message;
  }

  return "";
};

const isFreshThreadUnavailableError = (error: unknown) => {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("no rollout found for thread id") ||
    message.includes("not materialized yet")
  );
};

const mapFeatureFlag = (feature: ExperimentalFeature): UiFeatureFlag => ({
  name: feature.name,
  stage: feature.stage,
  enabled: feature.enabled,
});

const mapApprovalPolicy = (value: Config["approval_policy"], fallback: SettingsState["approvalPolicy"]) => {
  if (typeof value === "string" && APPROVAL_OPTIONS.includes(value as SettingsState["approvalPolicy"])) {
    return value as SettingsState["approvalPolicy"];
  }

  return fallback;
};

const mapPersonality = (value: Config["personality"], fallback: SettingsState["personality"]) => {
  if (typeof value === "string" && PERSONALITY_OPTIONS.includes(value as SettingsState["personality"])) {
    return value as SettingsState["personality"];
  }

  return fallback;
};

const toSettingsState = (config: Config, fallback: SettingsState): SettingsState => {
  const notice = "notice" in config && typeof config.notice === "object" && config.notice ? config.notice : null;
  const analytics =
    config.analytics && typeof config.analytics === "object" && "enabled" in config.analytics
      ? Boolean(config.analytics.enabled)
      : fallback.analytics;

  return {
    model: config.model ?? fallback.model,
    reasoningEffort: config.model_reasoning_effort ?? fallback.reasoningEffort,
    approvalPolicy: mapApprovalPolicy(config.approval_policy, fallback.approvalPolicy),
    sandboxMode: config.sandbox_mode ?? fallback.sandboxMode,
    collaborationMode: "default",
    personality: mapPersonality(config.personality, fallback.personality),
    webSearch: config.web_search ? config.web_search !== "disabled" : fallback.webSearch,
    analytics,
    hideRateLimitNudge:
      notice && typeof notice === "object" && "hide_rate_limit_model_nudge" in notice
        ? Boolean(notice.hide_rate_limit_model_nudge)
        : fallback.hideRateLimitNudge,
  };
};

const formatCredits = (rateLimits: RateLimitSnapshot | null, fallback: string) => {
  if (!rateLimits?.credits) {
    return fallback;
  }

  if (rateLimits.credits.unlimited) {
    return "Unlimited credits";
  }

  if (rateLimits.credits.hasCredits) {
    return `${rateLimits.credits.balance} credits`;
  }

  return "No credits";
};

const labelRateLimitWindow = (windowDurationMins: number | null, index: number) => {
  if (windowDurationMins === 300) {
    return "5-hour";
  }

  if (windowDurationMins === 60 * 24 * 7) {
    return "Weekly";
  }

  if (windowDurationMins && windowDurationMins % (60 * 24) === 0) {
    const days = windowDurationMins / (60 * 24);
    return `${days}-day`;
  }

  if (windowDurationMins && windowDurationMins % 60 === 0) {
    const hours = windowDurationMins / 60;
    return `${hours}-hour`;
  }

  if (windowDurationMins) {
    return `${windowDurationMins}-minute`;
  }

  return index === 0 ? "Primary" : "Secondary";
};

const toUsageWindows = (
  rateLimits: RateLimitSnapshot | null,
  fallback: DashboardData["account"]["usageWindows"],
) => {
  if (!rateLimits) {
    return fallback;
  }

  const windows = [rateLimits.primary, rateLimits.secondary]
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry, index) => ({
      id: `${rateLimits.limitId ?? "codex"}-${entry.windowDurationMins ?? index}-${index}`,
      label: labelRateLimitWindow(entry.windowDurationMins, index),
      usedPercent: Number(entry.usedPercent ?? 0),
      windowDurationMins: entry.windowDurationMins ?? null,
      resetsAt: entry.resetsAt ?? null,
    }))
    .sort((left, right) => (left.windowDurationMins ?? Number.MAX_SAFE_INTEGER) - (right.windowDurationMins ?? Number.MAX_SAFE_INTEGER));

  return windows.length > 0 ? windows : fallback;
};

const applyRateLimitSnapshot = (
  account: DashboardData["account"],
  rateLimits: RateLimitSnapshot | null,
): DashboardData["account"] => {
  return {
    ...account,
    rateUsed: Number(rateLimits?.primary?.usedPercent ?? account.rateUsed),
    rateLimit: 100,
    credits: formatCredits(rateLimits, account.credits),
    usageWindows: toUsageWindows(rateLimits, account.usageWindows),
  };
};

const toAccountState = (
  account: GetAccountResponse | null,
  rateLimits: GetAccountRateLimitsResponse | null,
  fallback: DashboardData["account"],
) => {
  const snapshot = rateLimits?.rateLimits ?? null;
  const accountRecord = account?.account ?? null;

  const workspace =
    accountRecord?.type === "chatgpt" ? accountRecord.email : accountRecord?.type === "apiKey" ? "API key" : fallback.workspace;

  const planType =
    accountRecord?.type === "chatgpt"
      ? `ChatGPT ${capitalize(accountRecord.planType)}`
      : accountRecord?.type === "apiKey"
        ? "API key"
        : fallback.loginInProgress
          ? fallback.planType
          : "Signed out";

  const workspaceLabel = accountRecord
    ? workspace
    : fallback.loginInProgress
      ? fallback.workspace
      : "No active account";

  return {
    ...applyRateLimitSnapshot(fallback, snapshot),
    planType,
    workspace: workspaceLabel,
    authMode: accountRecord?.type ?? (fallback.loginInProgress ? fallback.authMode : "signedOut"),
    loggedIn: Boolean(accountRecord),
    requiresOpenaiAuth: account?.requiresOpenaiAuth ?? fallback.requiresOpenaiAuth,
    loginInProgress: !accountRecord && fallback.loginInProgress,
    pendingLoginId: !accountRecord ? fallback.pendingLoginId : null,
    loginError: accountRecord ? null : fallback.loginError,
  };
};

const toCollaborationModes = (response: CollaborationModeListResponse | null, fallback: Array<CollaborationPreset>) => {
  if (!response?.data.length) {
    return fallback;
  }

  return response.data
    .filter((entry) => entry.mode === "default" || entry.mode === "plan")
    .map((entry) => ({
      name: entry.name,
      mode: entry.mode as CollaborationPreset["mode"],
      model: entry.model ?? fallback[0]?.model ?? "gpt-5.4",
      effort: entry.reasoning_effort ?? fallback[0]?.effort ?? "medium",
    }));
};

const mapScope = (scope: SkillMetadata["scope"]): SkillCard["scope"] => {
  if (scope === "repo") {
    return "workspace";
  }

  if (scope === "system" || scope === "admin") {
    return "system";
  }

  return "user";
};

const toSkillCard = (skill: SkillMetadata): SkillCard => ({
  id: skill.path,
  name: skill.name,
  description: skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description,
  path: skill.path,
  scope: mapScope(skill.scope),
  enabled: skill.enabled,
  source: "installed",
  tags: [skill.scope, skill.enabled ? "enabled" : "disabled"],
});

const toRemoteSkillCard = (skill: RemoteSkillSummary): RemoteSkillCard => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  path: `hazelnut://${skill.id}`,
  scope: "system",
  enabled: false,
  source: "remote",
  tags: ["remote"],
  repo: "remote marketplace",
  downloads: "available",
});

const createDefaultPlan = (thread: Thread): ThreadPlan | null => {
  const planItem = [...thread.turns]
    .reverse()
    .flatMap((turn) => [...turn.items].reverse())
    .find((item): item is Extract<ThreadItem, { type: "plan" }> => item.type === "plan");

  if (!planItem) {
    return null;
  }

  return {
    explanation: planItem.text,
    steps: [{ step: planItem.text, status: "inProgress" }],
  };
};

const splitOutput = (value: string | null) => {
  if (!value) {
    return [];
  }

  return value.split("\n");
};

const toTerminalStatus = (item: Extract<ThreadItem, { type: "commandExecution" }>): TerminalSession["status"] => {
  if (item.status === "inProgress") {
    return "running";
  }

  if (item.exitCode && item.exitCode !== 0) {
    return "failed";
  }

  return "idle";
};

const buildTerminalsFromTurns = (thread: Thread): Array<TerminalSession> => {
  const items = [...thread.turns].flatMap((turn) => turn.items);

  return items
    .filter((item): item is Extract<ThreadItem, { type: "commandExecution" }> => item.type === "commandExecution")
    .reverse()
    .map((item) => ({
      id: item.id,
      title: item.command.split(" ").slice(0, 3).join(" ") || "Terminal",
      command: item.command,
      cwd: item.cwd,
      processId: item.processId ?? item.id,
      status: toTerminalStatus(item),
      background: true,
      lastEvent: relativeNow(),
      log: item.aggregatedOutput ? [`$ ${item.command}`, ...splitOutput(item.aggregatedOutput)] : [`$ ${item.command}`],
    }));
};

const parseReviewFindings = (thread: Thread) => {
  const findings: ThreadRecord["review"] = [];
  const seen = new Set<string>();

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type !== "agentMessage") {
        continue;
      }

      for (const line of item.text.split("\n")) {
        const match = line.match(/^\s*(?:\d+[.)]\s*)?(high|medium|low)\s*[:-]\s*(.+)$/i);
        if (!match) {
          continue;
        }

        const severity = match[1].toLowerCase() as "high" | "medium" | "low";
        const summary = match[2].trim();
        const fileMatch = summary.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)/);
        const file = fileMatch?.[1] ?? thread.cwd;
        const lineNumber = fileMatch ? Number(fileMatch[2]) : 1;
        const key = `${severity}:${summary}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        findings.push({
          id: key,
          severity,
          title: summary,
          file,
          line: lineNumber,
          summary,
          status: "open",
        });
      }
    }
  }

  return findings;
};

const ensureStream = (
  snapshot: DashboardData,
  threadId: string,
  turnId: string,
  itemId: string,
  field: "text" | "aggregatedOutput",
  value: string,
  live: boolean,
) => {
  const key = `${itemId}:${field}`;
  const currentIndex = snapshot.streams.findIndex((entry) => entry.key === key);
  const nextEntry = {
    key,
    threadId,
    turnId,
    itemId,
    field,
    visible: value.length,
    total: live ? value.length + 1 : value.length,
    speed: 1,
  };

  if (currentIndex === -1) {
    snapshot.streams = [...snapshot.streams, nextEntry];
    return;
  }

  snapshot.streams = snapshot.streams.map((entry, index) => (index === currentIndex ? nextEntry : entry));
};

const stopStreamsForItem = (snapshot: DashboardData, itemId: string) => {
  snapshot.streams = snapshot.streams.map((entry) =>
    entry.itemId === itemId
      ? {
          ...entry,
          visible: entry.visible,
          total: entry.visible,
        }
      : entry,
  );
};

const turnSortWeight = (id: string) =>
  id.startsWith(OPTIMISTIC_TURN_PREFIX) ? 1 : 0;

const sortTurnsById = (turns: Array<Turn>) =>
  [...turns].sort((left, right) => {
    const weightDiff = turnSortWeight(left.id) - turnSortWeight(right.id);
    if (weightDiff !== 0) {
      return weightDiff;
    }

    return left.id.localeCompare(right.id);
  });

const ensureTurnExists = (turns: Array<Turn>, turnId: string, status: Turn["status"] = "inProgress") => {
  if (turns.some((turn) => turn.id === turnId)) {
    return sortTurnsById(turns);
  }

  return sortTurnsById([
    ...turns,
    {
      id: turnId,
      items: [],
      status,
      error: null,
    },
  ]);
};

const updateThreadRecord = (
  snapshot: DashboardData,
  threadId: string,
  updater: (record: ThreadRecord) => ThreadRecord,
) => {
  snapshot.threads = snapshot.threads.map((record) => (record.thread.id === threadId ? updater(record) : record));
};

const sortThreads = (threads: Array<ThreadRecord>) => [...threads].sort((left, right) => right.thread.updatedAt - left.thread.updatedAt);

const upsertThreadRecord = (snapshot: DashboardData, record: ThreadRecord) => {
  const existingIndex = snapshot.threads.findIndex((entry) => entry.thread.id === record.thread.id);
  if (existingIndex === -1) {
    snapshot.threads = sortThreads([record, ...snapshot.threads]);
    return;
  }

  snapshot.threads = sortThreads(snapshot.threads.map((entry, index) => (index === existingIndex ? record : entry)));
};

const mergeThread = (thread: Thread, current?: ThreadRecord): ThreadRecord => {
  const existingTurns = current?.thread.turns ?? [];
  const mergedTurns =
    thread.turns.length > 0
      ? sortTurnsById([
          ...thread.turns.map((incomingTurn) => mergeIncomingTurn(incomingTurn, existingTurns.find((turn) => turn.id === incomingTurn.id))),
          ...existingTurns.filter((turn) => !thread.turns.some((incomingTurn) => incomingTurn.id === turn.id)),
        ])
      : sortTurnsById(existingTurns);

  const mergedThread: Thread = current
    ? {
        ...current.thread,
        ...thread,
        turns: mergedTurns,
      }
    : {
        ...thread,
        turns: mergedTurns,
      };

  return {
    thread: mergedThread,
    plan: current?.plan ?? createDefaultPlan(mergedThread),
    steerSuggestions: current?.steerSuggestions ?? DEFAULT_STEER_SUGGESTIONS,
    approvals: current?.approvals ?? [],
    terminals: buildTerminalsFromTurns(mergedThread),
    reroutes: current?.reroutes ?? [],
    review: parseReviewFindings(mergedThread),
    tokenUsage: current?.tokenUsage ?? {
      input: 0,
      output: 0,
      cached: 0,
    },
  };
};

const mapMention = (match: FuzzyFileSearchResult): MentionAttachment => ({
  id: `${match.root}:${match.path}`,
  name: match.path,
  path: `${match.root}/${match.path}`,
  kind: "file",
});

const OMIT_DIRECTORY_NAMES = new Set([".git", "node_modules"]);

const sortMentionAttachments = (entries: Array<MentionAttachment>) =>
  [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

const joinPath = (root: string, name: string) => `${root.replace(/\/+$/u, "")}/${name}`;

const mapDirectoryEntry = (cwd: string, entry: FsReadDirectoryEntry): MentionAttachment | null => {
  if (OMIT_DIRECTORY_NAMES.has(entry.fileName)) {
    return null;
  }

  const kind = entry.isDirectory ? "directory" : entry.isFile ? "file" : null;
  if (!kind) {
    return null;
  }

  return {
    id: `${cwd}:${entry.fileName}`,
    name: entry.fileName,
    path: joinPath(cwd, entry.fileName),
    kind,
  };
};

const sanitizeFilename = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "-");

const bytesToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
};

const base64ToText = (value: string) => {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const settingEditsFromPatch = (patch: Partial<SettingsState>): Array<{ keyPath: string; value: unknown }> => {
  const edits: Array<{ keyPath: string; value: unknown }> = [];

  if (patch.model) {
    edits.push({ keyPath: "model", value: patch.model });
  }

  if (patch.reasoningEffort) {
    edits.push({ keyPath: "model_reasoning_effort", value: patch.reasoningEffort });
  }

  if (patch.approvalPolicy) {
    edits.push({ keyPath: "approval_policy", value: patch.approvalPolicy });
  }

  if (patch.sandboxMode) {
    edits.push({ keyPath: "sandbox_mode", value: patch.sandboxMode });
  }

  if (patch.personality) {
    edits.push({ keyPath: "personality", value: patch.personality });
  }

  if (typeof patch.webSearch === "boolean") {
    edits.push({ keyPath: "web_search", value: patch.webSearch ? "live" : "disabled" });
  }

  if (typeof patch.analytics === "boolean") {
    edits.push({ keyPath: "analytics.enabled", value: patch.analytics });
  }

  if (typeof patch.hideRateLimitNudge === "boolean") {
    edits.push({ keyPath: "notice.hide_rate_limit_model_nudge", value: patch.hideRateLimitNudge });
  }

  return edits;
};

const toTurnInputs = (text: string, mentions: Array<MentionAttachment>, skills: Array<SkillCard>, images: Array<string>): Array<UserInput> => {
  const inputs: Array<UserInput> = [];

  if (text.trim()) {
    inputs.push({
      type: "text",
      text,
      text_elements: [],
    });
  }

  inputs.push(
    ...mentions.map<UserInput>((mention) => ({
      type: "mention",
      name: mention.name,
      path: mention.path,
    })),
  );

  inputs.push(
    ...skills.map<UserInput>((skill) => ({
      type: "skill",
      name: skill.name,
      path: skill.path,
    })),
  );

  inputs.push(
    ...images.map<UserInput>((path) => ({
      type: "localImage",
      path,
    })),
  );

  return inputs;
};

const toOptimisticFileMentions = (
  cwd: string,
  files: Array<ComposerFile>,
): Array<MentionAttachment> =>
  files.map((file) => ({
    id: `optimistic-file:${file.id}`,
    name: file.name,
    path: `${cwd}/.codex-web/uploads/files/${file.name}`,
    kind: "file",
  }));

const cloneDashboardSnapshot = (snapshot: DashboardData): DashboardData => ({
  ...snapshot,
  threads: [...snapshot.threads],
  models: [...snapshot.models],
  collaborationModes: [...snapshot.collaborationModes],
  settings: { ...snapshot.settings },
  installedSkills: [...snapshot.installedSkills],
  remoteSkills: [...snapshot.remoteSkills],
  mcpServers: [...snapshot.mcpServers],
  featureFlags: [...snapshot.featureFlags],
  account: {
    ...snapshot.account,
    usageWindows: [...snapshot.account.usageWindows],
  },
  mentionCatalog: [...snapshot.mentionCatalog],
  directoryCatalog: [...snapshot.directoryCatalog],
  streams: [...snapshot.streams],
  transport: { ...snapshot.transport },
});

const settingsToCollaborationMode = (settings: SettingsState): CollaborationMode => ({
  mode: settings.collaborationMode,
  settings: {
    model: settings.model,
    reasoning_effort: settings.reasoningEffort,
    developer_instructions: null,
  },
});

const toRuntimeStatus = (mode: DashboardData["transport"]["mode"], status: DashboardData["transport"]["status"], error: string | null) => ({
  mode,
  status,
  endpoint: DEFAULT_WS_URL,
  error,
});

const OPTIMISTIC_USER_MESSAGE_PREFIX = "optimistic-user:";
const OPTIMISTIC_TURN_PREFIX = "optimistic-turn:";
const LIVE_FILE_CHANGE_PREVIEW_PREFIX = "live-filechange-preview:";

const isOptimisticUserMessage = (item: ThreadItem) => item.type === "userMessage" && item.id.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX);
const isOptimisticTurn = (turn: Turn) => turn.id.startsWith(OPTIMISTIC_TURN_PREFIX);
const isLiveFileChangePreview = (item: ThreadItem) => item.type === "fileChange" && item.id.startsWith(LIVE_FILE_CHANGE_PREVIEW_PREFIX);
type FileChangeItem = Extract<ThreadItem, { type: "fileChange" }>;

const stripOptimisticTurns = (turns: Array<Turn>) => turns.filter((turn) => !isOptimisticTurn(turn));

const normalizeDiffPath = (value: string) => value.replace(/^[ab]\//, "");
const createEditingDiffChange = (diff: string): FileUpdateChange => ({
  path: "Editing files",
  kind: { type: "update", move_path: null },
  diff,
});

const createFileChangeItem = (
  id: string,
  changes: Array<FileUpdateChange>,
  status: FileChangeItem["status"] = "inProgress",
): FileChangeItem => ({
  type: "fileChange",
  id,
  changes,
  status,
});

const appendFileChangeDelta = (item: FileChangeItem, delta: string): FileChangeItem => ({
  ...item,
  status: "inProgress",
  changes:
    item.changes.length > 0
      ? item.changes.map((change, index) =>
          index === item.changes.length - 1
            ? {
                ...change,
                diff: `${change.diff}${delta}`,
              }
            : change,
        )
      : [createEditingDiffChange(delta)],
});

const parseUnifiedDiffChanges = (diff: string): Array<FileUpdateChange> => {
  if (!diff.trim()) {
    return [];
  }

  const lines = diff.split("\n");
  const changes: Array<FileUpdateChange> = [];
  let current:
    | {
        path: string;
        kind: FileUpdateChange["kind"];
        lines: string[];
        oldPath: string | null;
        newPath: string | null;
      }
    | null = null;

  const flush = () => {
    if (!current) {
      return;
    }

    const nextPath = current.newPath ?? current.path ?? current.oldPath ?? "Editing files";
    const nextDiff = current.lines.join("\n").trimEnd();
    if (nextDiff || current.kind.type !== "update") {
      changes.push({
        path: nextPath,
        kind: current.kind,
        diff: nextDiff,
      });
    }
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const oldPath = match?.[1] ? normalizeDiffPath(match[1]) : null;
      const newPath = match?.[2] ? normalizeDiffPath(match[2]) : null;
      current = {
        path: newPath ?? oldPath ?? "Editing files",
        kind: { type: "update", move_path: null },
        lines: [],
        oldPath,
        newPath,
      };
      continue;
    }

    if (!current) {
      current = {
        path: "Editing files",
        kind: { type: "update", move_path: null },
        lines: [],
        oldPath: null,
        newPath: null,
      };
    }

    if (line.startsWith("new file mode ")) {
      current.kind = { type: "add" };
      continue;
    }

    if (line.startsWith("deleted file mode ")) {
      current.kind = { type: "delete" };
      continue;
    }

    if (line.startsWith("rename from ")) {
      current.oldPath = line.slice("rename from ".length).trim();
      continue;
    }

    if (line.startsWith("rename to ")) {
      const movePath = line.slice("rename to ".length).trim();
      current.newPath = movePath;
      current.path = movePath;
      current.kind = { type: "update", move_path: movePath };
      continue;
    }

    if (line.startsWith("--- ")) {
      const source = line.slice(4).trim();
      current.oldPath = source === "/dev/null" ? null : normalizeDiffPath(source);
      if (current.oldPath) {
        current.path = current.oldPath;
      }
      current.lines.push(line);
      continue;
    }

    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      current.newPath = target === "/dev/null" ? null : normalizeDiffPath(target);
      if (target === "/dev/null") {
        current.kind = { type: "delete" };
      } else if (current.oldPath === null) {
        current.kind = { type: "add" };
      }
      if (current.newPath) {
        current.path = current.newPath;
      }
      current.lines.push(line);
      continue;
    }

    current.lines.push(line);
  }

  flush();

  return changes.length > 0
    ? changes
    : [createEditingDiffChange(diff.trimEnd())];
};

const upsertLiveFileChangePreview = (items: Array<ThreadItem>, turnId: string, diff: string): Array<ThreadItem> => {
  const changes = parseUnifiedDiffChanges(diff);
  const withoutPreview = items.filter((item) => !isLiveFileChangePreview(item));

  if (changes.length === 0) {
    return withoutPreview;
  }

  return [
    ...withoutPreview,
    createFileChangeItem(`${LIVE_FILE_CHANGE_PREVIEW_PREFIX}${turnId}`, changes),
  ];
};

const mergeIncomingTurn = (incoming: Turn, existing?: Turn): Turn => ({
  ...existing,
  ...incoming,
  items: incoming.items.length > 0 ? incoming.items : existing?.items ?? [],
});

const mergeIncomingItem = (incoming: ThreadItem, existing?: ThreadItem): ThreadItem => {
  if (!existing || existing.type !== incoming.type) {
    return incoming;
  }

  if (incoming.type === "agentMessage") {
    const current = existing as Extract<ThreadItem, { type: "agentMessage" }>;

    return {
      ...current,
      ...incoming,
      text: incoming.text.length >= current.text.length ? incoming.text : current.text,
      phase: incoming.phase ?? current.phase,
    };
  }

  if (incoming.type === "commandExecution") {
    const current = existing as Extract<ThreadItem, { type: "commandExecution" }>;
    const incomingOutput = incoming.aggregatedOutput ?? "";
    const existingOutput = current.aggregatedOutput ?? "";

    return {
      ...current,
      ...incoming,
      aggregatedOutput:
        incomingOutput.length >= existingOutput.length ? incoming.aggregatedOutput : current.aggregatedOutput,
      command: incoming.command || current.command,
      cwd: incoming.cwd || current.cwd,
      processId: incoming.processId ?? current.processId,
    };
  }

  if (incoming.type === "reasoning") {
    const current = existing as Extract<ThreadItem, { type: "reasoning" }>;

    return {
      ...current,
      ...incoming,
      summary: incoming.summary.length >= current.summary.length ? incoming.summary : current.summary,
      content: incoming.content.length >= current.content.length ? incoming.content : current.content,
    };
  }

  return incoming;
};

export class CodexLiveRuntime {
  private snapshot: DashboardData;
  private listeners = new Set<EventListener>();
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private loadingThreads = new Set<string>();
  private resumedThreads = new Set<string>();
  private approvalMap = new Map<string, { requestId: string; method: string; params: Record<string, unknown> }>();
  private emitQueued = false;
  private emitFrame: number | null = null;
  private emitTimer: number | null = null;

  constructor(initialData = createFallbackDashboardData()) {
    this.snapshot = {
      ...initialData,
      transport: toRuntimeStatus("mock", "connecting", null),
    };
  }

  subscribe(listener: EventListener) {
    this.listeners.add(listener);
    listener(cloneDashboardSnapshot(this.snapshot));
    return () => {
      this.listeners.delete(listener);
    };
  }

  disconnect() {
    this.clearScheduledEmit();
    this.socket?.close();
    this.socket = null;
    this.failPending(new Error("Codex app-server connection closed."));
    this.connectPromise = null;
    this.loadingThreads.clear();
    this.resumedThreads.clear();
  }

  private handleSocketClose(socket: WebSocket) {
    if (this.socket !== socket) {
      return;
    }

    this.socket = null;
    this.connectPromise = null;
    this.failPending(new Error("Codex app-server connection closed."));
    this.loadingThreads.clear();
    this.resumedThreads.clear();
    this.mutate((snapshot) => {
      snapshot.transport = toRuntimeStatus(snapshot.transport.mode, "offline", snapshot.transport.error);
    });
  }

  private async openSocket(url: string) {
    return await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url);
      let settled = false;

      const rejectOnce = () => {
        if (settled) {
          return;
        }

        settled = true;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;

        try {
          socket.close();
        } catch {
          // Ignore cleanup errors for failed connection attempts.
        }

        reject(new Error(`Failed to connect to ${url}`));
      };

      socket.onopen = () => {
        if (settled) {
          return;
        }

        settled = true;
        socket.onmessage = this.onMessage;
        socket.onerror = () => undefined;
        socket.onclose = () => {
          this.handleSocketClose(socket);
        };
        resolve(socket);
      };
      socket.onerror = rejectOnce;
      socket.onclose = rejectOnce;
    });
  }

  private failPending(error: Error) {
    this.pending.forEach((request) => {
      request.reject(error);
    });
    this.pending.clear();
  }

  private clearScheduledEmit() {
    if (typeof window === "undefined") {
      return;
    }

    if (this.emitFrame !== null) {
      window.cancelAnimationFrame(this.emitFrame);
      this.emitFrame = null;
    }

    if (this.emitTimer !== null) {
      window.clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
  }

  private flushEmit = () => {
    this.clearScheduledEmit();
    this.emitQueued = false;
    const next = cloneDashboardSnapshot(this.snapshot);
    this.listeners.forEach((listener) => listener(next));
  };

  private emit() {
    if (this.emitQueued) {
      return;
    }

    this.emitQueued = true;

    if (typeof window === "undefined") {
      queueMicrotask(this.flushEmit);
      return;
    }

    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      this.emitFrame = window.requestAnimationFrame(this.flushEmit);
      return;
    }

    this.emitTimer = window.setTimeout(this.flushEmit, 32);
  }

  private mutate(mutator: (snapshot: DashboardData) => void) {
    mutator(this.snapshot);
    this.emit();
  }

  private onMessage = (event: MessageEvent<string>) => {
    const message = JSON.parse(event.data) as ServerEnvelope;

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined) && !message.method) {
      const pending = this.pending.get(String(message.id));
      if (!pending) {
        return;
      }

      this.pending.delete(String(message.id));

      if (message.error !== undefined) {
        pending.reject(message.error);
      } else {
        pending.resolve(message.result);
      }

      return;
    }

    if (message.method && message.id !== undefined) {
      this.handleServerRequest(String(message.id), message.method, message.params ?? {});
      return;
    }

    if (message.method) {
      this.handleNotification(message.method, message.params ?? {});
    }
  };

  private async request<TResult>(method: string, params: unknown): Promise<TResult> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex app-server is not connected.");
    }

    const id = String(++this.requestId);
    const payload = { id, method, params };

    return await new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.socket?.send(JSON.stringify(payload));
    });
  }

  private respond(requestId: string, result: unknown) {
    this.socket?.send(JSON.stringify({ id: requestId, result }));
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return await (this.connectPromise ?? Promise.resolve());
    }

    if (this.connectPromise) {
      return await this.connectPromise;
    }

    this.connectPromise = (async () => {
      let connected = false;
      for (const candidate of WS_URL_CANDIDATES) {
        try {
          this.socket = await this.openSocket(candidate);
          connected = true;
          break;
        } catch {
          continue;
        }
      }

      if (!connected || !this.socket) {
        const error =
          WS_URL_CANDIDATES.length > 1
            ? `Failed to connect to Codex app-server. Tried: ${WS_URL_CANDIDATES.join(", ")}`
            : `Failed to connect to ${DEFAULT_WS_URL}`;

        this.mutate((snapshot) => {
          snapshot.transport = toRuntimeStatus("mock", "error", error);
        });
        throw new Error(error);
      }

      try {
        await this.request("initialize", {
          clientInfo: {
            name: "codex-console",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi: true,
          },
        });

        await this.bootstrap();
      } catch (error) {
        this.mutate((snapshot) => {
          snapshot.transport = toRuntimeStatus("mock", "error", error instanceof Error ? error.message : String(error));
        });
        throw error;
      }
    })();

    try {
      await this.connectPromise;
    } finally {
      if (this.socket?.readyState !== WebSocket.CONNECTING) {
        this.connectPromise = null;
      }
    }
  }

  private async bootstrap() {
    const [
      threadsResult,
      modelsResult,
      collabResult,
      featuresResult,
      accountResult,
      ratesResult,
      skillsResult,
      remoteSkillsResult,
      mcpResult,
      configResult,
    ] = await Promise.allSettled([
      this.request<{ data: Array<Thread>; nextCursor: string | null }>("thread/list", { limit: 60 }),
      this.request<ModelListResponse>("model/list", {}),
      this.request<CollaborationModeListResponse>("collaborationMode/list", {}),
      this.request<ExperimentalFeatureListResponse>("experimentalFeature/list", {}),
      this.request<GetAccountResponse>("account/read", {}),
      this.request<GetAccountRateLimitsResponse>("account/rateLimits/read", {}),
      this.request<SkillsListResponse>("skills/list", {}),
      this.request<SkillsRemoteReadResponse>("skills/remote/list", {
        hazelnutScope: "personal",
        productSurface: "codex",
        enabled: true,
      }),
      this.request<ListMcpServerStatusResponse>("mcpServerStatus/list", {}),
      this.request<ConfigReadResponse>("config/read", {}),
    ]);

    const current = this.snapshot;
    const threads =
      threadsResult.status === "fulfilled"
        ? threadsResult.value.data.map((thread) => mergeThread(thread, current.threads.find((entry) => entry.thread.id === thread.id)))
        : current.threads;

    const installedSkills =
      skillsResult.status === "fulfilled"
        ? skillsResult.value.data.flatMap((entry) => entry.skills.map(toSkillCard))
        : current.installedSkills;

    const remoteSkills =
      remoteSkillsResult.status === "fulfilled" ? remoteSkillsResult.value.data.map(toRemoteSkillCard) : current.remoteSkills;

    this.mutate((snapshot) => {
      snapshot.threads = sortThreads(threads);
      snapshot.models = modelsResult.status === "fulfilled" ? modelsResult.value.data : snapshot.models;
      snapshot.collaborationModes = toCollaborationModes(
        collabResult.status === "fulfilled" ? collabResult.value : null,
        snapshot.collaborationModes,
      );
      snapshot.featureFlags =
        featuresResult.status === "fulfilled" ? featuresResult.value.data.map(mapFeatureFlag) : snapshot.featureFlags;
      snapshot.account = toAccountState(
        accountResult.status === "fulfilled" ? accountResult.value : null,
        ratesResult.status === "fulfilled" ? ratesResult.value : null,
        snapshot.account,
      );
      snapshot.installedSkills = installedSkills;
      snapshot.remoteSkills = remoteSkills;
      snapshot.remoteSkillsError =
        remoteSkillsResult.status === "rejected"
          ? remoteSkillsResult.reason instanceof Error
            ? remoteSkillsResult.reason.message
            : String(remoteSkillsResult.reason)
          : null;
      snapshot.mcpServers = mcpResult.status === "fulfilled" ? mcpResult.value.data : snapshot.mcpServers;
      snapshot.settings =
        configResult.status === "fulfilled" ? toSettingsState(configResult.value.config, snapshot.settings) : snapshot.settings;
      snapshot.transport = toRuntimeStatus("live", "connected", null);
    });

    const firstThread = this.snapshot.threads[0]?.thread;
    if (firstThread) {
      await this.resumeThread(firstThread.id);
      await this.loadDirectory(firstThread.cwd);
    }
  }

  async ensureThreadLoaded(threadId: string) {
    if (this.loadingThreads.has(threadId)) {
      return;
    }

    const existing = this.snapshot.threads.find((entry) => entry.thread.id === threadId);
    if (existing && existing.thread.turns.length > 0) {
      return;
    }

    this.loadingThreads.add(threadId);

    try {
      const response = await this.request<ThreadReadResponse>("thread/read", {
        threadId,
        includeTurns: true,
      });

      this.mutate((snapshot) => {
        const current = snapshot.threads.find((entry) => entry.thread.id === response.thread.id);
        upsertThreadRecord(snapshot, mergeThread(response.thread, current));
      });
    } catch (error) {
      if (!isFreshThreadUnavailableError(error)) {
        throw error;
      }
    } finally {
      this.loadingThreads.delete(threadId);
    }
  }

  async resumeThread(threadId: string, force = false) {
    if (!threadId || this.loadingThreads.has(threadId)) {
      return;
    }

    if (!force && this.resumedThreads.has(threadId)) {
      return;
    }

    this.loadingThreads.add(threadId);

    try {
      const response = await this.request<ThreadResumeResponse>("thread/resume", {
        threadId,
        persistExtendedHistory: true,
      });

      this.mutate((snapshot) => {
        const current = snapshot.threads.find((entry) => entry.thread.id === response.thread.id);
        upsertThreadRecord(snapshot, mergeThread(response.thread, current));
      });

      this.resumedThreads.add(threadId);
    } catch (error) {
      if (isFreshThreadUnavailableError(error)) {
        return;
      }

      if (!force) {
        try {
          const response = await this.request<ThreadReadResponse>("thread/read", {
            threadId,
            includeTurns: true,
          });

          this.mutate((snapshot) => {
            const current = snapshot.threads.find((entry) => entry.thread.id === response.thread.id);
            upsertThreadRecord(snapshot, mergeThread(response.thread, current));
          });
        } catch (readError) {
          if (!isFreshThreadUnavailableError(readError)) {
            throw readError;
          }
        }
      } else {
        throw error;
      }
    } finally {
      this.loadingThreads.delete(threadId);
    }
  }

  async createThread(
    settings: SettingsState,
    options?: {
      cwd?: string;
    },
  ) {
    const response = await this.request<ThreadStartResponse>("thread/start", {
      cwd: options?.cwd ?? this.snapshot.threads[0]?.thread.cwd ?? "/home/allan",
      model: settings.model,
      approvalPolicy: settings.approvalPolicy,
      sandbox: settings.sandboxMode,
      ephemeral: false,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
      personality: settings.personality === "none" ? null : (settings.personality satisfies Personality),
    });

    this.mutate((snapshot) => {
      upsertThreadRecord(snapshot, mergeThread(response.thread, snapshot.threads.find((entry) => entry.thread.id === response.thread.id)));
    });

    await this.loadDirectory(response.thread.cwd).catch(() => undefined);
    return response.thread.id;
  }

  async uploadImages(cwd: string, images: Array<ComposerImage>) {
    if (images.length === 0) {
      return [];
    }

    const uploadDir = `${cwd}/.codex-web/uploads`;
    await this.request("fs/createDirectory", {
      path: uploadDir,
      recursive: true,
    });

    const paths: string[] = [];

    for (const image of images) {
      const response = await fetch(image.url);
      const buffer = await response.arrayBuffer();
      const filename = `${Date.now()}-${sanitizeFilename(image.name)}`;
      const path = `${uploadDir}/${filename}`;

      await this.request("fs/writeFile", {
        path,
        dataBase64: bytesToBase64(buffer),
      });

      paths.push(path);
    }

    return paths;
  }

  async uploadFiles(cwd: string, files: Array<ComposerFile>) {
    if (files.length === 0) {
      return [];
    }

    const uploadDir = `${cwd}/.codex-web/uploads/files`;
    await this.request("fs/createDirectory", {
      path: uploadDir,
      recursive: true,
    });

    const mentions: Array<MentionAttachment> = [];

    for (const file of files) {
      const filename = `${Date.now()}-${sanitizeFilename(file.name)}`;
      const path = `${uploadDir}/${filename}`;
      const buffer = await file.file.arrayBuffer();

      await this.request("fs/writeFile", {
        path,
        dataBase64: bytesToBase64(buffer),
      });

      mentions.push({
        id: `${path}:${file.id}`,
        name: file.name,
        path,
        kind: "file",
      });
    }

    return mentions;
  }

  async sendComposer(args: {
    threadId: string;
    mode: WorkspaceMode;
    prompt: string;
    mentions: Array<MentionAttachment>;
    skills: Array<SkillCard>;
    files: Array<ComposerFile>;
    images: Array<ComposerImage>;
    settings: SettingsState;
  }) {
    let thread = this.snapshot.threads.find((entry) => entry.thread.id === args.threadId)?.thread;
    if (!thread) {
      await this.resumeThread(args.threadId, true);
      thread = this.snapshot.threads.find((entry) => entry.thread.id === args.threadId)?.thread;
    }

    if (!thread) {
      return;
    }

    if (args.mode === "review") {
      const response = await this.request<ReviewStartResponse>("review/start", {
        threadId: args.threadId,
        delivery: "inline",
        target: args.prompt.trim()
          ? {
              type: "custom",
              instructions: args.prompt.trim(),
            }
          : {
              type: "uncommittedChanges",
            },
      });

      this.mutate((snapshot) => {
        updateThreadRecord(snapshot, args.threadId, (record) => ({
          ...record,
          thread: {
            ...record.thread,
            status: { type: "active", activeFlags: [] },
            turns: sortTurnsById([...record.thread.turns, response.turn]),
            updatedAt: Math.floor(Date.now() / 1000),
          },
        }));
      });

      return;
    }

    const optimisticInputs = toTurnInputs(
      args.prompt,
      [...args.mentions, ...toOptimisticFileMentions(thread.cwd, args.files)],
      args.skills,
      args.images.map((image) => image.url),
    );
    const optimisticUserMessage: Extract<ThreadItem, { type: "userMessage" }> = {
      type: "userMessage",
      id: `${OPTIMISTIC_USER_MESSAGE_PREFIX}${args.threadId}:${Date.now().toString(36)}`,
      content: optimisticInputs,
    };
    const optimisticTurnId = `${OPTIMISTIC_TURN_PREFIX}${args.threadId}:${Date.now().toString(36)}`;

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, args.threadId, (record) => ({
        ...record,
        thread: {
          ...record.thread,
          preview: args.prompt.trim() || record.thread.preview,
          status: { type: "active", activeFlags: [] },
          turns: sortTurnsById([
            ...stripOptimisticTurns(record.thread.turns),
            {
              id: optimisticTurnId,
              items: [optimisticUserMessage],
              status: "inProgress",
              error: null,
            },
          ]),
          updatedAt: Math.floor(Date.now() / 1000),
        },
      }));
    });

    try {
      const uploadedFileMentions = await this.uploadFiles(thread.cwd, args.files);
      const uploadedImages = await this.uploadImages(thread.cwd, args.images);
      const combinedMentions = [...args.mentions, ...uploadedFileMentions];
      const inputs = toTurnInputs(
        args.prompt,
        combinedMentions,
        args.skills,
        uploadedImages,
      );
      const response = await this.request<TurnStartResponse>("turn/start", {
        threadId: args.threadId,
        input: inputs,
        model: args.settings.model,
        approvalPolicy: args.settings.approvalPolicy,
        effort: args.settings.reasoningEffort,
        sandboxPolicy:
          args.settings.sandboxMode === "danger-full-access"
            ? { type: "dangerFullAccess" }
            : args.settings.sandboxMode === "read-only"
              ? {
                  type: "readOnly",
                  access: {
                    type: "restricted",
                    includePlatformDefaults: true,
                    readableRoots: [thread.cwd],
                  },
                  networkAccess: false,
                }
              : {
                  type: "workspaceWrite",
                  writableRoots: [thread.cwd],
                  readOnlyAccess: {
                    type: "restricted",
                    includePlatformDefaults: true,
                    readableRoots: [thread.cwd],
                  },
                  networkAccess: false,
                  excludeTmpdirEnvVar: false,
                  excludeSlashTmp: false,
                },
        personality: args.settings.personality === "none" ? null : args.settings.personality,
        collaborationMode: settingsToCollaborationMode(args.settings),
      });

      this.mutate((snapshot) => {
        updateThreadRecord(snapshot, args.threadId, (record) => {
          const baseTurns = stripOptimisticTurns(record.thread.turns);
          const existingTurn = baseTurns.find((turn) => turn.id === response.turn.id);
          const mergedTurn = mergeIncomingTurn(response.turn, existingTurn);
          const nextTurnItems = mergedTurn.items.some((item) => item.type === "userMessage")
            ? mergedTurn.items
            : [optimisticUserMessage, ...mergedTurn.items];
          const nextTurn = {
            ...mergedTurn,
            items: nextTurnItems,
          };

          return {
            ...record,
            thread: {
              ...record.thread,
              preview: args.prompt.trim() || record.thread.preview,
              status: { type: "active", activeFlags: [] },
              turns: sortTurnsById([
                ...baseTurns.filter((turn) => turn.id !== response.turn.id),
                nextTurn,
              ]),
              updatedAt: Math.floor(Date.now() / 1000),
            },
          };
        });
      });
    } catch (error) {
      this.mutate((snapshot) => {
        updateThreadRecord(snapshot, args.threadId, (record) => ({
          ...record,
          thread: {
            ...record.thread,
            status: { type: "idle" },
            turns: record.thread.turns.filter((turn) => turn.id !== optimisticTurnId),
            updatedAt: Math.floor(Date.now() / 1000),
          },
        }));
      });
      throw error;
    }
  }

  async interruptTurn(threadId: string) {
    const record = this.snapshot.threads.find((entry) => entry.thread.id === threadId);
    const activeTurn = [...(record?.thread.turns ?? [])].reverse().find((turn) => turn.status === "inProgress");
    if (!record || !activeTurn) {
      return false;
    }

    this.mutate((snapshot) => {
      activeTurn.items.forEach((item) => stopStreamsForItem(snapshot, item.id));

      updateThreadRecord(snapshot, threadId, (current) => ({
        ...current,
        thread: {
          ...current.thread,
          status: { type: "idle" },
          turns: current.thread.turns.map((turn) =>
            turn.id === activeTurn.id
              ? {
                  ...turn,
                  status: "interrupted",
                }
              : turn,
          ),
        },
      }));
    });

    try {
      await this.request<TurnInterruptResponse>("turn/interrupt", {
        threadId,
        turnId: activeTurn.id,
      });

      return true;
    } catch {
      await this.resumeThread(threadId, true).catch(() => undefined);
      return false;
    }
  }

  async applySteer(args: {
    threadId: string;
    prompt: string;
    mentions: Array<MentionAttachment>;
    skills: Array<SkillCard>;
    files: Array<ComposerFile>;
    images: Array<ComposerImage>;
  }) {
    const record = this.snapshot.threads.find((entry) => entry.thread.id === args.threadId);
    const activeTurn = [...(record?.thread.turns ?? [])].reverse().find((turn) => turn.status === "inProgress");
    if (!record || !activeTurn) {
      return false;
    }

    const uploadedFileMentions = await this.uploadFiles(record.thread.cwd, args.files);
    const uploadedImages = await this.uploadImages(record.thread.cwd, args.images);
    const inputs = toTurnInputs(args.prompt, [...args.mentions, ...uploadedFileMentions], args.skills, uploadedImages);

    this.mutate((snapshot) => {
      activeTurn.items.forEach((item) => stopStreamsForItem(snapshot, item.id));
    });

    try {
      await this.request("turn/steer", {
        threadId: args.threadId,
        expectedTurnId: activeTurn.id,
        input: inputs,
      });

      return true;
    } catch {
      await this.resumeThread(args.threadId, true).catch(() => undefined);
      return false;
    }
  }

  async searchMentions(cwd: string, query: string) {
    const response = await this.request<{ files: Array<FuzzyFileSearchResult> }>("fuzzyFileSearch", {
      query: query.trim() || "src",
      roots: [cwd],
      cancellationToken: null,
    });

    this.mutate((snapshot) => {
      snapshot.mentionCatalog = response.files
        .filter((match) => !match.path.includes("node_modules/"))
        .slice(0, 24)
        .map(mapMention);
    });
  }

  async loadDirectory(cwd: string) {
    const response = await this.request<FsReadDirectoryResponse>("fs/readDirectory", {
      path: cwd,
    });

    this.mutate((snapshot) => {
      snapshot.directoryCatalogRoot = cwd;
      snapshot.directoryCatalog = sortMentionAttachments(
        response.entries
          .map((entry) => mapDirectoryEntry(cwd, entry))
          .filter((entry): entry is MentionAttachment => Boolean(entry)),
      );
    });
  }

  async readFile(path: string) {
    const response = await this.request<FsReadFileResponse>("fs/readFile", {
      path,
    });

    return base64ToText(response.dataBase64);
  }

  async updateSettings(patch: Partial<SettingsState>) {
    this.mutate((snapshot) => {
      snapshot.settings = {
        ...snapshot.settings,
        ...patch,
      };
      snapshot.lastSavedAt = relativeNow();
    });

    const edits = settingEditsFromPatch(patch);
    if (edits.length === 0) {
      return;
    }

    await this.request("config/batchWrite", {
      edits: edits.map((edit) => ({
        keyPath: edit.keyPath,
        value: edit.value,
        mergeStrategy: "replace",
      })),
      reloadUserConfig: true,
    });
  }

  async toggleFeatureFlag(name: string) {
    const flag = this.snapshot.featureFlags.find((entry) => entry.name === name);
    if (!flag) {
      return;
    }

    await this.request("config/value/write", {
      keyPath: `features.${name}`,
      value: !flag.enabled,
      mergeStrategy: "replace",
    });

    this.mutate((snapshot) => {
      snapshot.featureFlags = snapshot.featureFlags.map((entry) =>
        entry.name === name
          ? {
              ...entry,
              enabled: !entry.enabled,
            }
          : entry,
      );
      snapshot.lastSavedAt = relativeNow();
    });
  }

  async toggleInstalledSkill(skillId: string) {
    const skill = this.snapshot.installedSkills.find((entry) => entry.id === skillId);
    if (!skill) {
      return;
    }

    const response = await this.request<{ effectiveEnabled: boolean }>("skills/config/write", {
      path: skill.path,
      enabled: !skill.enabled,
    });

    this.mutate((snapshot) => {
      snapshot.installedSkills = snapshot.installedSkills.map((entry) =>
        entry.id === skillId
          ? {
              ...entry,
              enabled: response.effectiveEnabled,
            }
          : entry,
      );
    });
  }

  async installSkill(skillId: string) {
    await this.request("skills/remote/export", {
      hazelnutId: skillId,
    });

    const [skillsResponse, remoteResponse] = await Promise.allSettled([
      this.request<SkillsListResponse>("skills/list", {}),
      this.request<SkillsRemoteReadResponse>("skills/remote/list", {
        hazelnutScope: "personal",
        productSurface: "codex",
        enabled: true,
      }),
    ]);

    this.mutate((snapshot) => {
      if (skillsResponse.status === "fulfilled") {
        snapshot.installedSkills = skillsResponse.value.data.flatMap((entry) => entry.skills.map(toSkillCard));
      }

      if (remoteResponse.status === "fulfilled") {
        snapshot.remoteSkills = remoteResponse.value.data.map(toRemoteSkillCard);
        snapshot.remoteSkillsError = null;
      }
    });
  }

  async toggleMcpAuth(serverName: string) {
    const server = this.snapshot.mcpServers.find((entry) => entry.name === serverName);
    if (!server) {
      return;
    }

    if (server.authStatus === "notLoggedIn") {
      await this.request("mcpServer/oauth/login", {
        name: serverName,
      });
      return;
    }

    const refreshed = await this.request<ListMcpServerStatusResponse>("mcpServerStatus/list", {});
    this.mutate((snapshot) => {
      snapshot.mcpServers = refreshed.data;
    });
  }

  async startChatGptLogin() {
    const response = await this.request<LoginAccountResponse>("account/login/start", {
      type: "chatgpt",
    });

    if (response.type === "chatgpt") {
      this.mutate((snapshot) => {
        snapshot.account.loginInProgress = true;
        snapshot.account.pendingLoginId = response.loginId;
        snapshot.account.loginError = null;
      });
      return response.authUrl;
    }

    await this.refreshAccount();
    return null;
  }

  async loginWithApiKey(apiKey: string) {
    await this.request<LoginAccountResponse>("account/login/start", {
      type: "apiKey",
      apiKey,
    });

    this.mutate((snapshot) => {
      snapshot.account.loginInProgress = false;
      snapshot.account.pendingLoginId = null;
      snapshot.account.loginError = null;
    });

    await this.refreshAccount();
  }

  async logoutAccount() {
    await this.request("account/logout", undefined);

    this.mutate((snapshot) => {
      snapshot.account = {
        ...snapshot.account,
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

    await this.refreshAccount();
  }

  async cleanTerminals(threadId: string) {
    await this.request("thread/backgroundTerminals/clean", { threadId });

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, threadId, (record) => ({
        ...record,
        terminals: record.terminals.filter((terminal) => terminal.status === "running"),
      }));
    });
  }

  async resolveApproval(requestId: string, approved: boolean) {
    const request = this.approvalMap.get(requestId);
    if (!request) {
      return;
    }

    if (request.method === "item/commandExecution/requestApproval") {
      this.respond(request.requestId, {
        decision: approved ? "accept" : "decline",
      });
    }

    if (request.method === "item/fileChange/requestApproval") {
      this.respond(request.requestId, {
        decision: approved ? "accept" : "decline",
      });
    }

    if (request.method === "item/permissions/requestApproval") {
      this.respond(request.requestId, {
        permissions: approved ? (request.params.permissions ?? {}) : {},
        scope: "turn",
      });
    }

    this.mutate((snapshot) => {
      const record = snapshot.threads.find((entry) => entry.thread.id === safeString(request.params.threadId));
      if (!record) {
        return;
      }

      record.approvals = record.approvals.map((approval) =>
        approval.id === requestId
          ? {
              ...approval,
              state: approved ? "approved" : "declined",
            }
          : approval,
      );
    });
  }

  async submitQuestion(requestId: string, answers: string[]) {
    const request = this.approvalMap.get(requestId);
    if (!request) {
      return;
    }

    this.respond(request.requestId, {
      answers,
    });

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, safeString(request.params.threadId), (record) => ({
        ...record,
        approvals: record.approvals.map((approval) =>
          approval.id === requestId
            ? {
                ...approval,
                state: "submitted",
              }
            : approval,
        ),
      }));
    });
  }

  async submitMcp(requestId: string, action: "accept" | "decline" | "cancel", contentText: string) {
    const request = this.approvalMap.get(requestId);
    if (!request) {
      return;
    }

    let content: unknown = null;
    if (action === "accept" && contentText.trim()) {
      try {
        content = JSON.parse(contentText);
      } catch {
        content = contentText;
      }
    }

    this.respond(request.requestId, {
      action,
      content,
      _meta: null,
    });

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, safeString(request.params.threadId), (record) => ({
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
  }

  private buildApproval(requestId: string, method: string, params: Record<string, unknown>): ApprovalRequest | null {
    if (method === "item/commandExecution/requestApproval") {
      const commandParams = params as unknown as CommandExecutionRequestApprovalParams;
      return {
        id: requestId,
        kind: "command",
        title: "Approve command execution",
        detail: commandParams.reason ?? "Codex is requesting permission to run a command.",
        risk: "medium",
        state: "pending",
        threadId: commandParams.threadId,
        turnId: commandParams.turnId,
        itemId: commandParams.itemId,
        method,
        command: commandParams.command ?? undefined,
        availableDecisions: toArray(commandParams.availableDecisions).map((entry) =>
          typeof entry === "string" ? entry : Object.keys(entry)[0],
        ),
      };
    }

    if (method === "item/fileChange/requestApproval") {
      const fileParams = params as unknown as FileChangeRequestApprovalParams;
      return {
        id: requestId,
        kind: "patch",
        title: "Approve file changes",
        detail: fileParams.reason ?? "Codex is requesting write access for file updates.",
        risk: fileParams.grantRoot ? "high" : "medium",
        state: "pending",
        threadId: fileParams.threadId,
        turnId: fileParams.turnId,
        itemId: fileParams.itemId,
        method,
        files: fileParams.grantRoot ? [fileParams.grantRoot] : undefined,
      };
    }

    if (method === "item/tool/requestUserInput") {
      return {
        id: requestId,
        kind: "question",
        title: "User input requested",
        detail: "A tool requested structured user input.",
        risk: "low",
        state: "pending",
        threadId: safeString(params.threadId),
        turnId: params.turnId ? safeString(params.turnId) : null,
        itemId: params.itemId ? safeString(params.itemId) : null,
        method,
        questions: Array.isArray(params.questions)
          ? params.questions.map((question) => {
              const questionRecord = question as Record<string, unknown>;
              return {
                id: safeString(questionRecord.id),
                header: safeString(questionRecord.header),
                question: safeString(questionRecord.question),
                isSecret: Boolean(questionRecord.isSecret),
                isOther: Boolean(questionRecord.isOther),
                options: Array.isArray(questionRecord.options)
                  ? questionRecord.options.map((option) => ({
                      label: safeString((option as Record<string, unknown>).label),
                      description: safeString((option as Record<string, unknown>).description),
                    }))
                  : [],
              };
            })
          : [],
      };
    }

    if (method === "mcpServer/elicitation/request") {
      return {
        id: requestId,
        kind: "mcp",
        title: "MCP elicitation",
        detail: safeString(params.message, "An MCP server needs client input."),
        risk: "medium",
        state: "pending",
        threadId: safeString(params.threadId),
        turnId: params.turnId ? safeString(params.turnId) : null,
        method,
        serverName: safeString(params.serverName),
        form:
          safeString(params.mode) === "url"
            ? safeString(params.url)
            : JSON.stringify((params.requestedSchema as Record<string, unknown>) ?? {}, null, 2),
      };
    }

    if (method === "item/permissions/requestApproval") {
      return {
        id: requestId,
        kind: "permissions",
        title: "Approve additional permissions",
        detail: safeString(params.reason, "Codex requested additional permissions."),
        risk: "high",
        state: "pending",
        threadId: safeString(params.threadId),
        turnId: safeString(params.turnId),
        itemId: safeString(params.itemId),
        method,
      };
    }

    return null;
  }

  private handleServerRequest(requestId: string, method: string, params: Record<string, unknown>) {
    const approval = this.buildApproval(requestId, method, params);
    if (!approval || !approval.threadId) {
      return;
    }

    this.approvalMap.set(approval.id, { requestId, method, params });

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, approval.threadId!, (record) => ({
        ...record,
        approvals: [approval, ...record.approvals.filter((entry) => entry.id !== approval.id)],
        thread: {
          ...record.thread,
          status: { type: "active", activeFlags: ["waitingOnApproval"] },
        },
      }));
    });
  }

  private handleNotification(method: string, params: Record<string, unknown>) {
    switch (method) {
      case "thread/started": {
        const thread = params.thread as Thread;
        this.mutate((snapshot) => {
          upsertThreadRecord(snapshot, mergeThread(thread, snapshot.threads.find((entry) => entry.thread.id === thread.id)));
        });
        return;
      }

      case "thread/name/updated": {
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => ({
            ...record,
            thread: {
              ...record.thread,
              name: params.threadName ? safeString(params.threadName) : record.thread.name,
            },
          }));
        });
        return;
      }

      case "thread/status/changed": {
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => ({
            ...record,
            thread: {
              ...record.thread,
              status: params.status as Thread["status"],
            },
          }));
        });
        return;
      }

      case "turn/started": {
        const turn = params.turn as Turn;
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => {
            const baseTurns = stripOptimisticTurns(record.thread.turns);
            const existingTurn = baseTurns.find((entry) => entry.id === turn.id);
            const nextTurn = mergeIncomingTurn(turn, existingTurn);

            return {
              ...record,
              thread: {
                ...record.thread,
                turns: sortTurnsById([...baseTurns.filter((entry) => entry.id !== turn.id), nextTurn]),
                updatedAt: Math.floor(Date.now() / 1000),
              },
            };
          });
        });
        return;
      }

      case "turn/completed": {
        const turn = params.turn as Turn;
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => {
            const turns = stripOptimisticTurns(record.thread.turns).map((entry) =>
              entry.id === turn.id ? mergeIncomingTurn(turn, entry) : entry,
            );
            return {
              ...record,
              thread: {
                ...record.thread,
                turns: sortTurnsById(turns),
                updatedAt: Math.floor(Date.now() / 1000),
              },
              review: parseReviewFindings({ ...record.thread, turns: sortTurnsById(turns) }),
            };
          });
        });
        return;
      }

      case "error": {
        const threadId = safeString(params.threadId);
        const turnId = safeString(params.turnId);
        const willRetry = Boolean(params.willRetry);
        const errorRecord = params.error as Record<string, unknown> | null | undefined;
        const error: TurnError | null =
          errorRecord && typeof errorRecord === "object"
            ? {
                message: safeString(errorRecord.message),
                codexErrorInfo: (errorRecord.codexErrorInfo ?? null) as TurnError["codexErrorInfo"],
                additionalDetails:
                  typeof errorRecord.additionalDetails === "string" ? safeString(errorRecord.additionalDetails) : null,
              }
            : null;

        if (!threadId || !turnId || !error?.message) {
          return;
        }

        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, threadId, (record) => {
            const turns = ensureTurnExists(record.thread.turns, turnId).map((turn) =>
              turn.id === turnId
                ? {
                    ...turn,
                    status: willRetry ? turn.status : "failed",
                    error,
                  }
                : turn,
            );

            return {
              ...record,
              thread: {
                ...record.thread,
                turns,
                updatedAt: Math.floor(Date.now() / 1000),
              },
            };
          });
        });
        return;
      }

      case "turn/plan/updated": {
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => ({
            ...record,
            plan: {
              explanation: safeString(params.explanation, record.plan?.explanation ?? "Plan updated."),
              steps: Array.isArray(params.plan)
                ? params.plan.map((step) => {
                    const stepRecord = step as Record<string, unknown>;
                    return {
                      step: safeString(stepRecord.step),
                      status: stepRecord.status as ThreadPlan["steps"][number]["status"],
                    };
                  })
                : record.plan?.steps ?? [],
            },
          }));
        });
        return;
      }

      case "thread/tokenUsage/updated": {
        this.mutate((snapshot) => {
          const tokenUsage = params.tokenUsage as {
            total: {
              inputTokens: number;
              outputTokens: number;
              cachedInputTokens: number;
            };
          };

          updateThreadRecord(snapshot, safeString(params.threadId), (record) => ({
            ...record,
            tokenUsage: {
              input: tokenUsage.total.inputTokens,
              output: tokenUsage.total.outputTokens,
              cached: tokenUsage.total.cachedInputTokens,
            },
          }));
        });
        return;
      }

      case "model/rerouted": {
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => ({
            ...record,
            reroutes: [
              {
                id: `${safeString(params.turnId)}:${safeString(params.fromModel)}:${safeString(params.toModel)}`,
                from: safeString(params.fromModel),
                to: safeString(params.toModel),
                reason: typeof params.reason === "string" ? params.reason : "model rerouted",
                at: relativeNow(),
              },
              ...record.reroutes,
            ],
          }));
        });
        return;
      }

      case "item/started":
      case "item/completed": {
        const item = params.item as ThreadItem;
        const live = method === "item/started";
        const threadId = safeString(params.threadId);
        const turnId = safeString(params.turnId);

        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, threadId, (record) => {
            const turns = ensureTurnExists(
              stripOptimisticTurns(record.thread.turns),
              turnId,
              live ? "inProgress" : "completed",
            ).map((turn) => {
              if (turn.id !== turnId) {
                return turn;
              }

              let items = [...turn.items];
              if (item.type === "userMessage") {
                for (let index = items.length - 1; index >= 0; index -= 1) {
                  if (isOptimisticUserMessage(items[index])) {
                    items.splice(index, 1);
                  }
                }
              }

              let nextItem = item;
              if (item.type === "fileChange") {
                const preview = items.find(
                  (entry): entry is Extract<ThreadItem, { type: "fileChange" }> => isLiveFileChangePreview(entry),
                );
                items = items.filter((entry) => !isLiveFileChangePreview(entry));
                if (item.changes.length === 0 && preview?.changes.length) {
                  nextItem = {
                    ...item,
                    changes: preview.changes,
                  };
                }
              }

              const itemIndex = items.findIndex((entry) => entry.id === nextItem.id);
              if (itemIndex === -1) {
                items.push(nextItem);
              } else {
                nextItem = mergeIncomingItem(nextItem, items[itemIndex]);
                items[itemIndex] = nextItem;
              }

              return {
                ...turn,
                items,
              };
            });

            if (item.type === "agentMessage") {
              ensureStream(snapshot, threadId, turnId, item.id, "text", item.text, live);
            }

            if (item.type === "commandExecution") {
              ensureStream(
                snapshot,
                threadId,
                turnId,
                item.id,
                "aggregatedOutput",
                item.aggregatedOutput ?? "",
                live,
              );
            }

            if (!live) {
              stopStreamsForItem(snapshot, item.id);
            }

            return {
              ...record,
              thread: {
                ...record.thread,
                turns,
                updatedAt: Math.floor(Date.now() / 1000),
              },
              terminals: buildTerminalsFromTurns({
                ...record.thread,
                turns,
              }),
              review: parseReviewFindings({
                ...record.thread,
                turns,
              }),
            };
          });
        });
        return;
      }

      case "item/agentMessage/delta": {
        const threadId = safeString(params.threadId);
        const turnId = safeString(params.turnId);
        const itemId = safeString(params.itemId);

        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, threadId, (record) => {
            const turns = ensureTurnExists(stripOptimisticTurns(record.thread.turns), turnId).map((turn) => {
              if (turn.id !== turnId) {
                return turn;
              }

              const hasItem = turn.items.some((item) => item.id === itemId && item.type === "agentMessage");
              const baseItems = hasItem
                ? turn.items
                : [
                    ...turn.items,
                    {
                      type: "agentMessage",
                      id: itemId,
                      text: "",
                      phase: null,
                    } satisfies Extract<ThreadItem, { type: "agentMessage" }>,
                  ];

              const items = baseItems.map((item) =>
                item.id === itemId && item.type === "agentMessage"
                  ? {
                      ...item,
                      text: item.text + safeString(params.delta),
                    }
                  : item,
              );

              const agentMessage = items.find(
                (item): item is Extract<ThreadItem, { type: "agentMessage" }> =>
                  item.id === itemId && item.type === "agentMessage",
              );

              if (agentMessage) {
                ensureStream(snapshot, threadId, turnId, agentMessage.id, "text", agentMessage.text, true);
              }

              return {
                ...turn,
                items,
              };
            });

            return {
              ...record,
              thread: {
                ...record.thread,
                turns,
                updatedAt: Math.floor(Date.now() / 1000),
              },
            };
          });
        });
        return;
      }

      case "item/commandExecution/outputDelta": {
        const threadId = safeString(params.threadId);
        const turnId = safeString(params.turnId);
        const itemId = safeString(params.itemId);
        const processId = typeof params.processId === "string" ? params.processId : null;
        const delta = safeString(params.delta);

        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, threadId, (record) => {
            const turns = ensureTurnExists(record.thread.turns, turnId).map((turn) => {
              if (turn.id !== turnId) {
                return turn;
              }

              const hasItem = turn.items.some((item) => item.id === itemId && item.type === "commandExecution");
              const baseItems = hasItem
                ? turn.items
                : [
                    ...turn.items,
                    {
                      type: "commandExecution",
                      id: itemId,
                      command: safeString(params.command),
                      cwd: safeString(params.cwd, record.thread.cwd),
                      processId,
                      status: "inProgress",
                      commandActions: [],
                      aggregatedOutput: "",
                      exitCode: null,
                      durationMs: null,
                    } satisfies Extract<ThreadItem, { type: "commandExecution" }>,
                  ];

              const items = baseItems.map((item) =>
                item.id === itemId && item.type === "commandExecution"
                  ? {
                      ...item,
                      processId: item.processId ?? processId,
                      aggregatedOutput: `${item.aggregatedOutput ?? ""}${delta}`,
                    }
                  : item,
              );

              const commandItem = items.find(
                (item): item is Extract<ThreadItem, { type: "commandExecution" }> =>
                  item.id === itemId && item.type === "commandExecution",
              );

              if (commandItem) {
                ensureStream(
                  snapshot,
                  threadId,
                  turnId,
                  commandItem.id,
                  "aggregatedOutput",
                  commandItem.aggregatedOutput ?? "",
                  true,
                );
              }

              return {
                ...turn,
                items,
              };
            });

            const nextThread = {
              ...record.thread,
              turns,
              updatedAt: Math.floor(Date.now() / 1000),
            };

            return {
              ...record,
              thread: nextThread,
              terminals: buildTerminalsFromTurns(nextThread),
            };
          });
        });
        return;
      }

      case "item/fileChange/outputDelta": {
        const threadId = safeString(params.threadId);
        const turnId = safeString(params.turnId);
        const itemId = safeString(params.itemId);
        const delta = safeString(params.delta);

        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, threadId, (record) => {
            const turns = ensureTurnExists(record.thread.turns, turnId).map((turn) => {
              if (turn.id !== turnId) {
                return turn;
              }

              const existingFileChange = turn.items.find(
                (item): item is Extract<ThreadItem, { type: "fileChange" }> => item.id === itemId && item.type === "fileChange",
              );

              const items = existingFileChange
                ? turn.items.map((item) =>
                    item.id === itemId && item.type === "fileChange"
                      ? appendFileChangeDelta(item, delta)
                      : item,
                  )
                : [
                    ...turn.items.filter((item) => !isLiveFileChangePreview(item)),
                    createFileChangeItem(itemId, [createEditingDiffChange(delta)]),
                  ];

              return {
                ...turn,
                items,
              };
            });

            const nextThread = {
              ...record.thread,
              turns,
              updatedAt: Math.floor(Date.now() / 1000),
            };

            return {
              ...record,
              thread: nextThread,
              review: parseReviewFindings(nextThread),
            };
          });
        });
        return;
      }

      case "turn/diff/updated": {
        const threadId = safeString(params.threadId);
        const turnId = safeString(params.turnId);
        const diff = safeString(params.diff);

        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, threadId, (record) => {
            const turns = ensureTurnExists(record.thread.turns, turnId).map((turn) => {
              if (turn.id !== turnId) {
                return turn;
              }

              const hasRealFileChange = turn.items.some((item) => item.type === "fileChange" && !isLiveFileChangePreview(item));
              return {
                ...turn,
                items: hasRealFileChange ? turn.items : upsertLiveFileChangePreview(turn.items, turnId, diff),
              };
            });

            const nextThread = {
              ...record.thread,
              turns,
              updatedAt: Math.floor(Date.now() / 1000),
            };

            return {
              ...record,
              thread: nextThread,
              review: parseReviewFindings(nextThread),
            };
          });
        });
        return;
      }

      case "item/plan/delta": {
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => ({
            ...record,
            plan: record.plan
              ? {
                  ...record.plan,
                  explanation: `${record.plan.explanation}${safeString(params.delta)}`,
                }
              : {
                  explanation: safeString(params.delta),
                  steps: [],
                },
          }));
        });
        return;
      }

      case "item/reasoning/summaryPartAdded": {
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => ({
            ...record,
            thread: {
              ...record.thread,
              turns: record.thread.turns.map((turn) =>
                turn.id !== safeString(params.turnId)
                  ? turn
                  : {
                      ...turn,
                      items: turn.items.map((item) =>
                        item.id !== safeString(params.itemId) || item.type !== "reasoning"
                          ? item
                          : {
                              ...item,
                              summary: item.summary.length > Number(params.summaryIndex)
                                ? item.summary
                                : [...item.summary, ""],
                            },
                      ),
                    },
              ),
            },
          }));
        });
        return;
      }

      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const indexKey = method === "item/reasoning/summaryTextDelta" ? "summaryIndex" : "contentIndex";
        const targetKey = method === "item/reasoning/summaryTextDelta" ? "summary" : "content";

        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => ({
            ...record,
            thread: {
              ...record.thread,
              turns: record.thread.turns.map((turn) =>
                turn.id !== safeString(params.turnId)
                  ? turn
                  : {
                      ...turn,
                      items: turn.items.map((item) => {
                        if (item.id !== safeString(params.itemId) || item.type !== "reasoning") {
                          return item;
                        }

                        const index = Number(params[indexKey] ?? 0);
                        const next = [...item[targetKey]];
                        while (next.length <= index) {
                          next.push("");
                        }
                        next[index] = `${next[index]}${safeString(params.delta)}`;

                        return {
                          ...item,
                          [targetKey]: next,
                        };
                      }),
                    },
              ),
            },
          }));
        });
        return;
      }

      case "serverRequest/resolved": {
        const requestId = safeString(params.requestId);
        this.approvalMap.delete(requestId);
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => ({
            ...record,
            approvals: record.approvals.filter((approval) => approval.id !== requestId),
          }));
        });
        return;
      }

      case "skills/changed": {
        void this.refreshSkills();
        return;
      }

      case "mcpServer/oauthLogin/completed": {
        void this.refreshMcpServers();
        return;
      }

      case "account/updated": {
        void this.refreshAccount();
        return;
      }

      case "account/login/completed": {
        const success = Boolean(params.success);
        const loginId = typeof params.loginId === "string" ? params.loginId : null;
        const error = typeof params.error === "string" ? params.error : null;

        this.mutate((snapshot) => {
          if (!snapshot.account.pendingLoginId || !loginId || snapshot.account.pendingLoginId === loginId) {
            snapshot.account.loginInProgress = false;
            snapshot.account.pendingLoginId = null;
            snapshot.account.loginError = success ? null : error;
          }
        });

        if (success) {
          void this.refreshAccount();
        }
        return;
      }

      case "account/rateLimits/updated": {
        this.mutate((snapshot) => {
          snapshot.account = applyRateLimitSnapshot(snapshot.account, params.rateLimits as RateLimitSnapshot);
        });
        return;
      }

      case "thread/compacted": {
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => ({
            ...record,
            thread: {
              ...record.thread,
              turns: record.thread.turns.map((turn) =>
                turn.id !== safeString(params.turnId)
                  ? turn
                  : {
                      ...turn,
                      items: turn.items.some((item) => item.type === "contextCompaction")
                        ? turn.items
                        : [...turn.items, { type: "contextCompaction", id: `compact-${turn.id}` }],
                    },
              ),
            },
          }));
        });
      }
    }
  }

  private async refreshSkills() {
    const response = await this.request<SkillsListResponse>("skills/list", {});
    this.mutate((snapshot) => {
      snapshot.installedSkills = response.data.flatMap((entry) => entry.skills.map(toSkillCard));
    });
  }

  private async refreshMcpServers() {
    const response = await this.request<ListMcpServerStatusResponse>("mcpServerStatus/list", {});
    this.mutate((snapshot) => {
      snapshot.mcpServers = response.data;
    });
  }

  async refreshAccount() {
    const [account, rates] = await Promise.all([
      this.request<GetAccountResponse>("account/read", {}),
      this.request<GetAccountRateLimitsResponse>("account/rateLimits/read", {}),
    ]);

    this.mutate((snapshot) => {
      snapshot.account = toAccountState(account, rates, snapshot.account);
    });
  }
}
