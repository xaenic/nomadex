import type { Personality } from "../../../protocol/Personality";
import type { FuzzyFileSearchResult } from "../../../protocol/FuzzyFileSearchResult";
import type { CollaborationMode } from "../../../protocol/CollaborationMode";
import type { RequestId } from "../../../protocol/RequestId";
import type {
  AdditionalPermissionProfile,
  CollaborationModeListResponse,
  CommandExecResponse,
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
  ThreadRollbackResponse,
  ThreadResumeResponse,
  ThreadStartResponse,
  Turn,
  TurnError,
  TurnInterruptResponse,
  TurnStartResponse,
  UserInput,
} from "../../../protocol/v2";
import {
  createBlankThreadRecord,
  createFallbackDashboardData,
  createProviderAuthMap,
  createProviderSetupMap,
  type ApprovalDecision,
  type ApprovalRequest,
  type CollaborationPreset,
  type ComposerFile,
  type ComposerImage,
  type DashboardData,
  type FeatureFlag as UiFeatureFlag,
  type MentionAttachment,
  type ProviderAuthFlow,
  type ProviderAuthState,
  type ProviderSetupState,
  type RemoteSkillCard,
  type SettingsState,
  type SkillCard,
  type SteerHistoryEntry,
  type TerminalSession,
  type ThreadPlan,
  type ThreadRecord,
  type WorkspaceMode,
} from "../../mockData";
import {
  buildCommitGenerationPrompt,
  extractCommitMessageCandidate,
  normalizeWorkspaceProjectSettings,
  serializeWorkspaceProjectSettings,
  splitCommitMessageParagraphs,
  WORKSPACE_PROJECT_SETTINGS_RELATIVE_PATH,
  type CommitGenerationContext,
  type WorkspaceProjectSettings,
} from "../commitAssistant";
import {
  buildProviderFilesUploadRoot,
  buildProviderOptimisticFileUploadPath,
  buildProviderOptimisticUploadPath,
  buildProviderUploadRoot,
  getProviderAdapter,
  isProviderId,
  listProviderAdapters,
  persistProviderId,
  providerIsReady,
  type ProviderAdapter,
  type ProviderId,
} from "../providers";
import { getUserMessageDisplay } from "../presentation/workspacePresentationService";
import type { QuestionAnswerPayload } from "../../workspaceTypes";

type EventListener = (snapshot: DashboardData) => void;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

type RequestOptions = {
  timeoutMs?: number;
  timeoutError?: string;
  closeSocketOnTimeout?: boolean;
};

type ServerEnvelope = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

const inferProxyWsUrl = (adapter: ProviderAdapter) => {
  if (typeof window === "undefined") {
    return "ws://127.0.0.1:3901";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${adapter.wsProxyPath}`;
};

const resolveWsUrls = (adapter: ProviderAdapter) => {
  const urls: string[] = [];
  const addUrl = (value: string | undefined) => {
    if (!value || urls.includes(value)) {
      return;
    }

    urls.push(value);
  };

  if (typeof window === "undefined") {
    addUrl(import.meta.env.VITE_WORKSPACE_WS_URL || import.meta.env.VITE_CODEX_WS_URL);
    addUrl("ws://127.0.0.1:3901");
    return urls;
  }

  addUrl(import.meta.env.VITE_WORKSPACE_WS_URL || import.meta.env.VITE_CODEX_WS_URL);
  addUrl(inferProxyWsUrl(adapter));
  return urls;
};

const defaultWsUrlForProvider = (adapter: ProviderAdapter) =>
  resolveWsUrls(adapter)[0] ?? "ws://127.0.0.1:3901";

const providerUnavailableMessage = (adapter: ProviderAdapter) =>
  `${adapter.displayName} is scaffolded in Nomadex but its transport is not wired yet.`;

const THREAD_STEER_STORAGE_KEY = "nomadex-thread-steers";
const PENDING_QUESTION_ANSWERS_STORAGE_KEY = "nomadex-pending-question-answers";
const MAX_STEER_HISTORY_PER_THREAD = 24;

const LOCAL_PROVIDER_THREAD_PREFIX = "local-provider:";
const EXTERNAL_PROVIDER_AGENT_PREFIX = "external-agent:";
const SHARED_THREAD_MEMORY_TURN_LIMIT = 8;
const SHARED_THREAD_MEMORY_CHAR_LIMIT = 12_000;

const isLocalProviderThreadId = (threadId: string) =>
  threadId.startsWith(LOCAL_PROVIDER_THREAD_PREFIX);

const randomLocalProviderThreadId = (providerId: ProviderId) =>
  `${LOCAL_PROVIDER_THREAD_PREFIX}${providerId}:${Date.now().toString(36)}`;

const isHeadlessCliProvider = (providerId: ProviderId) =>
  providerId === "opencode" || providerId === "qwen-code";

const DEFAULT_STEER_SUGGESTIONS = [
  "Keep the answer terse and operational.",
  "Call out blockers before proposing polish.",
  "Prefer concrete file references over abstractions.",
];

const APPROVAL_OPTIONS: Array<SettingsState["approvalPolicy"]> = ["untrusted", "on-failure", "on-request", "never"];
const PERSONALITY_OPTIONS: Array<SettingsState["personality"]> = ["none", "friendly", "pragmatic"];

const toArray = <T>(value: Array<T> | null | undefined) => value ?? [];

const relativeNow = () => "just now";

const canUseWindowStorage = () =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const normalizeStoredQuestionAnswerPayload = (value: unknown): QuestionAnswerPayload | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entries = Object.entries(value as Record<string, unknown>).flatMap(([questionId, answerValue]) => {
    if (!answerValue || typeof answerValue !== "object") {
      return [];
    }

    const answers = Array.isArray((answerValue as Record<string, unknown>).answers)
      ? ((answerValue as Record<string, unknown>).answers as Array<unknown>)
          .map((entry) => safeString(entry))
          .filter(Boolean)
      : [];

    return questionId.trim() ? [[questionId, { answers }]] : [];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

const readStoredPendingQuestionAnswers = (): Record<string, QuestionAnswerPayload> => {
  if (!canUseWindowStorage()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PENDING_QUESTION_ANSWERS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([key, payload]) => {
        const normalized = normalizeStoredQuestionAnswerPayload(payload);
        return normalized ? [[key, normalized]] : [];
      }),
    );
  } catch {
    return {};
  }
};

const writeStoredPendingQuestionAnswers = (
  key: string,
  payload: QuestionAnswerPayload | null,
) => {
  if (!canUseWindowStorage()) {
    return;
  }

  try {
    const nextMap = readStoredPendingQuestionAnswers();
    if (!payload || Object.keys(payload).length === 0) {
      delete nextMap[key];
    } else {
      nextMap[key] = payload;
    }

    if (Object.keys(nextMap).length === 0) {
      window.localStorage.removeItem(PENDING_QUESTION_ANSWERS_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      PENDING_QUESTION_ANSWERS_STORAGE_KEY,
      JSON.stringify(nextMap),
    );
  } catch {
    // Ignore storage failures; the live in-memory submit path still runs.
  }
};

const buildPendingQuestionStorageKey = (
  threadId: string,
  turnId: string | null | undefined,
  itemId: string | null | undefined,
  requestId: string,
) => `${threadId}:${turnId || itemId || requestId}`;

const buildQuestionRequestSignature = (
  threadId: string,
  turnId: string | null | undefined,
  questions: Array<{
    id: string;
    header: string;
    question: string;
    isSecret: boolean;
    isOther: boolean;
    options: Array<{
      label: string;
      description: string;
    }>;
  }> | undefined,
) =>
  JSON.stringify({
    threadId,
    turnId: turnId || "",
    questions: (questions ?? []).map((question) => ({
      id: question.id,
      header: question.header,
      question: question.question,
      isSecret: question.isSecret,
      isOther: question.isOther,
      options: question.options.map((option) => ({
        label: option.label,
        description: option.description,
      })),
    })),
  });

const normalizeQuestionStorageQuestions = (
  value: unknown,
): Array<{
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  isOther: boolean;
  options: Array<{
    label: string;
    description: string;
  }>;
}> =>
  Array.isArray(value)
    ? value.map((question) => {
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
    : [];

const buildPendingQuestionStorageKeys = (args: {
  threadId: string;
  turnId?: string | null;
  itemId?: string | null;
  requestId: string;
  questions?: Array<{
    id: string;
    header: string;
    question: string;
    isSecret: boolean;
    isOther: boolean;
    options: Array<{
      label: string;
      description: string;
    }>;
  }>;
}) => {
  const keys = new Set<string>();
  const threadId = args.threadId.trim();
  if (!threadId) {
    return [];
  }

  const turnId = args.turnId?.trim() || null;
  const itemId = args.itemId?.trim() || null;
  const requestId = args.requestId.trim();

  if (turnId && args.questions && args.questions.length > 0) {
    keys.add(
      `${threadId}:signature:${buildQuestionRequestSignature(threadId, turnId, args.questions)}`,
    );
  }

  if (turnId && itemId) {
    keys.add(`${threadId}:turn-item:${turnId}:${itemId}`);
  }

  if (itemId) {
    keys.add(`${threadId}:item:${itemId}`);
  }

  if (turnId) {
    keys.add(`${threadId}:turn:${turnId}`);
  }

  keys.add(buildPendingQuestionStorageKey(threadId, turnId, itemId, requestId));

  return [...keys];
};

const readStoredPendingQuestionAnswerByKeys = (
  keys: Array<string>,
): QuestionAnswerPayload | null => {
  if (keys.length === 0) {
    return null;
  }

  const stored = readStoredPendingQuestionAnswers();
  for (const key of keys) {
    const payload = stored[key];
    if (payload && Object.keys(payload).length > 0) {
      return payload;
    }
  }

  return null;
};

const writeStoredPendingQuestionAnswersForKeys = (
  keys: Array<string>,
  payload: QuestionAnswerPayload | null,
) => {
  for (const key of [...new Set(keys)].filter(Boolean)) {
    writeStoredPendingQuestionAnswers(key, payload);
  }
};

const normalizeStoredSteerEntry = (entry: unknown): SteerHistoryEntry | null => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const turnId = typeof record.turnId === "string" ? record.turnId.trim() : "";
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  const createdAt =
    typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
      ? record.createdAt
      : Date.now();

  if (!id || !turnId || !prompt) {
    return null;
  }

  return {
    id,
    turnId,
    prompt,
    createdAt,
    status: "applied",
  };
};

const readStoredThreadSteerMap = (): Record<string, Array<SteerHistoryEntry>> => {
  if (!canUseWindowStorage()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(THREAD_STEER_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([threadId, entries]) => {
        if (!Array.isArray(entries)) {
          return [];
        }

        const normalized = entries
          .map(normalizeStoredSteerEntry)
          .filter((entry): entry is SteerHistoryEntry => Boolean(entry))
          .slice(0, MAX_STEER_HISTORY_PER_THREAD);

        return normalized.length > 0 ? [[threadId, normalized]] : [];
      }),
    );
  } catch {
    return {};
  }
};

const readStoredThreadSteers = (threadId: string): Array<SteerHistoryEntry> =>
  readStoredThreadSteerMap()[threadId] ?? [];

const writeStoredThreadSteers = (
  threadId: string,
  entries: Array<SteerHistoryEntry> | undefined,
) => {
  if (!canUseWindowStorage()) {
    return;
  }

  try {
    const nextMap = readStoredThreadSteerMap();
    const persistedEntries = (entries ?? [])
      .filter((entry) => entry.status === "applied")
      .slice(0, MAX_STEER_HISTORY_PER_THREAD)
      .map(({ id, turnId, prompt, createdAt }) => ({
        id,
        turnId,
        prompt,
        createdAt,
      }));

    if (persistedEntries.length === 0) {
      delete nextMap[threadId];
    } else {
      nextMap[threadId] = persistedEntries.map((entry) => ({
        ...entry,
        status: "applied",
      }));
    }

    window.localStorage.setItem(THREAD_STEER_STORAGE_KEY, JSON.stringify(nextMap));
  } catch {
    // Ignore client-side storage failures; steer still lives in memory for this session.
  }
};

const mergeSteerHistory = (
  ...lists: Array<Array<SteerHistoryEntry> | undefined>
): Array<SteerHistoryEntry> => {
  const byId = new Map<string, SteerHistoryEntry>();

  for (const list of lists) {
    for (const entry of list ?? []) {
      const existing = byId.get(entry.id);
      if (!existing) {
        byId.set(entry.id, entry);
        continue;
      }

      byId.set(entry.id, {
        ...existing,
        ...entry,
        status:
          entry.status === "applied" || existing.status === "applied"
            ? "applied"
            : "pending",
        createdAt: Math.max(existing.createdAt, entry.createdAt),
      });
    }
  }

  return [...byId.values()]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_STEER_HISTORY_PER_THREAD);
};

const buildSteerSummary = (args: {
  prompt: string;
  mentions: Array<MentionAttachment>;
  skills: Array<SkillCard>;
  files: Array<ComposerFile>;
  images: Array<ComposerImage>;
}) => {
  const prompt = args.prompt.trim().replace(/\s+/g, " ");
  if (prompt) {
    return prompt;
  }

  const parts: string[] = [];
  if (args.files.length > 0) {
    parts.push(`${args.files.length} file${args.files.length === 1 ? "" : "s"}`);
  }
  if (args.images.length > 0) {
    parts.push(`${args.images.length} image${args.images.length === 1 ? "" : "s"}`);
  }
  if (args.mentions.length > 0) {
    parts.push(`${args.mentions.length} mention${args.mentions.length === 1 ? "" : "s"}`);
  }
  if (args.skills.length > 0) {
    parts.push(`${args.skills.length} skill${args.skills.length === 1 ? "" : "s"}`);
  }

  return parts.length > 0 ? `Steer with ${parts.join(", ")}` : "Steer applied";
};

const createSteerEntry = (
  threadId: string,
  turnId: string,
  args: {
    prompt: string;
    mentions: Array<MentionAttachment>;
    skills: Array<SkillCard>;
    files: Array<ComposerFile>;
    images: Array<ComposerImage>;
  },
  status: SteerHistoryEntry["status"],
): SteerHistoryEntry => ({
  id: `steer:${threadId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  turnId,
  prompt: buildSteerSummary(args),
  createdAt: Date.now(),
  status,
});

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const safeString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const ESCAPE_CHAR = String.fromCharCode(27);
const ANSI_SGR_PATTERN = new RegExp(`${ESCAPE_CHAR}\\[[0-9;]*m`, "gu");
const stripAnsi = (value: string) => value.replace(ANSI_SGR_PATTERN, "");
const trimAuthBuffer = (value: string, maxLength = 12000) =>
  value.length > maxLength ? value.slice(-maxLength) : value;
const APPROVAL_DECISIONS: Array<ApprovalDecision> = [
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
];
const isApprovalDecision = (value: string): value is ApprovalDecision =>
  APPROVAL_DECISIONS.includes(value as ApprovalDecision);
const normalizeApprovalDecision = (value: unknown): ApprovalDecision | null => {
  if (typeof value === "string") {
    return isApprovalDecision(value) ? value : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const key = Object.keys(value)[0];
  return key && isApprovalDecision(key) ? key : null;
};
const normalizeApprovalDecisionList = (
  values: Array<unknown> | null | undefined,
  fallback: Array<ApprovalDecision>,
) => {
  const normalized = toArray(values)
    .map((value) => normalizeApprovalDecision(value))
    .filter((value): value is ApprovalDecision => Boolean(value));

  return [...new Set(normalized.length > 0 ? normalized : fallback)];
};
const commandArrayToString = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .join(" ")
        .trim()
    : "";
const summarizeAdditionalPermissions = (
  permissions: AdditionalPermissionProfile | null | undefined,
) => {
  const summary: string[] = [];

  if (permissions?.network?.enabled) {
    summary.push("Network access");
  }

  const readPaths = toArray(permissions?.fileSystem?.read).filter((entry): entry is string => typeof entry === "string");
  if (readPaths.length > 0) {
    summary.push(`Read access: ${readPaths.join(", ")}`);
  }

  const writePaths = toArray(permissions?.fileSystem?.write).filter((entry): entry is string => typeof entry === "string");
  if (writePaths.length > 0) {
    summary.push(`Write access: ${writePaths.join(", ")}`);
  }

  if (permissions?.macos?.accessibility) {
    summary.push("macOS accessibility access");
  }

  if (permissions?.macos?.calendar) {
    summary.push("macOS calendar access");
  }

  if (permissions?.macos?.contacts && permissions.macos.contacts !== "none") {
    summary.push(`macOS contacts: ${permissions.macos.contacts}`);
  }

  if (permissions?.macos?.launchServices) {
    summary.push("macOS launch services");
  }

  if (permissions?.macos?.preferences && permissions.macos.preferences !== "none") {
    summary.push(`macOS preferences: ${permissions.macos.preferences}`);
  }

  if (permissions?.macos?.reminders) {
    summary.push("macOS reminders access");
  }

  if (permissions?.macos?.automations === "all") {
    summary.push("macOS automation: all apps");
  } else if (
    permissions?.macos?.automations &&
    typeof permissions.macos.automations === "object" &&
    "bundle_ids" in permissions.macos.automations
  ) {
    const bundleIds = toArray(permissions.macos.automations.bundle_ids).filter(
      (entry): entry is string => typeof entry === "string",
    );
    if (bundleIds.length > 0) {
      summary.push(`macOS automation: ${bundleIds.join(", ")}`);
    }
  }

  return summary;
};
const approvalStateFromDecision = (decision: ApprovalDecision): ApprovalRequest["state"] =>
  decision === "accept" || decision === "acceptForSession" ? "approved" : "declined";
const legacyReviewDecisionFromApprovalDecision = (decision: ApprovalDecision) => {
  switch (decision) {
    case "accept":
      return "approved" as const;
    case "acceptForSession":
      return "approved_for_session" as const;
    case "cancel":
      return "abort" as const;
    case "decline":
    default:
      return "denied" as const;
  }
};
const parseAuthUrl = (value: string) => {
  const matches = value.match(/https:\/\/[^\s"'<>`|│)]+/gu);
  return matches?.at(-1) ?? null;
};

const cloneProviderSetupMap = (
  value: DashboardData["providerSetup"],
): DashboardData["providerSetup"] =>
  Object.fromEntries(
    Object.entries(value).map(([providerId, setup]) => [
      providerId,
      { ...setup },
    ]),
  ) as DashboardData["providerSetup"];

const cloneProviderAuthMap = (
  value: DashboardData["providerAuth"],
): DashboardData["providerAuth"] =>
  Object.fromEntries(
    Object.entries(value).map(([providerId, authState]) => [
      providerId,
      { ...authState },
    ]),
  ) as DashboardData["providerAuth"];

const parseProviderAuthProgress = (
  providerId: ProviderId,
  output: string,
): Partial<ProviderAuthState> => {
  if (providerId === "opencode") {
    const authUrl =
      output.match(/https:\/\/opencode\.ai\/auth[^\s"'<>`|│)]*/iu)?.[0] ??
      parseAuthUrl(output);
    const needsApiKey =
      /Create an api key at/iu.test(output) ||
      /Enter your API key/iu.test(output);

    return {
      status: authUrl || needsApiKey ? "waiting" : "starting",
      summary:
        authUrl || needsApiKey
          ? "Open OpenCode Zen auth, then paste the API key below."
          : "Preparing the OpenCode Zen sign-in…",
      detail:
        authUrl || needsApiKey
          ? "Keep this panel open. Nomadex will send the API key to the local OpenCode CLI and verify the Zen session automatically."
          : "Waiting for the local OpenCode CLI to request its Zen API key.",
      authUrl: authUrl ?? null,
      userCode: null,
    };
  }

  if (providerId === "qwen-code") {
    const authUrl =
      output.match(/https:\/\/chat\.qwen\.ai\/authorize\?[^\s"'<>`|│)]+/iu)?.[0] ??
      parseAuthUrl(output);
    const userCode =
      output.match(/[?&]user_code=([A-Z0-9-]+)/iu)?.[1] ??
      (() => {
        if (!authUrl) {
          return null;
        }

        try {
          return new URL(authUrl).searchParams.get("user_code");
        } catch {
          return null;
        }
      })();

    return {
      status: authUrl ? "waiting" : "starting",
      summary: authUrl
        ? "Open the Qwen authorization page to finish sign-in."
        : "Preparing the Qwen OAuth sign-in…",
      detail: authUrl
        ? "Keep this panel open. Nomadex will verify the local session automatically when the CLI completes."
        : "Waiting for the local Qwen CLI to publish its authorization URL.",
      authUrl: authUrl ?? null,
      userCode: userCode ?? null,
    };
  }

  return {
    status: "starting",
    summary: "Preparing provider sign-in…",
    detail: "Waiting for the local CLI sign-in flow to start.",
    authUrl: null,
    userCode: null,
  };
};

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

const isRuntimeFileNotFoundError = (error: unknown) => {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("enoent") || message.includes("not found");
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const normalizeRuntimePath = (value: string) => value.replace(/[\\/]+$/u, "");

const runtimePathSeparator = (value: string) =>
  value.includes("\\") && !value.includes("/") ? "\\" : "/";

const joinRuntimePath = (root: string, ...segments: string[]) => {
  const separator = runtimePathSeparator(root);
  const cleanedRoot = normalizeRuntimePath(root);
  const cleanedTail = segments
    .flatMap((segment) => segment.split(/[\\/]+/u))
    .filter(Boolean)
    .join(separator);

  return cleanedTail ? `${cleanedRoot}${separator}${cleanedTail}` : cleanedRoot;
};

const dirnameRuntimePath = (value: string) => {
  const trimmed = normalizeRuntimePath(value);
  const separator = runtimePathSeparator(trimmed);
  const index = trimmed.lastIndexOf(separator);
  if (index <= 0) {
    return trimmed;
  }

  return trimmed.slice(0, index);
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

const invalidBackendModelProviderFromError = (error: unknown) => {
  const message = getErrorMessage(error);
  const match = message.match(/model provider\s+[`'"]?([^`'"\n]+)[`'"]?\s+not found/i);
  if (!match?.[1]) {
    return null;
  }

  return isProviderId(match[1].trim()) ? match[1].trim() : null;
};

const toSettingsState = (config: Config, fallback: SettingsState): SettingsState => {
  const notice = "notice" in config && typeof config.notice === "object" && config.notice ? config.notice : null;
  const analytics =
    config.analytics && typeof config.analytics === "object" && "enabled" in config.analytics
      ? Boolean(config.analytics.enabled)
      : fallback.analytics;

  return {
    provider: fallback.provider,
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

const TERMINAL_ANSI_PATTERN = new RegExp(
  `${ESCAPE_CHAR}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  "g",
);

const normalizeTerminalText = (value: string) =>
  value
    .replace(TERMINAL_ANSI_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

const appendTerminalLog = (log: Array<string>, delta: string) => {
  const normalized = normalizeTerminalText(delta);
  if (!normalized) {
    return log;
  }

  const next = log.length > 0 ? [...log] : [""];
  const parts = normalized.split("\n");
  next[next.length - 1] = `${next[next.length - 1] ?? ""}${parts[0] ?? ""}`;

  for (let index = 1; index < parts.length; index += 1) {
    next.push(parts[index] ?? "");
  }

  return next;
};

const randomTerminalProcessId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const buildStandaloneTerminalSession = ({
  processId,
  cwd,
  command,
  title,
}: {
  processId: string;
  cwd: string;
  command: string;
  title: string;
}): TerminalSession => ({
  id: processId,
  title,
  command,
  cwd,
  processId,
  status: "running",
  background: false,
  lastEvent: relativeNow(),
  log: [`$ ${command}`],
  source: "shell",
  writable: true,
});

const mergeTerminalsForThread = (thread: Thread, existing: Array<TerminalSession> = []) => {
  const standalone = existing.filter((terminal) => terminal.source === "shell");
  const history = buildTerminalsFromTurns(thread);
  return [...standalone, ...history.filter((terminal) => !standalone.some((entry) => entry.processId === terminal.processId))];
};

const updateTerminalSession = (
  terminals: Array<TerminalSession>,
  processId: string,
  updater: (terminal: TerminalSession) => TerminalSession,
) => terminals.map((terminal) => (terminal.processId === processId ? updater(terminal) : terminal));

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
      source: "thread",
      writable: false,
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

const removeThreadRecord = (snapshot: DashboardData, threadId: string) => {
  snapshot.threads = snapshot.threads.filter((record) => record.thread.id !== threadId);
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

const isPlaceholderHydrationThread = (thread: Thread) =>
  thread.turns.length === 0 &&
  thread.status.type === "idle" &&
  !thread.name?.trim() &&
  !thread.preview?.trim();

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
        name: isPlaceholderHydrationThread(thread) ? current.thread.name : thread.name,
        preview: isPlaceholderHydrationThread(thread) ? current.thread.preview : thread.preview,
        turns: mergedTurns,
      }
    : {
        ...thread,
        turns: mergedTurns,
      };

  const preservePendingApprovals =
    mergedThread.status.type === "active" &&
    mergedThread.status.activeFlags.some(
      (flag) => flag === "waitingOnApproval" || flag === "waitingOnUserInput",
    );

  return {
    thread: mergedThread,
    plan: current?.plan ?? createDefaultPlan(mergedThread),
    steers: mergeSteerHistory(current?.steers, readStoredThreadSteers(thread.id)),
    steerSuggestions: current?.steerSuggestions ?? DEFAULT_STEER_SUGGESTIONS,
    approvals: preservePendingApprovals
      ? (current?.approvals ?? []).filter((approval) => approval.state === "pending")
      : [],
    terminals: mergeTerminalsForThread(mergedThread, current?.terminals),
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

const textToBase64 = (value: string) => bytesToBase64(new TextEncoder().encode(value).buffer);

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

const buildPromptText = (
  text: string,
  mentions: Array<MentionAttachment>,
  adapter: ProviderAdapter,
  sharedThreadMemory?: string | null,
) => {
  const sections: string[] = [];
  const normalizedText = text.trim();
  const fileMentions = mentions.filter((mention) => mention.kind === "file");

  if (sharedThreadMemory?.trim()) {
    sections.push(sharedThreadMemory.trim());
  }

  if (fileMentions.length > 0) {
    const seen = new Set<string>();
    const attachmentLines = fileMentions.flatMap((mention) => {
      const key = `${mention.name.toLowerCase()}:${mention.path}`;
      if (seen.has(key)) {
        return [];
      }

      seen.add(key);
      return [`## ${mention.name}: ${mention.path}`];
    });

    if (attachmentLines.length > 0) {
      sections.push("# Files mentioned by the user:");
      sections.push(...attachmentLines);
    }
  }

  if (sections.length > 0 || normalizedText) {
    sections.push(adapter.requestHeading);
    if (normalizedText) {
      sections.push(normalizedText);
    }
    return sections.join("\n");
  }

  return "";
};

const toTurnInputs = (
  text: string,
  mentions: Array<MentionAttachment>,
  skills: Array<SkillCard>,
  images: Array<string>,
  providerId: ProviderId,
  sharedThreadMemory?: string | null,
): Array<UserInput> => {
  const inputs: Array<UserInput> = [];
  const adapter = getProviderAdapter(providerId);
  const promptText = buildPromptText(text, mentions, adapter, sharedThreadMemory);

  if (promptText) {
    inputs.push({
      type: "text",
      text: promptText,
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

const buildExternalCliPrompt = (
  adapter: ProviderAdapter,
  text: string,
  mentions: Array<MentionAttachment>,
  sharedThreadMemory?: string | null,
) => buildPromptText(text, mentions, adapter, sharedThreadMemory);

const getTurnAgentMessageText = (turn: Turn) =>
  turn.items
    .filter(
      (item): item is Extract<ThreadItem, { type: "agentMessage" }> =>
        item.type === "agentMessage",
    )
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

const threadHasExternalProviderTurns = (thread: Thread) =>
  thread.turns.some((turn) =>
    turn.items.some(
      (item) =>
        item.type === "agentMessage" &&
        item.id.startsWith(EXTERNAL_PROVIDER_AGENT_PREFIX),
    ),
  );

const shouldAttachSharedThreadMemory = (
  thread: Thread,
  providerId: ProviderId,
) =>
  isHeadlessCliProvider(providerId) ||
  isLocalProviderThreadId(thread.id) ||
  threadHasExternalProviderTurns(thread);

const buildSharedThreadTurnContext = (
  turn: Turn,
  providerId: ProviderId,
) => {
  const lines: string[] = [];

  for (const item of turn.items) {
    if (item.type === "userMessage") {
      const display = getUserMessageDisplay(item, providerId);
      const text = display.text.trim();
      const fileLabels = [...new Set(display.fileAttachments.map((file) => file.label.trim()).filter(Boolean))];

      if (text) {
        lines.push(`User: ${text}`);
      }

      if (fileLabels.length > 0) {
        lines.push(`Files: ${fileLabels.join(", ")}`);
      }

      if (display.images.length > 0) {
        lines.push(`Images: ${display.images.length} attached`);
      }

      continue;
    }

    if (item.type === "agentMessage") {
      const text = item.text.trim();
      if (!text) {
        continue;
      }

      lines.push(
        item.id.startsWith(EXTERNAL_PROVIDER_AGENT_PREFIX)
          ? `Assistant (other provider): ${text}`
          : `Assistant: ${text}`,
      );
    }
  }

  return lines.join("\n").trim();
};

const buildSharedThreadMemory = (
  thread: Thread,
  providerId: ProviderId,
) => {
  if (!shouldAttachSharedThreadMemory(thread, providerId)) {
    return null;
  }

  const blocks: string[] = [];
  let totalChars = 0;
  const turns = sortTurnsById(thread.turns).filter(
    (turn) =>
      turn.status !== "inProgress" &&
      !isTransientOptimisticTurn(turn),
  );

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const block = buildSharedThreadTurnContext(turns[index], providerId);
    if (!block) {
      continue;
    }

    if (
      blocks.length > 0 &&
      totalChars + block.length > SHARED_THREAD_MEMORY_CHAR_LIMIT
    ) {
      break;
    }

    blocks.push(block);
    totalChars += block.length;

    if (blocks.length >= SHARED_THREAD_MEMORY_TURN_LIMIT) {
      break;
    }
  }

  if (blocks.length === 0) {
    return null;
  }

  return [
    "# Shared thread memory:",
    "Use this as the canonical Nomadex context for this thread. It may include turns from other providers or turns that do not exist in your native provider session history.",
    "",
    "## Recent thread context:",
    ...blocks.reverse().flatMap((block, index) => [`### Memory ${index + 1}`, block, ""]),
  ]
    .join("\n")
    .trim();
};

const buildExternalCliCommand = ({
  binaryPath,
  adapter,
  prompt,
  cwd,
  model,
  filePaths,
}: {
  binaryPath: string;
  adapter: ProviderAdapter;
  prompt: string;
  cwd: string;
  model: string;
  filePaths: Array<string>;
}) => {
  if (adapter.id === "opencode") {
    const command = [binaryPath, "run"];
    if (model && model !== "default") {
      command.push("--model", model);
    }
    for (const filePath of filePaths) {
      command.push("--file", filePath);
    }
    command.push("--dir", cwd, prompt);
    return command;
  }

  if (adapter.id === "qwen-code") {
    return [binaryPath, "--auth-type=qwen-oauth", "-p", prompt];
  }

  return null;
};

const toOptimisticFileMentions = (
  cwd: string,
  files: Array<ComposerFile>,
  providerId: ProviderId,
): Array<MentionAttachment> =>
  files.map((file) => ({
    id: `optimistic-file:${file.id}`,
    name: file.name,
    path: buildProviderOptimisticFileUploadPath(
      getProviderAdapter(providerId),
      cwd,
      file.name,
    ),
    kind: "file",
  }));

const cloneDashboardSnapshot = (snapshot: DashboardData): DashboardData => ({
  ...snapshot,
  threads: [...snapshot.threads],
  providers: [...snapshot.providers],
  providerSetup: cloneProviderSetupMap(snapshot.providerSetup),
  providerAuth: cloneProviderAuthMap(snapshot.providerAuth),
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

const toRuntimeStatus = (
  mode: DashboardData["transport"]["mode"],
  status: DashboardData["transport"]["status"],
  error: string | null,
  endpoint: string,
) => ({
  mode,
  status,
  endpoint,
  error,
});

const OPTIMISTIC_USER_MESSAGE_PREFIX = "optimistic-user:";
const OPTIMISTIC_TURN_PREFIX = "optimistic-turn:";
const LOCAL_PROVIDER_TURN_PREFIX = "local-provider-turn:";
const LIVE_FILE_CHANGE_PREVIEW_PREFIX = "live-filechange-preview:";
const MATERIALIZED_THREAD_ID_FIELD = "materializedThreadId";

const isOptimisticUserMessage = (item: ThreadItem) => item.type === "userMessage" && item.id.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX);
const isOptimisticTurn = (turn: Turn) => turn.id.startsWith(OPTIMISTIC_TURN_PREFIX);
const isExternalProviderTurn = (turn: Turn) =>
  turn.items.some(
    (item) =>
      item.type === "agentMessage" &&
      item.id.startsWith(EXTERNAL_PROVIDER_AGENT_PREFIX),
  );
const isTransientOptimisticTurn = (turn: Turn) =>
  isOptimisticTurn(turn) &&
  !(isExternalProviderTurn(turn) && turn.status !== "inProgress");
const isLiveFileChangePreview = (item: ThreadItem) => item.type === "fileChange" && item.id.startsWith(LIVE_FILE_CHANGE_PREVIEW_PREFIX);
type FileChangeItem = Extract<ThreadItem, { type: "fileChange" }>;

const stripOptimisticTurns = (turns: Array<Turn>) =>
  turns.filter((turn) => !isTransientOptimisticTurn(turn));

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

type RollbackHunkLine = {
  type: "context" | "add" | "remove";
  text: string;
  noNewlineAfter: boolean;
};

type RollbackHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: Array<RollbackHunkLine>;
};

type ParsedRollbackChange = {
  oldPath: string | null;
  newPath: string | null;
  hunks: Array<RollbackHunk>;
};

type RollbackTextBuffer = {
  lines: Array<string>;
  endsWithNewline: boolean;
};

const normalizeRollbackPatchPath = (value: string) =>
  normalizeDiffPath(value).replace(/\\/g, "/");

const isAbsoluteRuntimePath = (value: string) =>
  value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");

const parseUnifiedDiffRange = (value: string) => {
  const [startToken, countToken] = value.split(",", 2);
  const start = Number.parseInt(startToken, 10);
  const count =
    countToken === undefined || countToken === ""
      ? 1
      : Number.parseInt(countToken, 10);

  if (!Number.isFinite(start) || !Number.isFinite(count)) {
    throw new Error("Rollback is unavailable because a saved diff hunk is malformed.");
  }

  return { start, count };
};

const parseRollbackChange = (change: FileUpdateChange): ParsedRollbackChange => {
  const fallbackPath = normalizeRollbackPatchPath(change.path);
  if (!fallbackPath || fallbackPath === "Editing files") {
    throw new Error(
      "Rollback is unavailable because the saved change does not include a concrete file path.",
    );
  }

  let oldPath = change.kind.type === "add" ? null : fallbackPath;
  let newPath = change.kind.type === "delete" ? null : fallbackPath;
  const hunks: Array<RollbackHunk> = [];
  let currentHunk: RollbackHunk | null = null;

  const flushHunk = () => {
    if (currentHunk) {
      hunks.push(currentHunk);
      currentHunk = null;
    }
  };

  const diffBody = change.diff.replace(/\r/g, "").replace(/^\n+|\n+$/g, "");
  if (diffBody) {
    for (const line of diffBody.split("\n")) {
      if (line === "GIT binary patch" || line.startsWith("Binary files ")) {
        throw new Error("Rollback is unavailable for binary file changes.");
      }

      if (line.startsWith("diff --git ")) {
        flushHunk();
        const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (match) {
          oldPath = normalizeRollbackPatchPath(match[1]);
          newPath = normalizeRollbackPatchPath(match[2]);
        }
        continue;
      }

      if (line.startsWith("rename from ")) {
        oldPath = normalizeRollbackPatchPath(line.slice("rename from ".length).trim());
        continue;
      }

      if (line.startsWith("rename to ")) {
        newPath = normalizeRollbackPatchPath(line.slice("rename to ".length).trim());
        continue;
      }

      if (line.startsWith("--- ")) {
        const source = line.slice(4).trim();
        oldPath = source === "/dev/null" ? null : normalizeRollbackPatchPath(source);
        continue;
      }

      if (line.startsWith("+++ ")) {
        const target = line.slice(4).trim();
        newPath = target === "/dev/null" ? null : normalizeRollbackPatchPath(target);
        continue;
      }

      if (line.startsWith("@@")) {
        flushHunk();
        const match = line.match(/^@@ -(\d+(?:,\d+)?) \+(\d+(?:,\d+)?) @@/);
        if (!match) {
          throw new Error("Rollback is unavailable because a saved diff hunk header is malformed.");
        }

        const oldRange = parseUnifiedDiffRange(match[1]);
        const newRange = parseUnifiedDiffRange(match[2]);
        currentHunk = {
          oldStart: oldRange.start,
          oldCount: oldRange.count,
          newStart: newRange.start,
          newCount: newRange.count,
          lines: [],
        };
        continue;
      }

      if (!currentHunk) {
        continue;
      }

      if (line === "\\ No newline at end of file") {
        const lastLine = currentHunk.lines[currentHunk.lines.length - 1];
        if (lastLine) {
          lastLine.noNewlineAfter = true;
        }
        continue;
      }

      const prefix = line[0];
      if (prefix !== " " && prefix !== "+" && prefix !== "-") {
        continue;
      }

      currentHunk.lines.push({
        type: prefix === " " ? "context" : prefix === "+" ? "add" : "remove",
        text: line.slice(1),
        noNewlineAfter: false,
      });
    }
  }

  flushHunk();

  if (change.kind.type === "update" && change.kind.move_path && (!oldPath || !newPath)) {
    throw new Error(
      "Rollback is unavailable for rename-only file changes without complete diff headers.",
    );
  }

  return { oldPath, newPath, hunks };
};

const textToRollbackBuffer = (value: string): RollbackTextBuffer => {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized) {
    return {
      lines: [],
      endsWithNewline: true,
    };
  }

  const endsWithNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (endsWithNewline) {
    lines.pop();
  }

  return {
    lines,
    endsWithNewline,
  };
};

const rollbackBufferToText = (buffer: RollbackTextBuffer) => {
  if (buffer.lines.length === 0) {
    return "";
  }

  return `${buffer.lines.join("\n")}${buffer.endsWithNewline ? "\n" : ""}`;
};

const rollbackLineArraysEqual = (left: Array<string>, right: Array<string>) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const revertFileTextFromChange = (
  currentText: string,
  parsedChange: ParsedRollbackChange,
  fileLabel: string,
) => {
  let buffer = textToRollbackBuffer(currentText);

  for (const hunk of parsedChange.hunks.slice().reverse()) {
    const currentSegment = hunk.lines.filter((line) => line.type !== "remove");
    const previousSegment = hunk.lines.filter((line) => line.type !== "add");
    const startIndex = Math.max(0, hunk.newStart - 1);
    const actualSegment = buffer.lines.slice(
      startIndex,
      startIndex + currentSegment.length,
    );

    if (!rollbackLineArraysEqual(actualSegment, currentSegment.map((line) => line.text))) {
      throw new Error(
        `Rollback could not be applied cleanly to ${fileLabel}. The local file no longer matches the saved diff.`,
      );
    }

    const nextLines = [...buffer.lines];
    nextLines.splice(
      startIndex,
      currentSegment.length,
      ...previousSegment.map((line) => line.text),
    );

    let endsWithNewline = buffer.endsWithNewline;
    const touchesEndAfter =
      startIndex + previousSegment.length === nextLines.length;
    if (nextLines.length === 0) {
      endsWithNewline = true;
    } else if (touchesEndAfter) {
      const lastLine = previousSegment[previousSegment.length - 1];
      if (lastLine) {
        endsWithNewline = !lastLine.noNewlineAfter;
      }
    }

    buffer = {
      lines: nextLines,
      endsWithNewline,
    };
  }

  return rollbackBufferToText(buffer);
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

const inputIdentity = (input: UserInput) => {
  switch (input.type) {
    case "text":
      return `text:${input.text}`;
    case "image":
      return `image:${input.url}`;
    case "localImage":
      return `localImage:${input.path}`;
    case "skill":
      return `skill:${input.path}:${input.name}`;
    case "mention":
      return `mention:${input.path}:${input.name}`;
    default:
      return JSON.stringify(input);
  }
};

const mergeUserMessageContent = (incoming: Array<UserInput>, existing: Array<UserInput>) => {
  if (incoming.length === 0) {
    return existing;
  }

  if (existing.length === 0) {
    return incoming;
  }

  const merged = [...incoming];
  const seen = new Set(incoming.map((input) => inputIdentity(input)));

  for (const input of existing) {
    const key = inputIdentity(input);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(input);
  }

  return merged;
};

const updateTurnUserMessageContent = (
  turns: Array<Turn>,
  turnId: string,
  messageId: string,
  content: Array<UserInput>,
) =>
  turns.map((turn) => {
    if (turn.id !== turnId) {
      return turn;
    }

    return {
      ...turn,
      items: turn.items.map((item) =>
        item.id === messageId && item.type === "userMessage"
          ? {
              ...item,
              content,
            }
          : item,
      ),
    };
  });

const mergeIncomingItem = (incoming: ThreadItem, existing?: ThreadItem): ThreadItem => {
  if (!existing || existing.type !== incoming.type) {
    return incoming;
  }

  if (incoming.type === "userMessage") {
    const current = existing as Extract<ThreadItem, { type: "userMessage" }>;

    return {
      ...current,
      ...incoming,
      content: mergeUserMessageContent(incoming.content as Array<UserInput>, current.content as Array<UserInput>),
    };
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

export class WorkspaceRuntimeService {
  private snapshot: DashboardData;
  private listeners = new Set<EventListener>();
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private loadingThreads = new Set<string>();
  private resumedThreads = new Set<string>();
  private approvalMap = new Map<
    string,
    {
      rawRequestId: RequestId;
      method: string;
      params: Record<string, unknown>;
      responded?: boolean;
    }
  >();
  private standaloneTerminalMeta = new Map<
    string,
    { threadId: string; cwd: string; command: string; title: string }
  >();
  private externalProviderRuns = new Map<
    string,
    {
      threadId: string;
      turnId: string;
      itemId: string;
      providerId: ProviderId;
      stderr: string;
    }
  >();
  private providerAuthRuns = new Map<
    string,
    {
      providerId: ProviderId;
      flow: ProviderAuthFlow;
      output: string;
      stderr: string;
      cancelled: boolean;
    }
  >();
  private standaloneTerminalDecoders = new Map<
    string,
    { stdout: TextDecoder; stderr: TextDecoder }
  >();
  private emitQueued = false;
  private emitFrame: number | null = null;
  private emitTimer: number | null = null;

  constructor(initialData = createFallbackDashboardData()) {
    const initialAdapter = getProviderAdapter(initialData.settings.provider);
    this.snapshot = {
      ...initialData,
      providers: [...initialData.providers],
      providerSetup: cloneProviderSetupMap(initialData.providerSetup),
      providerAuth: cloneProviderAuthMap(initialData.providerAuth),
      transport: toRuntimeStatus(
        "mock",
        "connecting",
        null,
        defaultWsUrlForProvider(initialAdapter),
      ),
    };
  }

  private getActiveProviderId() {
    return this.snapshot.settings.provider;
  }

  private getActiveProviderAdapter() {
    return getProviderAdapter(this.getActiveProviderId());
  }

  private getWsUrlCandidates(adapter = this.getActiveProviderAdapter()) {
    return resolveWsUrls(adapter);
  }

  private getDefaultWsUrl(adapter = this.getActiveProviderAdapter()) {
    return defaultWsUrlForProvider(adapter);
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
    this.markStandaloneTerminalsDisconnected("Connection closed.");
    this.markExternalProviderRunsDisconnected("Connection closed.");
    this.markProviderAuthRunsDisconnected("Connection closed.");
    this.socket?.close();
    this.socket = null;
    this.failPending(new Error("Local agent bridge connection closed."));
    this.connectPromise = null;
    this.loadingThreads.clear();
    this.resumedThreads.clear();
  }

  private failLiveConnection(socket: WebSocket, detail: string) {
    if (this.socket !== socket) {
      return;
    }

    this.markStandaloneTerminalsDisconnected("Connection closed.");
    this.markExternalProviderRunsDisconnected("Connection closed.");
    this.markProviderAuthRunsDisconnected("Connection closed.");
    this.socket = null;
    this.connectPromise = null;
    this.failPending(new Error("Local agent bridge connection closed."));
    this.loadingThreads.clear();
    this.resumedThreads.clear();
    this.mutate((snapshot) => {
      snapshot.transport = toRuntimeStatus(
        snapshot.transport.mode,
        "offline",
        detail,
        this.getDefaultWsUrl(),
      );
    });
  }

  private handleSocketClose(socket: WebSocket, event?: CloseEvent) {
    const detail =
      event?.reason?.trim()
        ? `Connection lost: ${event.reason.trim()}`
        : event && event.code !== 1000
          ? `Connection lost (${event.code}). Reconnecting…`
          : "Connection lost. Reconnecting…";
    this.failLiveConnection(socket, detail);
  }

  private handleSocketError(socket: WebSocket) {
    this.failLiveConnection(socket, "Connection lost. Reconnecting…");

    try {
      socket.close();
    } catch {
      // Ignore cleanup errors for failed live sockets.
    }
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
        socket.onerror = () => {
          this.handleSocketError(socket);
        };
        socket.onclose = (event) => {
          this.handleSocketClose(socket, event);
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

  private ensureStandaloneTerminalDecoders(processId: string) {
    const existing = this.standaloneTerminalDecoders.get(processId);
    if (existing) {
      return existing;
    }

    const created = {
      stdout: new TextDecoder(),
      stderr: new TextDecoder(),
    };
    this.standaloneTerminalDecoders.set(processId, created);
    return created;
  }

  private decodeStandaloneTerminalChunk(processId: string, stream: "stdout" | "stderr", deltaBase64: string, flush = false) {
    const binary = atob(deltaBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoders = this.ensureStandaloneTerminalDecoders(processId);
    return decoders[stream].decode(bytes, { stream: !flush });
  }

  private flushStandaloneTerminalDecoders(processId: string) {
    const decoders = this.standaloneTerminalDecoders.get(processId);
    if (!decoders) {
      return "";
    }

    const tail = `${decoders.stdout.decode()}${decoders.stderr.decode()}`;
    this.standaloneTerminalDecoders.delete(processId);
    return tail;
  }

  private updateStandaloneTerminalLog(processId: string, text: string) {
    const meta = this.standaloneTerminalMeta.get(processId);
    if (!meta || !text) {
      return;
    }

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, meta.threadId, (record) => ({
        ...record,
        terminals: updateTerminalSession(record.terminals, processId, (terminal) => ({
          ...terminal,
          log: appendTerminalLog(terminal.log, text),
          lastEvent: relativeNow(),
        })),
      }));
    });
  }

  private finalizeStandaloneTerminal(
    processId: string,
    result:
      | { type: "response"; response: CommandExecResponse }
      | { type: "error"; error: unknown }
      | { type: "disconnected"; detail: string },
  ) {
    const meta = this.standaloneTerminalMeta.get(processId);
    const decoderTail = this.flushStandaloneTerminalDecoders(processId);
    if (!meta) {
      return;
    }

    let status: TerminalSession["status"] = "idle";
    let lastEvent = "Shell exited";
    let combinedOutput = decoderTail;

    if (result.type === "response") {
      const { response } = result;
      combinedOutput = `${combinedOutput}${response.stdout}${response.stderr}`;
      if (response.exitCode !== 0) {
        status = "failed";
        lastEvent = `Exit ${response.exitCode}`;
      }
    } else if (result.type === "disconnected") {
      status = "failed";
      lastEvent = result.detail;
      combinedOutput = `${combinedOutput}\n${result.detail}`;
    } else {
      status = "failed";
      lastEvent = "Shell failed";
      combinedOutput = `${combinedOutput}\n${getErrorMessage(result.error) || "Unable to start the project shell."}`;
    }

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, meta.threadId, (record) => ({
        ...record,
        terminals: updateTerminalSession(record.terminals, processId, (terminal) => ({
          ...terminal,
          status,
          writable: false,
          lastEvent,
          log: combinedOutput ? appendTerminalLog(terminal.log, combinedOutput) : terminal.log,
        })),
      }));
    });

    this.standaloneTerminalMeta.delete(processId);
  }

  private markStandaloneTerminalsDisconnected(detail: string) {
    const processIds = [...this.standaloneTerminalMeta.keys()];
    for (const processId of processIds) {
      this.finalizeStandaloneTerminal(processId, {
        type: "disconnected",
        detail,
      });
    }
  }

  private appendExternalProviderDelta(
    threadId: string,
    turnId: string,
    itemId: string,
    delta: string,
    live: boolean,
  ) {
    if (!delta) {
      return;
    }

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, threadId, (record) => {
        const turns = ensureTurnExists(record.thread.turns, turnId).map((turn) => {
          if (turn.id !== turnId) {
            return turn;
          }

          const hasItem = turn.items.some(
            (item) => item.id === itemId && item.type === "agentMessage",
          );
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
                  text: `${item.text}${delta}`,
                }
              : item,
          );

          const agentMessage = items.find(
            (item): item is Extract<ThreadItem, { type: "agentMessage" }> =>
              item.id === itemId && item.type === "agentMessage",
          );

          if (agentMessage) {
            ensureStream(
              snapshot,
              threadId,
              turnId,
              agentMessage.id,
              "text",
              agentMessage.text,
              live,
            );
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
            status: live ? { type: "active", activeFlags: [] } : { type: "idle" },
            turns,
            updatedAt: Math.floor(Date.now() / 1000),
          },
        };
      });
    });
  }

  private finalizeExternalProviderRun(
    processId: string,
    result:
      | { type: "response"; response: CommandExecResponse }
      | { type: "error"; error: unknown }
      | { type: "disconnected"; detail: string },
  ) {
    const meta = this.externalProviderRuns.get(processId);
    if (!meta) {
      return;
    }

    const decoderTail = this.flushStandaloneTerminalDecoders(processId);
    const trailingText =
      result.type === "response"
        ? `${result.response.stdout}${result.response.stderr}`
        : result.type === "disconnected"
          ? result.detail
          : getErrorMessage(result.error) || "Unable to run external provider.";
    const combinedTail = [decoderTail, trailingText]
      .filter((value) => value.trim().length > 0)
      .join("");

    if (combinedTail) {
      this.appendExternalProviderDelta(
        meta.threadId,
        meta.turnId,
        meta.itemId,
        combinedTail,
        false,
      );
    }

    const failed =
      result.type !== "response" || result.response.exitCode !== 0;
    const errorMessage =
      result.type === "response"
        ? [result.response.stderr, meta.stderr]
            .filter((value) => value.trim().length > 0)
            .join("\n")
            .trim()
        : result.type === "disconnected"
          ? result.detail
          : getErrorMessage(result.error);

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, meta.threadId, (record) => {
        const nextTurnStatus: Turn["status"] = failed ? "failed" : "completed";
        const nextTurnError: TurnError | null = failed
          ? {
              message:
                errorMessage ||
                `${getProviderAdapter(meta.providerId).displayName} run failed.`,
              codexErrorInfo: null,
              additionalDetails: null,
            }
          : null;
        const turns: Array<Turn> = record.thread.turns.map((turn) => {
          if (turn.id !== meta.turnId) {
            return turn;
          }

          const items: Array<ThreadItem> = turn.items.some(
            (item) => item.id === meta.itemId && item.type === "agentMessage",
          )
            ? turn.items
            : [
                ...turn.items,
                {
                  type: "agentMessage",
                  id: meta.itemId,
                  text: "",
                  phase: null,
                } satisfies Extract<ThreadItem, { type: "agentMessage" }>,
              ];

          if (!combinedTail) {
            const agentMessage = items.find(
              (item): item is Extract<ThreadItem, { type: "agentMessage" }> =>
                item.id === meta.itemId && item.type === "agentMessage",
            );
            if (agentMessage) {
              ensureStream(
                snapshot,
                meta.threadId,
                meta.turnId,
                agentMessage.id,
                "text",
                agentMessage.text,
                false,
              );
            }
          }

          stopStreamsForItem(snapshot, meta.itemId);

          return {
            ...turn,
            items,
            status: nextTurnStatus,
            error: nextTurnError,
          };
        });

        return {
          ...record,
          thread: {
            ...record.thread,
            status: { type: "idle" },
            turns,
            updatedAt: Math.floor(Date.now() / 1000),
          },
        };
      });
    });

    this.externalProviderRuns.delete(processId);
  }

  private markExternalProviderRunsDisconnected(detail: string) {
    const processIds = [...this.externalProviderRuns.keys()];
    for (const processId of processIds) {
      this.finalizeExternalProviderRun(processId, {
        type: "disconnected",
        detail,
      });
    }
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
      this.handleServerRequest(
        String(message.id),
        message.id,
        message.method,
        message.params ?? {},
      );
      return;
    }

    if (message.method) {
      this.handleNotification(message.method, message.params ?? {});
    }
  };

  private async request<TResult>(
    method: string,
    params: unknown,
    options?: RequestOptions,
  ): Promise<TResult> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Local agent bridge is not connected.");
    }

    const id = String(++this.requestId);
    const payload = { id, method, params };

    return await new Promise<TResult>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const finishResolve = (value: TResult) => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        resolve(value);
      };
      const finishReject = (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        reject(error);
      };

      this.pending.set(id, {
        resolve: (value: unknown) => {
          if (
            this.socket?.readyState === WebSocket.OPEN &&
            (this.snapshot.transport.mode !== "live" ||
              this.snapshot.transport.status !== "connected" ||
              this.snapshot.transport.error !== null)
          ) {
            this.mutate((snapshot) => {
              snapshot.transport = toRuntimeStatus(
                "live",
                "connected",
                null,
                this.getDefaultWsUrl(),
              );
            });
          }

          finishResolve(value as TResult);
        },
        reject: (error) => {
          finishReject(error);
        },
      });

      if (typeof options?.timeoutMs === "number" && options.timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          this.pending.delete(id);
          finishReject(
            new Error(
              options.timeoutError?.trim() || `${method} timed out.`,
            ),
          );
          if (options.closeSocketOnTimeout && this.socket?.readyState === WebSocket.OPEN) {
            try {
              this.socket.close();
            } catch {
              // Ignore cleanup errors for timed-out live sockets.
            }
          }
        }, options.timeoutMs);
      }

      try {
        this.socket?.send(JSON.stringify(payload));
      } catch (error) {
        this.pending.delete(id);
        finishReject(error);
      }
    });
  }

  private respond(requestId: RequestId, result: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Local agent bridge is not connected.");
    }

    this.socket.send(JSON.stringify({ id: requestId, result }));
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return await (this.connectPromise ?? Promise.resolve());
    }

    if (this.connectPromise) {
      return await this.connectPromise;
    }

    this.connectPromise = (async () => {
      const adapter = this.getActiveProviderAdapter();
      if (!providerIsReady(adapter)) {
        const error = providerUnavailableMessage(adapter);
        this.mutate((snapshot) => {
          snapshot.transport = toRuntimeStatus(
            "mock",
            "error",
            error,
            this.getDefaultWsUrl(adapter),
          );
        });
        throw new Error(error);
      }

      const wsUrlCandidates = this.getWsUrlCandidates(adapter);
      let connected = false;
      for (const candidate of wsUrlCandidates) {
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
          wsUrlCandidates.length > 1
            ? `Failed to connect to the ${adapter.transportLabel}. Tried: ${wsUrlCandidates.join(", ")}`
            : `Failed to connect to ${this.getDefaultWsUrl(adapter)}`;

        this.mutate((snapshot) => {
          snapshot.transport = toRuntimeStatus(
            "mock",
            "error",
            error,
            this.getDefaultWsUrl(adapter),
          );
        });
        throw new Error(error);
      }

      try {
        await this.request("initialize", {
          clientInfo: {
            name: "nomadex",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi: true,
          },
        });

        await this.bootstrap();
      } catch (error) {
        this.mutate((snapshot) => {
          snapshot.transport = toRuntimeStatus(
            "mock",
            "error",
            error instanceof Error ? error.message : String(error),
            this.getDefaultWsUrl(adapter),
          );
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

  async ensureLiveBridge() {
    const currentSocket = this.socket;
    const healthySocket =
      currentSocket?.readyState === WebSocket.OPEN &&
      this.snapshot.transport.mode === "live" &&
      this.snapshot.transport.status === "connected";

    if (healthySocket) {
      try {
        await this.request(
          "thread/list",
          { limit: 1 },
          {
            timeoutMs: 2500,
            timeoutError: "Connection lost. Reconnecting…",
            closeSocketOnTimeout: true,
          },
        );
        return;
      } catch {
        if (currentSocket && this.socket === currentSocket) {
          this.failLiveConnection(currentSocket, "Connection lost. Reconnecting…");
          try {
            currentSocket.close();
          } catch {
            // Ignore cleanup errors for failed live sockets.
          }
        }
      }
    }

    await this.connect();
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
      this.readConfigWithRecovery(),
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
      snapshot.providers = listProviderAdapters();
      snapshot.providerSetup = {
        ...createProviderSetupMap(snapshot.providers),
        ...snapshot.providerSetup,
      };
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
      snapshot.transport = toRuntimeStatus(
        "live",
        "connected",
        null,
        this.getDefaultWsUrl(),
      );
    });

    const firstThread = this.snapshot.threads[0]?.thread;
    if (firstThread) {
      await this.resumeThread(firstThread.id).catch(() => undefined);
      await this.loadDirectory(firstThread.cwd).catch(() => undefined);
    }
  }

  async refreshThreads(limit = 60) {
    const response = await this.request<{ data: Array<Thread>; nextCursor: string | null }>(
      "thread/list",
      { limit },
    );

    this.mutate((snapshot) => {
      snapshot.threads = sortThreads(
        response.data.map((thread) =>
          mergeThread(
            thread,
            snapshot.threads.find((entry) => entry.thread.id === thread.id),
          ),
        ),
      );
    });
  }

  private forgetThreadState(threadId: string) {
    this.loadingThreads.delete(threadId);
    this.resumedThreads.delete(threadId);

    for (const [processId, meta] of this.standaloneTerminalMeta.entries()) {
      if (meta.threadId === threadId) {
        this.standaloneTerminalMeta.delete(processId);
      }
    }
  }

  async renameThread(threadId: string, name: string) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("Thread name cannot be empty.");
    }

    const updatedAt = Math.floor(Date.now() / 1000);

    if (isLocalProviderThreadId(threadId)) {
      this.mutate((snapshot) => {
        updateThreadRecord(snapshot, threadId, (record) => ({
          ...record,
          thread: {
            ...record.thread,
            name: normalizedName,
            updatedAt,
          },
        }));
        snapshot.threads = sortThreads(snapshot.threads);
      });
      return;
    }

    await this.request("thread/name/set", {
      threadId,
      name: normalizedName,
    });

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, threadId, (record) => ({
        ...record,
        thread: {
          ...record.thread,
          name: normalizedName,
          updatedAt,
        },
      }));
      snapshot.threads = sortThreads(snapshot.threads);
    });
  }

  async deleteThread(threadId: string) {
    if (isLocalProviderThreadId(threadId)) {
      this.forgetThreadState(threadId);
      this.mutate((snapshot) => {
        removeThreadRecord(snapshot, threadId);
        snapshot.streams = snapshot.streams.filter((entry) => entry.threadId !== threadId);
      });
      return;
    }

    await this.request("thread/archive", { threadId });

    this.forgetThreadState(threadId);
    this.mutate((snapshot) => {
      removeThreadRecord(snapshot, threadId);
      snapshot.streams = snapshot.streams.filter((entry) => entry.threadId !== threadId);
    });
  }

  private async readConfigWithRecovery() {
    try {
      return await this.request<ConfigReadResponse>("config/read", {});
    } catch (error) {
      const invalidProvider = invalidBackendModelProviderFromError(error);
      if (!invalidProvider) {
        throw error;
      }

      await this.request("config/value/write", {
        keyPath: "model_provider",
        value: null,
        mergeStrategy: "replace",
      });

      return await this.request<ConfigReadResponse>("config/read", {});
    }
  }

  async ensureThreadLoaded(threadId: string) {
    if (isLocalProviderThreadId(threadId)) {
      return;
    }

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
    if (isLocalProviderThreadId(threadId)) {
      return;
    }

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

      if (!isPlaceholderHydrationThread(response.thread)) {
        this.resumedThreads.add(threadId);
      }
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
    const resolvedCwd = await this.resolveWorkspaceCwd(options?.cwd);

    if (isHeadlessCliProvider(settings.provider)) {
      const threadId = randomLocalProviderThreadId(settings.provider);
      const cwd = resolvedCwd ?? ".";
      const record = createBlankThreadRecord(
        threadId,
        "New Session",
        settings,
        cwd,
      );

      this.mutate((snapshot) => {
        upsertThreadRecord(snapshot, {
          ...record,
          thread: {
            ...record.thread,
            source: "cli",
            status: { type: "idle" },
            modelProvider: settings.provider,
            preview: "New Session",
            name: "New Session",
          },
        });
      });

      await this.loadDirectory(cwd).catch(() => undefined);
      return threadId;
    }

    const response = await this.request<ThreadStartResponse>("thread/start", {
      cwd: resolvedCwd,
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

    const uploadDir = buildProviderUploadRoot(this.getActiveProviderAdapter(), cwd);
    await this.request("fs/createDirectory", {
      path: uploadDir,
      recursive: true,
    });

    const paths: string[] = [];

    for (const image of images) {
      let buffer: ArrayBuffer;

      if (image.file) {
        buffer = await image.file.arrayBuffer();
      } else {
        const response = await fetch(image.url);
        if (!response.ok) {
          throw new Error(`Failed to read image attachment: ${image.name}`);
        }
        buffer = await response.arrayBuffer();
      }

      const filename = `${Date.now()}-${sanitizeFilename(image.name)}`;
      const path = buildProviderOptimisticUploadPath(
        this.getActiveProviderAdapter(),
        cwd,
        filename,
      );

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

    const uploadDir = buildProviderFilesUploadRoot(this.getActiveProviderAdapter(), cwd);
    await this.request("fs/createDirectory", {
      path: uploadDir,
      recursive: true,
    });

    const mentions: Array<MentionAttachment> = [];

    for (const file of files) {
      const filename = `${Date.now()}-${sanitizeFilename(file.name)}`;
      const path = buildProviderOptimisticFileUploadPath(
        this.getActiveProviderAdapter(),
        cwd,
        filename,
      );
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

  private async runHeadlessCliTurn(
    args: {
      threadId: string;
      mode: WorkspaceMode;
      prompt: string;
      mentions: Array<MentionAttachment>;
      skills: Array<SkillCard>;
      files: Array<ComposerFile>;
      images: Array<ComposerImage>;
      settings: SettingsState;
    },
    thread: Thread,
  ) {
    const adapter = getProviderAdapter(args.settings.provider);
    const binaryName = adapter.id === "opencode" ? "opencode" : "qwen";
    const resolvedBinary = await this.resolveCliBinary(binaryName, thread.cwd);
    if (!resolvedBinary) {
      throw new Error(
        `${adapter.displayName} is not installed on the host machine.`,
      );
    }
    const uploadedFileMentions = await this.uploadFiles(thread.cwd, args.files);
    const uploadedImages = await this.uploadImages(thread.cwd, args.images);
    const combinedMentions = [...args.mentions, ...uploadedFileMentions];
    const sharedThreadMemory = buildSharedThreadMemory(
      thread,
      args.settings.provider,
    );
    const prompt = buildExternalCliPrompt(
      adapter,
      args.prompt,
      combinedMentions,
      sharedThreadMemory,
    );
    const command = buildExternalCliCommand({
      binaryPath: resolvedBinary.path,
      adapter,
      prompt,
      cwd: thread.cwd,
      model: args.settings.model,
      filePaths: uploadedFileMentions.map((entry) => entry.path),
    });

    if (!command) {
      throw new Error(`${adapter.displayName} is not wired for headless execution.`);
    }

    const userInputs = toTurnInputs(
      args.prompt,
      combinedMentions,
      args.skills,
      uploadedImages,
      args.settings.provider,
      sharedThreadMemory,
    );
    const turnId = `${LOCAL_PROVIDER_TURN_PREFIX}${args.threadId}:${Date.now().toString(36)}`;
    const userItemId = `${OPTIMISTIC_USER_MESSAGE_PREFIX}${args.threadId}:${Date.now().toString(36)}`;
    const agentItemId = `external-agent:${args.threadId}:${Date.now().toString(36)}`;
    const processId = randomTerminalProcessId();

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, args.threadId, (record) => ({
        ...record,
        thread: {
          ...record.thread,
          preview: args.prompt.trim() || record.thread.preview,
          modelProvider: args.settings.provider,
          status: { type: "active", activeFlags: [] },
          turns: sortTurnsById([
            ...stripOptimisticTurns(record.thread.turns),
            {
              id: turnId,
              status: "inProgress",
              error: null,
              items: [
                {
                  type: "userMessage",
                  id: userItemId,
                  content: userInputs,
                },
                {
                  type: "agentMessage",
                  id: agentItemId,
                  text: "",
                  phase: null,
                },
              ],
            },
          ]),
          updatedAt: Math.floor(Date.now() / 1000),
        },
      }));
    });

    this.externalProviderRuns.set(processId, {
      threadId: args.threadId,
      turnId,
      itemId: agentItemId,
      providerId: args.settings.provider,
      stderr: "",
    });

    void this.request<CommandExecResponse>("command/exec", {
      command,
      cwd: thread.cwd,
      processId,
      streamStdoutStderr: true,
      disableTimeout: true,
    })
      .then((response) => {
        this.finalizeExternalProviderRun(processId, {
          type: "response",
          response,
        });
      })
      .catch((error) => {
        this.finalizeExternalProviderRun(processId, {
          type: "error",
          error,
        });
      });
  }

  private async materializeLocalProviderThread(
    threadId: string,
    settings: SettingsState,
  ) {
    const current = this.snapshot.threads.find((entry) => entry.thread.id === threadId);
    if (!current || !isLocalProviderThreadId(threadId)) {
      return current?.thread ?? null;
    }

    const response = await this.request<ThreadStartResponse>("thread/start", {
      cwd: current.thread.cwd,
      model: settings.model,
      approvalPolicy: settings.approvalPolicy,
      sandbox: settings.sandboxMode,
      ephemeral: false,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
      personality: settings.personality === "none" ? null : (settings.personality satisfies Personality),
    });

    const nextThreadId = response.thread.id;
    const mergedRecordBase = mergeThread(response.thread, {
      ...current,
      thread: {
        ...current.thread,
        id: nextThreadId,
      },
    });
    const mergedRecord: ThreadRecord = {
      ...mergedRecordBase,
      thread: {
        ...mergedRecordBase.thread,
        preview: current.thread.preview || mergedRecordBase.thread.preview,
        name: current.thread.name || mergedRecordBase.thread.name,
        modelProvider: settings.provider,
      },
    };

    this.loadingThreads.delete(threadId);
    this.resumedThreads.delete(threadId);

    for (const [processId, meta] of this.standaloneTerminalMeta.entries()) {
      if (meta.threadId === threadId) {
        this.standaloneTerminalMeta.set(processId, {
          ...meta,
          threadId: nextThreadId,
        });
      }
    }

    for (const [processId, meta] of this.externalProviderRuns.entries()) {
      if (meta.threadId === threadId) {
        this.externalProviderRuns.set(processId, {
          ...meta,
          threadId: nextThreadId,
        });
      }
    }

    this.mutate((snapshot) => {
      snapshot.threads = snapshot.threads.filter((entry) => entry.thread.id !== threadId);
      snapshot.streams = snapshot.streams.map((entry) =>
        entry.threadId === threadId
          ? {
              ...entry,
              threadId: nextThreadId,
            }
          : entry,
      );
      upsertThreadRecord(snapshot, mergedRecord);
    });

    return mergedRecord.thread;
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
      return args.threadId;
    }

    let effectiveThreadId = args.threadId;
    let effectiveThread = thread;

    if (!isHeadlessCliProvider(args.settings.provider) && isLocalProviderThreadId(thread.id)) {
      const materializedThread = await this.materializeLocalProviderThread(thread.id, args.settings);
      if (!materializedThread) {
        throw new Error("Unable to sync this local provider conversation to the live workspace.");
      }

      effectiveThread = materializedThread;
      effectiveThreadId = materializedThread.id;
    }
    const attachMaterializedThreadId = (error: unknown) => {
      if (effectiveThreadId === args.threadId || !error || typeof error !== "object") {
        return error;
      }

      try {
        return Object.assign(error, {
          [MATERIALIZED_THREAD_ID_FIELD]: effectiveThreadId,
        });
      } catch {
        return error;
      }
    };

    if (isHeadlessCliProvider(args.settings.provider)) {
      await this.runHeadlessCliTurn(args, effectiveThread);
      return effectiveThreadId;
    }

    if (args.mode === "review") {
      try {
        const response = await this.request<ReviewStartResponse>("review/start", {
          threadId: effectiveThreadId,
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
          updateThreadRecord(snapshot, effectiveThreadId, (record) => ({
            ...record,
            thread: {
              ...record.thread,
              modelProvider: args.settings.provider,
              status: { type: "active", activeFlags: [] },
              turns: sortTurnsById([...record.thread.turns, response.turn]),
              updatedAt: Math.floor(Date.now() / 1000),
            },
          }));
        });

        return effectiveThreadId;
      } catch (error) {
        throw attachMaterializedThreadId(error);
      }
    }

    const optimisticInputs = toTurnInputs(
      args.prompt,
      [
        ...args.mentions,
        ...toOptimisticFileMentions(effectiveThread.cwd, args.files, args.settings.provider),
      ],
      args.skills,
      args.images.map((image) => image.url),
      args.settings.provider,
      buildSharedThreadMemory(effectiveThread, args.settings.provider),
    );
    const optimisticUserMessage: Extract<ThreadItem, { type: "userMessage" }> = {
      type: "userMessage",
      id: `${OPTIMISTIC_USER_MESSAGE_PREFIX}${effectiveThreadId}:${Date.now().toString(36)}`,
      content: optimisticInputs,
    };
    const optimisticTurnId = `${OPTIMISTIC_TURN_PREFIX}${effectiveThreadId}:${Date.now().toString(36)}`;

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, effectiveThreadId, (record) => ({
        ...record,
        thread: {
          ...record.thread,
          preview: args.prompt.trim() || record.thread.preview,
          modelProvider: args.settings.provider,
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
      const uploadedFileMentions = await this.uploadFiles(effectiveThread.cwd, args.files);
      const uploadedImages = await this.uploadImages(effectiveThread.cwd, args.images);
      const combinedMentions = [...args.mentions, ...uploadedFileMentions];
      const inputs = toTurnInputs(
        args.prompt,
        combinedMentions,
        args.skills,
        uploadedImages,
        args.settings.provider,
        buildSharedThreadMemory(effectiveThread, args.settings.provider),
      );
      const submittedUserMessage: Extract<ThreadItem, { type: "userMessage" }> = {
        ...optimisticUserMessage,
        content: inputs,
      };

      this.mutate((snapshot) => {
        updateThreadRecord(snapshot, effectiveThreadId, (record) => ({
          ...record,
          thread: {
            ...record.thread,
            turns: updateTurnUserMessageContent(
              record.thread.turns,
              optimisticTurnId,
              optimisticUserMessage.id,
              inputs,
            ),
            updatedAt: Math.floor(Date.now() / 1000),
          },
        }));
      });

      const response = await this.request<TurnStartResponse>("turn/start", {
        threadId: effectiveThreadId,
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
                    readableRoots: [effectiveThread.cwd],
                  },
                  networkAccess: false,
                }
              : {
                  type: "workspaceWrite",
                  writableRoots: [effectiveThread.cwd],
                  readOnlyAccess: {
                    type: "restricted",
                    includePlatformDefaults: true,
                    readableRoots: [effectiveThread.cwd],
                  },
                  networkAccess: false,
                  excludeTmpdirEnvVar: false,
                  excludeSlashTmp: false,
                },
        personality: args.settings.personality === "none" ? null : args.settings.personality,
        collaborationMode: settingsToCollaborationMode(args.settings),
      });

      this.mutate((snapshot) => {
        updateThreadRecord(snapshot, effectiveThreadId, (record) => {
          const baseTurns = stripOptimisticTurns(record.thread.turns);
          const existingTurn = baseTurns.find((turn) => turn.id === response.turn.id);
          const mergedTurn = mergeIncomingTurn(response.turn, existingTurn);
          const userMessageIndex = mergedTurn.items.findIndex((item) => item.type === "userMessage");
          const nextTurnItems =
            userMessageIndex === -1
              ? [submittedUserMessage, ...mergedTurn.items]
              : mergedTurn.items.map((item, index) =>
                  index === userMessageIndex
                    ? mergeIncomingItem(item, submittedUserMessage)
                    : item,
                );
          const nextTurn = {
            ...mergedTurn,
            items: nextTurnItems,
          };

          return {
            ...record,
            thread: {
              ...record.thread,
              preview: args.prompt.trim() || record.thread.preview,
              modelProvider: args.settings.provider,
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
      return effectiveThreadId;
    } catch (error) {
      this.mutate((snapshot) => {
        updateThreadRecord(snapshot, effectiveThreadId, (record) => ({
          ...record,
          thread: {
            ...record.thread,
            status: { type: "idle" },
            turns: record.thread.turns.filter((turn) => turn.id !== optimisticTurnId),
            updatedAt: Math.floor(Date.now() / 1000),
          },
        }));
      });
      throw attachMaterializedThreadId(error);
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

    const externalProcessEntry = [...this.externalProviderRuns.entries()].find(
      ([, meta]) => meta.threadId === threadId && meta.turnId === activeTurn.id,
    );
    if (externalProcessEntry) {
      const [processId] = externalProcessEntry;
      try {
        await this.request("command/exec/terminate", { processId });
        this.externalProviderRuns.delete(processId);
        this.flushStandaloneTerminalDecoders(processId);
        return true;
      } catch {
        return false;
      }
    }

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

    if (isHeadlessCliProvider(record.thread.modelProvider as ProviderId)) {
      return false;
    }

    const steerEntry = createSteerEntry(args.threadId, activeTurn.id, args, "pending");

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, args.threadId, (current) => ({
        ...current,
        steers: mergeSteerHistory([steerEntry], current.steers),
      }));
    });

    try {
      const uploadedFileMentions = await this.uploadFiles(record.thread.cwd, args.files);
      const uploadedImages = await this.uploadImages(record.thread.cwd, args.images);
      const inputs = toTurnInputs(
        args.prompt,
        [...args.mentions, ...uploadedFileMentions],
        args.skills,
        uploadedImages,
        this.getActiveProviderId(),
      );

      this.mutate((snapshot) => {
        activeTurn.items.forEach((item) => stopStreamsForItem(snapshot, item.id));
      });

      await this.request("turn/steer", {
        threadId: args.threadId,
        expectedTurnId: activeTurn.id,
        input: inputs,
      });

      this.mutate((snapshot) => {
        updateThreadRecord(snapshot, args.threadId, (current) => ({
          ...current,
          steers: mergeSteerHistory(
            current.steers?.map((entry) =>
              entry.id === steerEntry.id ? { ...entry, status: "applied" } : entry,
            ),
          ),
        }));
      });
      writeStoredThreadSteers(
        args.threadId,
        this.snapshot.threads.find((entry) => entry.thread.id === args.threadId)?.steers,
      );
      await this.resumeThread(args.threadId, true).catch(() => undefined);

      return true;
    } catch {
      this.mutate((snapshot) => {
        updateThreadRecord(snapshot, args.threadId, (current) => ({
          ...current,
          steers: current.steers?.filter((entry) => entry.id !== steerEntry.id) ?? [],
        }));
      });
      writeStoredThreadSteers(
        args.threadId,
        this.snapshot.threads.find((entry) => entry.thread.id === args.threadId)?.steers,
      );
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

  async writeFile(path: string, content: string) {
    await this.request("fs/writeFile", {
      path,
      dataBase64: textToBase64(content),
    });
  }

  private async readRuntimeFileOrNull(path: string) {
    try {
      return await this.readFile(path);
    } catch (error) {
      if (isRuntimeFileNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  private resolveRollbackPath(baseCwd: string, filePath: string | null) {
    if (!filePath) {
      return null;
    }

    return isAbsoluteRuntimePath(filePath)
      ? filePath
      : joinRuntimePath(baseCwd, filePath);
  }

  private async rollbackLocalFileChange(baseCwd: string, change: FileUpdateChange) {
    const parsedChange = parseRollbackChange(change);
    const currentPath = this.resolveRollbackPath(
      baseCwd,
      parsedChange.newPath ?? parsedChange.oldPath,
    );
    const previousPath = this.resolveRollbackPath(baseCwd, parsedChange.oldPath);
    const fileLabel = currentPath ?? previousPath ?? change.path;

    let currentText = "";
    if (currentPath) {
      const existing = await this.readRuntimeFileOrNull(currentPath);
      if (existing === null) {
        if (parsedChange.newPath === null) {
          currentText = "";
        } else {
          throw new Error(
            `Rollback could not find ${currentPath}. The local file state no longer matches the selected prompt.`,
          );
        }
      } else {
        currentText = existing;
      }
    }

    const revertedText =
      parsedChange.hunks.length > 0
        ? revertFileTextFromChange(currentText, parsedChange, fileLabel)
        : currentText;

    if (previousPath === null) {
      if (currentPath) {
        await this.request("fs/remove", {
          path: currentPath,
          force: true,
        }).catch(() => undefined);
      }
      return;
    }

    if (currentPath && currentPath !== previousPath) {
      const existingTarget = await this.readRuntimeFileOrNull(previousPath);
      if (existingTarget !== null) {
        throw new Error(
          `Rollback cannot restore ${previousPath} because a local file already exists there.`,
        );
      }
    }

    await this.request("fs/createDirectory", {
      path: dirnameRuntimePath(previousPath),
      recursive: true,
    });
    await this.writeFile(previousPath, revertedText);

    if (currentPath && currentPath !== previousPath) {
      await this.request("fs/remove", {
        path: currentPath,
        force: true,
      }).catch(() => undefined);
    }
  }

  async readGitGraph(cwd: string, limit = 80) {
    const resolvedCwd = await this.resolveGitWorkspaceCwd(cwd);
    const fieldSeparator = String.fromCharCode(31);
    const prettyFormat = [
      `${fieldSeparator}%h`,
      `%ad`,
      `%an`,
      `%d`,
      `%s`,
    ].join(fieldSeparator);

    const response = await this.request<CommandExecResponse>("command/exec", {
      command: [
        "git",
        "log",
        "--graph",
        "--date=short",
        "--decorate=short",
        `--pretty=format:${prettyFormat}`,
        "--all",
        "-n",
        String(Math.max(20, Math.min(limit, 120))),
      ],
      cwd: resolvedCwd,
      timeoutMs: 5000,
    });

    if (response.exitCode !== 0) {
      const details = [response.stderr, response.stdout]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join("\n")
        .trim();
      throw new Error(details || "Failed to read git history.");
    }

    return response.stdout;
  }

  async readGitStatus(cwd: string) {
    const resolvedCwd = await this.resolveGitWorkspaceCwd(cwd);
    const response = await this.request<CommandExecResponse>("command/exec", {
      command: [
        "git",
        "status",
        "--short",
        "--branch",
        "--renames",
      ],
      cwd: resolvedCwd,
      timeoutMs: 5000,
    });

    if (response.exitCode !== 0) {
      const details = [response.stderr, response.stdout]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join("\n")
        .trim();
      throw new Error(details || "Failed to read git working tree status.");
    }

    return response.stdout;
  }

  private async runCommand(
    command: string[],
    cwd?: string | null,
    options?: {
      timeoutMs?: number;
      disableTimeout?: boolean;
    },
  ) {
    const params: {
      command: string[];
      cwd?: string | null;
      timeoutMs?: number;
      disableTimeout?: boolean;
    } = {
      command,
      timeoutMs: options?.timeoutMs,
      disableTimeout: options?.disableTimeout,
    };

    if (cwd && cwd.trim()) {
      params.cwd = cwd;
    }

    return await this.request<CommandExecResponse>("command/exec", params);
  }

  private commandFailureDetails(
    response: CommandExecResponse,
    fallback: string,
  ) {
    const details = [response.stderr, response.stdout]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join("\n")
      .trim();

    return details || fallback;
  }

  private hasGitStatusEntries(rawStatus: string) {
    return rawStatus
      .split("\n")
      .map((line) => line.trim())
      .some((line) => line.length > 0 && !line.startsWith("## "));
  }

  private workspacePathCandidates(...values: Array<string | null | undefined>) {
    return [...new Set(values.map((value) => safeString(value).trim()).filter(Boolean))];
  }

  private async directoryExists(path: string) {
    try {
      await this.request<FsReadDirectoryResponse>("fs/readDirectory", {
        path,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async detectServerCwd() {
    const attempts: Array<string[]> = [
      ["pwd"],
      ["cmd", "/d", "/s", "/c", "cd"],
    ];

    for (const command of attempts) {
      const response = await this.runCommand(command, null, { timeoutMs: 5000 }).catch(
        () => null,
      );

      const cwd = response?.exitCode === 0 ? response.stdout.trim() : "";
      if (cwd) {
        return cwd;
      }
    }

    return null;
  }

  private async resolveWorkspaceCwd(preferredCwd?: string | null) {
    const candidates = this.workspacePathCandidates(
      preferredCwd,
      this.snapshot.directoryCatalogRoot,
      ...this.snapshot.threads.map((entry) => entry.thread.cwd),
    );

    for (const candidate of candidates) {
      if (await this.directoryExists(candidate)) {
        return candidate;
      }
    }

    const detected = await this.detectServerCwd();
    if (detected && (await this.directoryExists(detected))) {
      return detected;
    }

    return detected || candidates[0] || null;
  }

  private async resolveGitWorkspaceCwd(preferredCwd?: string | null) {
    const fallbackCwd = await this.resolveWorkspaceCwd(preferredCwd);
    const candidates = this.workspacePathCandidates(preferredCwd, fallbackCwd);
    let sawDirectory = false;
    let lastGitFailure: string | null = null;

    for (const candidate of candidates) {
      if (!(await this.directoryExists(candidate))) {
        continue;
      }

      sawDirectory = true;
      const response = await this.runCommand(
        ["git", "rev-parse", "--show-toplevel"],
        candidate,
        { timeoutMs: 5000 },
      );

      if (response.exitCode === 0) {
        return response.stdout.trim() || candidate;
      }

      lastGitFailure = this.commandFailureDetails(
        response,
        "This directory is not a git repository.",
      );
    }

    if (sawDirectory) {
      throw new Error(
        lastGitFailure || "This session is not attached to a git repository.",
      );
    }

    throw new Error(
      "No project directory is attached to this session. Open the repository folder first.",
    );
  }

  private async resolveWorkspaceProjectRoot(cwd: string) {
    const resolvedCwd = await this.resolveWorkspaceCwd(cwd);
    if (!resolvedCwd) {
      throw new Error(
        "No project directory is attached to this session. Open the repository folder first.",
      );
    }

    const response = await this.runCommand(
      ["git", "rev-parse", "--show-toplevel"],
      resolvedCwd,
      { timeoutMs: 5000 },
    );

    if (response.exitCode !== 0) {
      return resolvedCwd;
    }

    return response.stdout.trim() || resolvedCwd;
  }

  private async resolveWorkspaceProjectSettingsPath(cwd: string) {
    const projectRoot = await this.resolveWorkspaceProjectRoot(cwd);
    return joinRuntimePath(projectRoot, WORKSPACE_PROJECT_SETTINGS_RELATIVE_PATH);
  }

  private async readWorkspaceProjectSettings(
    cwd: string,
    fallbackProvider = this.snapshot.settings.provider,
  ) {
    const filePath = await this.resolveWorkspaceProjectSettingsPath(cwd);

    try {
      const response = await this.request<FsReadFileResponse>("fs/readFile", {
        path: filePath,
      });
      const parsed = JSON.parse(base64ToText(response.dataBase64)) as unknown;

      return {
        filePath,
        settings: normalizeWorkspaceProjectSettings(parsed, fallbackProvider),
      };
    } catch (error) {
      const message = getErrorMessage(error).toLowerCase();
      if (message.includes("enoent") || message.includes("not found")) {
        return {
          filePath,
          settings: normalizeWorkspaceProjectSettings({}, fallbackProvider),
        };
      }

      throw error;
    }
  }

  async readWorkspaceCommitPreferences(cwd: string) {
    const { filePath, settings } = await this.readWorkspaceProjectSettings(cwd);
    return {
      provider: settings.commitAssistant.provider,
      filePath,
    };
  }

  async writeWorkspaceCommitPreferences(
    cwd: string,
    patch: { provider?: ProviderId },
  ) {
    const { filePath, settings } = await this.readWorkspaceProjectSettings(cwd);
    const nextSettings: WorkspaceProjectSettings = {
      ...settings,
      commitAssistant: {
        ...settings.commitAssistant,
        ...(patch.provider ? { provider: patch.provider } : {}),
      },
    };

    await this.request("fs/createDirectory", {
      path: dirnameRuntimePath(filePath),
      recursive: true,
    });
    await this.request("fs/writeFile", {
      path: filePath,
      dataBase64: textToBase64(serializeWorkspaceProjectSettings(nextSettings)),
    });

    return {
      provider: nextSettings.commitAssistant.provider,
      filePath,
    };
  }

  private async buildCommitGenerationContext(
    cwd: string,
  ): Promise<CommitGenerationContext> {
    const resolvedCwd = await this.resolveGitWorkspaceCwd(cwd);
    const rawStatus = await this.readGitStatus(resolvedCwd);
    if (!this.hasGitStatusEntries(rawStatus)) {
      throw new Error("No changes are available to describe.");
    }

    const stagedCheck = await this.runCommand(
      ["git", "diff", "--cached", "--quiet", "--exit-code", "--no-ext-diff"],
      resolvedCwd,
      { timeoutMs: 5000 },
    );
    if (![0, 1].includes(stagedCheck.exitCode)) {
      throw new Error(
        this.commandFailureDetails(
          stagedCheck,
          "Failed to inspect staged changes.",
        ),
      );
    }

    const scope: CommitGenerationContext["scope"] =
      stagedCheck.exitCode === 1 ? "staged" : "working-tree";
    const diffStatCommand =
      scope === "staged"
        ? ["git", "diff", "--cached", "--stat", "--no-ext-diff"]
        : ["git", "diff", "--stat", "--no-ext-diff"];
    const diffCommand =
      scope === "staged"
        ? ["git", "diff", "--cached", "--no-ext-diff", "--unified=3"]
        : ["git", "diff", "--no-ext-diff", "--unified=3"];

    const [diffStatResponse, diffResponse] = await Promise.all([
      this.runCommand(diffStatCommand, resolvedCwd, { timeoutMs: 5000 }),
      this.runCommand(diffCommand, resolvedCwd, { timeoutMs: 10000 }),
    ]);

    if (diffStatResponse.exitCode !== 0) {
      throw new Error(
        this.commandFailureDetails(
          diffStatResponse,
          "Failed to read git diff statistics.",
        ),
      );
    }

    if (diffResponse.exitCode !== 0) {
      throw new Error(
        this.commandFailureDetails(diffResponse, "Failed to read git diff."),
      );
    }

    return {
      scope,
      status: rawStatus,
      diffStat: diffStatResponse.stdout,
      diff: diffResponse.stdout,
    };
  }

  private async waitForTurnCompletion(threadId: string, turnId: string) {
    const timeoutAt = Date.now() + 90000;

    while (Date.now() < timeoutAt) {
      const response = await this.request<ThreadReadResponse>("thread/read", {
        threadId,
        includeTurns: true,
      });
      const turn = response.thread.turns.find((entry) => entry.id === turnId);

      if (turn && turn.status !== "inProgress") {
        return turn;
      }

      await wait(400);
    }

    throw new Error("Timed out waiting for the commit message draft.");
  }

  private async commitAssistantSkill() {
    const skill =
      this.snapshot.installedSkills.find(
        (entry) =>
          entry.enabled && entry.name.trim().toLowerCase() === "commit-work",
      ) ?? null;

    if (!skill) {
      return null;
    }

    try {
      await this.request<FsReadFileResponse>("fs/readFile", {
        path: skill.path,
      });
      return skill;
    } catch {
      return null;
    }
  }

  private async generateCommitMessageWithCliProvider(
    cwd: string,
    providerId: ProviderId,
    prompt: string,
  ) {
    const adapter = getProviderAdapter(providerId);
    const binaryName = providerId === "opencode" ? "opencode" : "qwen";
    const resolvedBinary = await this.resolveCliBinary(binaryName, cwd);

    if (!resolvedBinary) {
      throw new Error(
        `${adapter.displayName} is not installed on the host machine.`,
      );
    }

    const command = buildExternalCliCommand({
      binaryPath: resolvedBinary.path,
      adapter,
      prompt,
      cwd,
      model:
        providerId === this.snapshot.settings.provider
          ? this.snapshot.settings.model
          : adapter.defaultModel ?? "default",
      filePaths: [],
    });

    if (!command) {
      throw new Error(`${adapter.displayName} does not support commit drafting.`);
    }

    const response = await this.runCommand(command, cwd, {
      disableTimeout: true,
    });

    if (response.exitCode !== 0) {
      throw new Error(
        this.commandFailureDetails(
          response,
          `${adapter.displayName} failed to generate a commit message.`,
        ),
      );
    }

    return extractCommitMessageCandidate(
      [response.stdout, response.stderr]
        .filter((value) => value.trim().length > 0)
        .join("\n"),
    );
  }

  private async generateCommitMessageWithBridgeProvider(
    cwd: string,
    providerId: ProviderId,
    prompt: string,
  ) {
    const adapter = getProviderAdapter(providerId);
    const commitSkill = await this.commitAssistantSkill();
    const model =
      providerId === this.snapshot.settings.provider
        ? this.snapshot.settings.model
        : adapter.defaultModel;
    const response = await this.request<ThreadStartResponse>("thread/start", {
      cwd,
      model: model && model !== "default" ? model : null,
      modelProvider: providerId,
      approvalPolicy: "never",
      sandbox: "read-only",
      personality: "pragmatic" satisfies Personality,
      ephemeral: true,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });
    const turnResponse = await this.request<TurnStartResponse>("turn/start", {
      threadId: response.thread.id,
      input: toTurnInputs(
        prompt,
        [],
        commitSkill ? [commitSkill] : [],
        [],
        providerId,
      ),
      model: model && model !== "default" ? model : null,
      approvalPolicy: "never",
      effort: this.snapshot.settings.reasoningEffort,
      personality: "pragmatic" satisfies Personality,
      sandboxPolicy: {
        type: "readOnly",
        access: {
          type: "restricted",
          includePlatformDefaults: true,
          readableRoots: [cwd],
        },
        networkAccess: false,
      },
    });
    const completedTurn = await this.waitForTurnCompletion(
      response.thread.id,
      turnResponse.turn.id,
    );

    if (completedTurn.status === "failed") {
      throw new Error(
        completedTurn.error?.message ||
          `${adapter.displayName} failed to generate a commit message.`,
      );
    }

    return extractCommitMessageCandidate(getTurnAgentMessageText(completedTurn));
  }

  async generateCommitMessage(args: { cwd: string; providerId: ProviderId }) {
    const resolvedCwd = await this.resolveGitWorkspaceCwd(args.cwd);
    const context = await this.buildCommitGenerationContext(resolvedCwd);
    const prompt = buildCommitGenerationPrompt(context);
    const message = isHeadlessCliProvider(args.providerId)
      ? await this.generateCommitMessageWithCliProvider(
          resolvedCwd,
          args.providerId,
          prompt,
        )
      : await this.generateCommitMessageWithBridgeProvider(
          resolvedCwd,
          args.providerId,
          prompt,
        );

    if (!message.trim()) {
      throw new Error("The selected provider returned an empty commit message.");
    }

    return message.trim();
  }

  private async readGitHeadInfo(cwd: string) {
    const [shaResponse, branchResponse] = await Promise.all([
      this.runCommand(["git", "rev-parse", "HEAD"], cwd, {
        timeoutMs: 5000,
      }),
      this.runCommand(["git", "branch", "--show-current"], cwd, {
        timeoutMs: 5000,
      }),
    ]);

    return {
      sha: shaResponse.exitCode === 0 ? shaResponse.stdout.trim() || null : null,
      branch:
        branchResponse.exitCode === 0
          ? branchResponse.stdout.trim() || null
          : null,
    };
  }

  async commitWorkingTree(args: { cwd: string; message: string }) {
    const resolvedCwd = await this.resolveGitWorkspaceCwd(args.cwd);
    const paragraphs = splitCommitMessageParagraphs(args.message);
    if (paragraphs.length === 0) {
      throw new Error("Enter a commit message first.");
    }

    const rawStatus = await this.readGitStatus(resolvedCwd);
    if (!this.hasGitStatusEntries(rawStatus)) {
      throw new Error("There are no git changes to commit.");
    }

    const stagedCheck = await this.runCommand(
      ["git", "diff", "--cached", "--quiet", "--exit-code", "--no-ext-diff"],
      resolvedCwd,
      { timeoutMs: 5000 },
    );
    if (![0, 1].includes(stagedCheck.exitCode)) {
      throw new Error(
        this.commandFailureDetails(
          stagedCheck,
          "Failed to inspect staged changes.",
        ),
      );
    }

    let stagedAll = false;
    if (stagedCheck.exitCode === 0) {
      const addResponse = await this.runCommand(["git", "add", "-A"], resolvedCwd, {
        timeoutMs: 15000,
      });

      if (addResponse.exitCode !== 0) {
        throw new Error(
          this.commandFailureDetails(addResponse, "Failed to stage changes."),
        );
      }

      stagedAll = true;
    }

    const commitCommand = [
      "git",
      "commit",
      "-m",
      paragraphs[0],
      ...paragraphs
        .slice(1)
        .flatMap((paragraph) => ["-m", paragraph] as const),
    ];
    const commitResponse = await this.runCommand(commitCommand, resolvedCwd, {
      disableTimeout: true,
    });

    if (commitResponse.exitCode !== 0) {
      throw new Error(
        this.commandFailureDetails(commitResponse, "Failed to create commit."),
      );
    }

    const headInfo = await this.readGitHeadInfo(resolvedCwd);
    this.mutate((snapshot) => {
      snapshot.threads = snapshot.threads.map((record) =>
        record.thread.cwd === args.cwd || record.thread.cwd === resolvedCwd
          ? {
              ...record,
              thread: {
                ...record.thread,
                cwd: resolvedCwd,
                gitInfo: {
                  sha: headInfo.sha,
                  branch: headInfo.branch,
                  originUrl: record.thread.gitInfo?.originUrl ?? null,
                },
                updatedAt: Math.floor(Date.now() / 1000),
              },
            }
          : record,
      );
    });

    return {
      summary:
        commitResponse.stdout.trim() ||
        commitResponse.stderr.trim() ||
        "Committed changes.",
      sha: headInfo.sha,
      stagedAll,
    };
  }

  private providerCheckCwd() {
    return (
      this.snapshot.directoryCatalogRoot ||
      this.snapshot.threads[0]?.thread.cwd ||
      "."
    );
  }

  private defaultProviderSetupState(providerId: ProviderId) {
    return createProviderSetupMap([getProviderAdapter(providerId)])[providerId];
  }

  private defaultProviderAuthState(providerId: ProviderId) {
    return createProviderAuthMap([getProviderAdapter(providerId)])[providerId];
  }

  private upsertProviderAuthState(
    providerId: ProviderId,
    patch: Partial<ProviderAuthState>,
  ) {
    this.mutate((snapshot) => {
      snapshot.providerAuth[providerId] = {
        ...snapshot.providerAuth[providerId],
        ...patch,
      };
    });
  }

  private appendProviderAuthOutput(
    processId: string,
    stream: "stdout" | "stderr",
    deltaBase64: string,
  ) {
    const meta = this.providerAuthRuns.get(processId);
    if (!meta) {
      return;
    }

    if (this.snapshot.providerAuth[meta.providerId]?.processId !== processId) {
      return;
    }

    const decoded = this.decodeStandaloneTerminalChunk(processId, stream, deltaBase64);
    const normalized = normalizeTerminalText(decoded);
    if (!normalized) {
      return;
    }

    meta.output = trimAuthBuffer(`${meta.output}${normalized}`);
    if (stream === "stderr") {
      meta.stderr = trimAuthBuffer(`${meta.stderr}${normalized}`);
    }

    const progress = parseProviderAuthProgress(
      meta.providerId,
      meta.output,
    );

    this.upsertProviderAuthState(meta.providerId, {
      status: progress.status ?? "starting",
      flow: meta.flow,
      summary: progress.summary ?? "Preparing provider sign-in…",
      detail: progress.detail ?? null,
      authUrl: progress.authUrl ?? null,
      userCode: progress.userCode ?? null,
      processId,
      updatedAt: relativeNow(),
    });
  }

  private async finalizeProviderAuthRun(
    processId: string,
    result:
      | { type: "response"; response: CommandExecResponse }
      | { type: "error"; error: unknown }
      | { type: "disconnected"; detail: string },
  ) {
    const meta = this.providerAuthRuns.get(processId);
    if (!meta) {
      return;
    }

    if (
      this.snapshot.providerAuth[meta.providerId]?.processId &&
      this.snapshot.providerAuth[meta.providerId]?.processId !== processId
    ) {
      this.providerAuthRuns.delete(processId);
      this.flushStandaloneTerminalDecoders(processId);
      return;
    }

    const adapter = getProviderAdapter(meta.providerId);
    const decoderTail = normalizeTerminalText(
      this.flushStandaloneTerminalDecoders(processId),
    );
    const trailingText =
      result.type === "response"
        ? normalizeTerminalText(`${result.response.stdout}${result.response.stderr}`)
        : result.type === "disconnected"
          ? result.detail
          : getErrorMessage(result.error) || "Unable to start provider sign-in.";
    const combinedOutput = trimAuthBuffer(
      `${meta.output}${decoderTail}${normalizeTerminalText(trailingText)}`,
    );
    const progress = parseProviderAuthProgress(
      meta.providerId,
      combinedOutput,
    );

    this.providerAuthRuns.delete(processId);

    if (meta.cancelled) {
      this.upsertProviderAuthState(meta.providerId, {
        ...this.defaultProviderAuthState(meta.providerId),
        summary: `${adapter.displayName} sign-in cancelled.`,
        updatedAt: relativeNow(),
      });
      return;
    }

    if (result.type !== "response" || result.response.exitCode !== 0) {
      const errorMessage =
        result.type === "response"
          ? [result.response.stderr, meta.stderr]
              .filter((value) => value.trim().length > 0)
              .join("\n")
              .trim()
          : result.type === "disconnected"
            ? result.detail
            : getErrorMessage(result.error);

      this.upsertProviderAuthState(meta.providerId, {
        status: "error",
        flow: meta.flow,
        summary: `${adapter.displayName} sign-in failed.`,
        detail:
          errorMessage ||
          progress.detail ||
          "The provider CLI ended before Nomadex could verify the account.",
        authUrl: progress.authUrl ?? null,
        userCode: progress.userCode ?? null,
        processId: null,
        updatedAt: relativeNow(),
      });
      return;
    }

    this.upsertProviderAuthState(meta.providerId, {
      status: "checking",
      flow: meta.flow,
      summary: `Verifying ${adapter.displayName} session…`,
      detail: "Nomadex is checking the local CLI session now.",
      authUrl: progress.authUrl ?? null,
      userCode: progress.userCode ?? null,
      processId: null,
      updatedAt: relativeNow(),
    });

    try {
      await this.checkProviderSetup(meta.providerId);
      const setup = this.snapshot.providerSetup[meta.providerId];
      this.upsertProviderAuthState(meta.providerId, {
        status: setup.status === "ready" ? "completed" : "error",
        flow: meta.flow,
        summary:
          setup.status === "ready"
            ? `${adapter.displayName} is ready.`
            : `${adapter.displayName} sign-in finished, but setup is still not ready.`,
        detail: setup.detail ?? setup.summary,
        authUrl: setup.status === "ready" ? null : (progress.authUrl ?? null),
        userCode: setup.status === "ready" ? null : (progress.userCode ?? null),
        processId: null,
        updatedAt: relativeNow(),
      });
    } catch (error) {
      this.upsertProviderAuthState(meta.providerId, {
        status: "error",
        flow: meta.flow,
        summary: `${adapter.displayName} sign-in completed, but verification failed.`,
        detail:
          error instanceof Error
            ? error.message
            : "Nomadex could not verify the new provider session.",
        authUrl: progress.authUrl ?? null,
        userCode: progress.userCode ?? null,
        processId: null,
        updatedAt: relativeNow(),
      });
    }
  }

  private markProviderAuthRunsDisconnected(detail: string) {
    const processIds = [...this.providerAuthRuns.keys()];
    for (const processId of processIds) {
      void this.finalizeProviderAuthRun(processId, {
        type: "disconnected",
        detail,
      });
    }
  }

  private async resolveCliBinary(
    binaryName: "opencode" | "qwen",
    cwd: string,
  ) {
    const script = `
binary="${binaryName}"
resolved=""

if command -v "$binary" >/dev/null 2>&1; then
  resolved="$(command -v "$binary")"
fi

if [ -z "$resolved" ] && command -v npm >/dev/null 2>&1; then
  prefix="$(npm config get prefix 2>/dev/null || true)"
  if [ -n "$prefix" ] && [ -x "$prefix/bin/$binary" ]; then
    resolved="$prefix/bin/$binary"
  fi
fi

if [ -z "$resolved" ]; then
  shopt -s nullglob
  for candidate in "$HOME"/.nvm/versions/node/*/bin/"$binary" "$HOME"/.local/bin/"$binary"; do
    if [ -x "$candidate" ]; then
      resolved="$candidate"
      break
    fi
  done
fi

if [ -z "$resolved" ]; then
  exit 1
fi

version="$("$resolved" --version 2>/dev/null | head -n 1 || true)"
printf '%s\\n%s\\n' "$resolved" "$version"
`.trim();

    const response = await this.request<CommandExecResponse>("command/exec", {
      command: ["/bin/bash", "-lc", script],
      cwd,
      timeoutMs: 5000,
    });

    if (response.exitCode !== 0) {
      return null;
    }

    const output = stripAnsi(
      [response.stdout, response.stderr].join("\n"),
    )
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (output.length === 0) {
      return null;
    }

    return {
      path: output[0],
      version: output[1] ?? null,
    };
  }

  private async inspectOpenCodeSetup(cwd: string): Promise<ProviderSetupState> {
    const adapter = getProviderAdapter("opencode");
    const resolvedBinary = await this.resolveCliBinary("opencode", cwd);
    if (!resolvedBinary) {
      return {
        ...this.defaultProviderSetupState("opencode"),
        status: "needsInstall",
        summary: "OpenCode is not installed on the host machine.",
        detail: adapter.installCommand ?? "Install the OpenCode CLI, then check again.",
        installed: false,
        configured: false,
        authenticated: false,
        checkedAt: relativeNow(),
      };
    }

    const authResponse = await this.request<CommandExecResponse>("command/exec", {
      command: [resolvedBinary.path, "auth", "list"],
      cwd,
      timeoutMs: 8000,
    });
    const authOutput = stripAnsi(
      [authResponse.stdout, authResponse.stderr].join("\n"),
    ).trim();
    if (authResponse.exitCode !== 0) {
      return {
        ...this.defaultProviderSetupState("opencode"),
        status: "error",
        summary: "OpenCode is installed, but its auth status could not be read.",
        detail: authOutput || "OpenCode auth check failed.",
        installed: true,
        version: resolvedBinary.version,
        checkedAt: relativeNow(),
      };
    }

    const credentialsMatch = authOutput.match(/(\d+)\s+credentials?/iu);
    const credentialsCount = credentialsMatch ? Number(credentialsMatch[1]) : 0;
    const sourcePath =
      authOutput.match(/Credentials\s+([^\n]+)/iu)?.[1]?.trim() ?? null;

    return {
      ...this.defaultProviderSetupState("opencode"),
      status: credentialsCount > 0 ? "ready" : "needsAuth",
      summary:
        credentialsCount > 0
          ? "OpenCode credentials detected."
          : "OpenCode is installed, but no provider credentials are configured.",
      detail:
        credentialsCount > 0
          ? `${credentialsCount} credential${credentialsCount === 1 ? "" : "s"} available for OpenCode.`
          : "Use the sign-in action below, or run `opencode auth login` on the host machine, then check again.",
      installed: true,
      configured: credentialsCount > 0,
      authenticated: credentialsCount > 0,
      version: resolvedBinary.version,
      sourcePath,
      checkedAt: relativeNow(),
    };
  }

  private async inspectQwenCodeSetup(cwd: string): Promise<ProviderSetupState> {
    const adapter = getProviderAdapter("qwen-code");
    const resolvedBinary = await this.resolveCliBinary("qwen", cwd);
    if (!resolvedBinary) {
      return {
        ...this.defaultProviderSetupState("qwen-code"),
        status: "needsInstall",
        summary: "Qwen Code is not installed on the host machine.",
        detail: adapter.installCommand ?? "Install the Qwen Code CLI, then check again.",
        installed: false,
        configured: false,
        authenticated: false,
        checkedAt: relativeNow(),
      };
    }

    const script = `
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const projectRoot = process.argv[1] || process.cwd();
const candidates = [
  path.join(projectRoot, ".qwen", "settings.json"),
  path.join(os.homedir(), ".qwen", "settings.json"),
];
const oauthPath = path.join(os.homedir(), ".qwen", "oauth_creds.json");
let settingsPath = null;
let settings = null;
let parseError = null;
for (const candidate of candidates) {
  if (!fs.existsSync(candidate)) {
    continue;
  }
  settingsPath = candidate;
  try {
    settings = JSON.parse(fs.readFileSync(candidate, "utf8"));
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  break;
}
const selectedType = settings?.security?.auth?.selectedType ?? null;
const modelProviders = settings?.modelProviders && typeof settings.modelProviders === "object"
  ? Object.values(settings.modelProviders).filter(Array.isArray).flat()
  : [];
const inlineEnvCount = settings?.env && typeof settings.env === "object"
  ? Object.values(settings.env).filter((value) => typeof value === "string" && value.trim().length > 0).length
  : 0;
const envBackedProviderCount = modelProviders.filter(
  (entry) =>
    entry &&
    typeof entry === "object" &&
    typeof entry.envKey === "string" &&
    entry.envKey.length > 0 &&
    typeof process.env[entry.envKey] === "string" &&
    process.env[entry.envKey].trim().length > 0,
).length;
console.log(JSON.stringify({
  settingsPath,
  parseError,
  selectedType,
  modelProviderCount: modelProviders.length,
  inlineEnvCount,
  envBackedProviderCount,
  hasOauthCreds: fs.existsSync(oauthPath),
  oauthPath,
}));
`.trim();

    const configResponse = await this.request<CommandExecResponse>("command/exec", {
      command: ["node", "-e", script, cwd],
      cwd,
      timeoutMs: 5000,
    });
    const configOutput = stripAnsi(
      [configResponse.stdout, configResponse.stderr].join("\n"),
    ).trim();
    if (configResponse.exitCode !== 0) {
      return {
        ...this.defaultProviderSetupState("qwen-code"),
        status: "error",
        summary: "Qwen Code is installed, but its setup could not be inspected.",
        detail: configOutput || "Qwen Code setup check failed.",
        installed: true,
        version: resolvedBinary.version,
        checkedAt: relativeNow(),
      };
    }

    let parsed:
      | {
          settingsPath: string | null;
          parseError: string | null;
          selectedType: string | null;
          modelProviderCount: number;
          inlineEnvCount: number;
          envBackedProviderCount: number;
          hasOauthCreds: boolean;
          oauthPath: string;
        }
      | null = null;
    try {
      parsed = JSON.parse(configResponse.stdout.trim());
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return {
        ...this.defaultProviderSetupState("qwen-code"),
        status: "error",
        summary: "Qwen Code setup output could not be parsed.",
        detail: configOutput || "Unexpected Qwen Code setup output.",
        installed: true,
        version: resolvedBinary.version,
        checkedAt: relativeNow(),
      };
    }

    const selectedType = parsed.selectedType;
    const hasApiConfig =
      parsed.modelProviderCount > 0 ||
      parsed.inlineEnvCount > 0 ||
      parsed.envBackedProviderCount > 0;
    const hasOauthSession = parsed.hasOauthCreds;
    const sourcePath =
      parsed.settingsPath ?? (parsed.hasOauthCreds ? parsed.oauthPath : null);

    if (parsed.parseError) {
      return {
        ...this.defaultProviderSetupState("qwen-code"),
        status: "error",
        summary: "Qwen settings.json is invalid.",
        detail: parsed.parseError,
        installed: true,
        configured: false,
        authenticated: false,
        version: resolvedBinary.version,
        sourcePath,
        checkedAt: relativeNow(),
      };
    }

    if (!selectedType && hasOauthSession) {
      return {
        ...this.defaultProviderSetupState("qwen-code"),
        status: "ready",
        summary: "Qwen OAuth credentials detected.",
        detail:
          "Nomadex will launch Qwen Code with `--auth-type=qwen-oauth`, so a missing selected auth type in settings will not block runs.",
        installed: true,
        configured: true,
        authenticated: true,
        version: resolvedBinary.version,
        sourcePath,
        checkedAt: relativeNow(),
      };
    }

    if (!selectedType) {
      return {
        ...this.defaultProviderSetupState("qwen-code"),
        status: "needsConfig",
        summary: "Qwen Code is installed, but no auth type is selected.",
        detail:
          "Use the sign-in action below, or set `security.auth.selectedType` in `~/.qwen/settings.json` manually.",
        installed: true,
        configured: false,
        authenticated: false,
        version: resolvedBinary.version,
        sourcePath,
        checkedAt: relativeNow(),
      };
    }

    if (selectedType === "qwen-oauth") {
      return {
        ...this.defaultProviderSetupState("qwen-code"),
        status: parsed.hasOauthCreds ? "ready" : "needsAuth",
        summary: parsed.hasOauthCreds
          ? "Qwen OAuth credentials detected."
          : "Qwen OAuth is selected, but cached credentials are missing or expired.",
        detail: parsed.hasOauthCreds
          ? "Qwen Code can use the cached OAuth session on this host."
          : "Use the sign-in action below, then check again.",
        installed: true,
        configured: true,
        authenticated: parsed.hasOauthCreds,
        version: resolvedBinary.version,
        sourcePath,
        checkedAt: relativeNow(),
      };
    }

    return {
      ...this.defaultProviderSetupState("qwen-code"),
      status: hasApiConfig ? "ready" : "needsConfig",
      summary: hasApiConfig
        ? `Qwen Code is configured for ${selectedType}.`
        : `Qwen Code selected ${selectedType}, but no provider credentials were found.`,
      detail: hasApiConfig
        ? parsed.settingsPath
          ? "Headless runs will use the configured Qwen settings for this host."
          : "Qwen Code is relying on environment-level configuration."
        : "Add provider credentials in `~/.qwen/settings.json` or export the required API key env vars, then check again.",
      installed: true,
      configured: hasApiConfig,
      authenticated: hasApiConfig,
      version: resolvedBinary.version,
      sourcePath,
      checkedAt: relativeNow(),
    };
  }

  async checkProviderSetup(providerId: ProviderId = this.snapshot.settings.provider) {
    const adapter = getProviderAdapter(providerId);

    this.mutate((snapshot) => {
      snapshot.providerSetup[providerId] = {
        ...this.defaultProviderSetupState(providerId),
        status: "checking",
        summary: "Checking setup…",
      };
    });

    let nextState: ProviderSetupState;
    if (adapter.transportKind !== "cli") {
      nextState = {
        ...this.defaultProviderSetupState(providerId),
        status: "ready",
        summary: "Managed by the Nomadex bridge.",
        detail: "This provider does not use a local CLI binary.",
        installed: null,
        configured: null,
        authenticated: null,
        checkedAt: relativeNow(),
      };
    } else if (providerId === "opencode") {
      nextState = await this.inspectOpenCodeSetup(this.providerCheckCwd());
    } else if (providerId === "qwen-code") {
      nextState = await this.inspectQwenCodeSetup(this.providerCheckCwd());
    } else {
      nextState = {
        ...this.defaultProviderSetupState(providerId),
        status: "error",
        summary: `${adapter.displayName} setup checks are not wired yet.`,
        detail: "This provider still needs its runtime integration.",
        installed: false,
        configured: false,
        authenticated: false,
        checkedAt: relativeNow(),
      };
    }

    this.mutate((snapshot) => {
      snapshot.providerSetup[providerId] = nextState;
    });
  }

  private async ensureQwenOAuthSelection(cwd: string) {
    const script = `
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const settingsPath = path.join(os.homedir(), ".qwen", "settings.json");
let settings = {};

if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
}

if (!settings.security || typeof settings.security !== "object") {
  settings.security = {};
}

if (!settings.security.auth || typeof settings.security.auth !== "object") {
  settings.security.auth = {};
}

settings.security.auth.selectedType = "qwen-oauth";
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\\n");
console.log(settingsPath);
`.trim();

    const response = await this.request<CommandExecResponse>("command/exec", {
      command: ["node", "-e", script],
      cwd,
      timeoutMs: 5000,
    });

    if (response.exitCode !== 0) {
      const details = normalizeTerminalText(
        [response.stderr, response.stdout].join("\n"),
      ).trim();
      throw new Error(
        details || "Unable to prepare Qwen Code for OAuth sign-in.",
      );
    }
  }

  async startProviderAuth(
    providerId: ProviderId = this.snapshot.settings.provider,
    flow?: ProviderAuthFlow,
  ) {
    const adapter = getProviderAdapter(providerId);
    if (adapter.transportKind !== "cli") {
      throw new Error(`${adapter.displayName} does not use local CLI sign-in.`);
    }

    if (providerId !== "opencode" && providerId !== "qwen-code") {
      throw new Error(`${adapter.displayName} sign-in is not wired yet.`);
    }

    const existingRun = [...this.providerAuthRuns.entries()].find(
      ([, meta]) => meta.providerId === providerId,
    );
    if (existingRun) {
      const [existingProcessId, existingMeta] = existingRun;
      existingMeta.cancelled = true;
      try {
        await this.request("command/exec/terminate", { processId: existingProcessId });
      } catch {
        // Ignore restart cleanup failures.
      }
    }

    const cwd = this.providerCheckCwd();
    const binaryName = providerId === "opencode" ? "opencode" : "qwen";
    const resolvedBinary = await this.resolveCliBinary(binaryName, cwd);
    if (!resolvedBinary) {
      throw new Error(`${adapter.displayName} is not installed on the host machine.`);
    }

    const selectedFlow: ProviderAuthFlow =
      flow ?? (providerId === "opencode" ? "apiKey" : "oauth");

    if (providerId === "qwen-code") {
      await this.ensureQwenOAuthSelection(cwd);
    }

    const command =
      providerId === "opencode"
        ? [resolvedBinary.path, "auth", "login", "-p", "opencode"]
        : [resolvedBinary.path, "--auth-type=qwen-oauth", "-p", "ping"];
    const processId = randomTerminalProcessId();

    this.providerAuthRuns.set(processId, {
      providerId,
      flow: selectedFlow,
      output: "",
      stderr: "",
      cancelled: false,
    });

    this.upsertProviderAuthState(providerId, {
      ...this.defaultProviderAuthState(providerId),
      status: "starting",
      flow: selectedFlow,
      summary: `Starting ${adapter.displayName} sign-in…`,
      detail:
        providerId === "opencode"
          ? "Preparing the OpenCode Zen API key flow."
          : "Preparing the local Qwen OAuth sign-in.",
      processId,
      startedAt: relativeNow(),
      updatedAt: relativeNow(),
    });

    void this.request<CommandExecResponse>("command/exec", {
      command,
      cwd,
      processId,
      tty: true,
      streamStdin: true,
      streamStdoutStderr: true,
      disableTimeout: true,
      size: {
        cols: 120,
        rows: 24,
      },
    })
      .then((response) => {
        void this.finalizeProviderAuthRun(processId, {
          type: "response",
          response,
        });
      })
      .catch((error) => {
        void this.finalizeProviderAuthRun(processId, {
          type: "error",
          error,
        });
      });
  }

  async submitProviderAuthSecret(
    providerId: ProviderId = this.snapshot.settings.provider,
    secret: string,
  ) {
    const trimmedSecret = secret.trim();
    if (!trimmedSecret) {
      throw new Error("Enter the provider secret first.");
    }

    const entry = [...this.providerAuthRuns.entries()].find(
      ([, meta]) => meta.providerId === providerId,
    );
    if (!entry) {
      throw new Error("No provider sign-in is currently waiting for input.");
    }

    const [processId] = entry;
    await this.request("command/exec/write", {
      processId,
      deltaBase64: textToBase64(`${trimmedSecret}\n`),
    });

    this.upsertProviderAuthState(providerId, {
      status: "checking",
      summary:
        providerId === "opencode"
          ? "Submitting OpenCode Zen API key…"
          : "Submitting provider sign-in input…",
      detail:
        providerId === "opencode"
          ? "Nomadex sent the API key to the local OpenCode CLI. Waiting for verification."
          : "Waiting for the local provider CLI to verify the submitted input.",
      updatedAt: relativeNow(),
    });
  }

  async cancelProviderAuth(providerId: ProviderId = this.snapshot.settings.provider) {
    const entry = [...this.providerAuthRuns.entries()].find(
      ([, meta]) => meta.providerId === providerId,
    );
    if (!entry) {
      this.upsertProviderAuthState(providerId, {
        ...this.defaultProviderAuthState(providerId),
        updatedAt: relativeNow(),
      });
      return;
    }

    const [processId, meta] = entry;
    meta.cancelled = true;

    try {
      await this.request("command/exec/terminate", { processId });
    } catch {
      // Ignore termination races. The finalize handler will settle the state.
    }
  }

  private async clearOpenCodeAuth(cwd: string) {
    const resolvedBinary = await this.resolveCliBinary("opencode", cwd);
    if (!resolvedBinary) {
      throw new Error("OpenCode is not installed on the host machine.");
    }

    const response = await this.request<CommandExecResponse>("command/exec", {
      command: [resolvedBinary.path, "auth", "logout"],
      cwd,
      timeoutMs: 10000,
    });

    if (response.exitCode !== 0) {
      const details = normalizeTerminalText(
        [response.stderr, response.stdout].join("\n"),
      ).trim();
      throw new Error(details || "Unable to clear the current OpenCode account.");
    }
  }

  private async clearQwenOAuthSession(cwd: string) {
    const script = `
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const qwenRoot = path.join(os.homedir(), ".qwen");
for (const fileName of ["oauth_creds.json", "oauth_creds.lock"]) {
  const target = path.join(qwenRoot, fileName);
  try {
    fs.rmSync(target, { force: true });
  } catch {}
}
console.log(qwenRoot);
`.trim();

    const response = await this.request<CommandExecResponse>("command/exec", {
      command: ["node", "-e", script],
      cwd,
      timeoutMs: 5000,
    });

    if (response.exitCode !== 0) {
      const details = normalizeTerminalText(
        [response.stderr, response.stdout].join("\n"),
      ).trim();
      throw new Error(details || "Unable to clear the current Qwen Code account.");
    }
  }

  async switchProviderAccount(
    providerId: ProviderId = this.snapshot.settings.provider,
    flow?: ProviderAuthFlow,
  ) {
    const adapter = getProviderAdapter(providerId);
    if (adapter.transportKind !== "cli") {
      throw new Error(`${adapter.displayName} does not use local CLI sign-in.`);
    }

    const cwd = this.providerCheckCwd();
    await this.cancelProviderAuth(providerId);

    if (providerId === "opencode") {
      await this.clearOpenCodeAuth(cwd);
    } else if (providerId === "qwen-code") {
      await this.clearQwenOAuthSession(cwd);
    } else {
      throw new Error(`${adapter.displayName} account switching is not wired yet.`);
    }

    this.mutate((snapshot) => {
      snapshot.providerSetup[providerId] = {
        ...snapshot.providerSetup[providerId],
        status: "needsAuth",
        summary: `${adapter.displayName} session cleared.`,
        detail: "Start a new sign-in to attach a different account.",
        authenticated: false,
        checkedAt: relativeNow(),
      };
      snapshot.providerAuth[providerId] = {
        ...this.defaultProviderAuthState(providerId),
        summary: `${adapter.displayName} session cleared.`,
        updatedAt: relativeNow(),
      };
    });

    await this.startProviderAuth(providerId, flow);
  }

  async startProjectTerminal(threadId: string, cwd: string) {
    const processId = randomTerminalProcessId();
    const command = "/bin/bash -l";
    const title = "Project shell";

    this.standaloneTerminalMeta.set(processId, {
      threadId,
      cwd,
      command,
      title,
    });

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, threadId, (record) => ({
        ...record,
        terminals: [
          buildStandaloneTerminalSession({
            processId,
            cwd,
            command,
            title,
          }),
          ...record.terminals.filter((terminal) => terminal.processId !== processId),
        ],
      }));
    });

    void this.request<CommandExecResponse>("command/exec", {
      command: ["/bin/bash", "-l"],
      processId,
      tty: true,
      streamStdin: true,
      streamStdoutStderr: true,
      disableTimeout: true,
      cwd,
      size: {
        cols: 120,
        rows: 32,
      },
    })
      .then((response) => {
        this.finalizeStandaloneTerminal(processId, {
          type: "response",
          response,
        });
      })
      .catch((error) => {
        this.finalizeStandaloneTerminal(processId, {
          type: "error",
          error,
        });
      });

    return processId;
  }

  async sendTerminalInput(processId: string, input: string) {
    await this.request("command/exec/write", {
      processId,
      deltaBase64: textToBase64(input),
    });
  }

  async terminateTerminal(processId: string) {
    await this.request("command/exec/terminate", {
      processId,
    });
  }

  async updateSettings(patch: Partial<SettingsState>) {
    if (patch.provider) {
      persistProviderId(patch.provider);
    }

    this.mutate((snapshot) => {
      snapshot.settings = {
        ...snapshot.settings,
        ...patch,
      };
      if (patch.provider) {
        const adapter = getProviderAdapter(snapshot.settings.provider);
        snapshot.transport = {
          ...snapshot.transport,
          endpoint: this.getDefaultWsUrl(adapter),
        };
      }
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

  async rollbackToTurn(threadId: string, targetTurnId: string) {
    await this.ensureThreadLoaded(threadId);

    const currentRecord = this.snapshot.threads.find(
      (entry) => entry.thread.id === threadId,
    );
    if (!currentRecord) {
      throw new Error("Thread not found.");
    }

    if (currentRecord.thread.turns.some((turn) => turn.status === "inProgress")) {
      throw new Error("Wait for the current response to finish before rolling back.");
    }

    const completedTurns = stripOptimisticTurns(currentRecord.thread.turns).filter(
      (turn) => turn.status !== "inProgress",
    );
    const rollbackStartIndex = completedTurns.findIndex(
      (turn) => turn.id === targetTurnId,
    );
    if (rollbackStartIndex === -1) {
      throw new Error("The selected turn can no longer be rolled back.");
    }
    const turnsToRollback = completedTurns.slice(rollbackStartIndex);

    if (turnsToRollback.length === 0) {
      throw new Error("There is no completed turn to roll back.");
    }

    const rollbackRoot =
      currentRecord.thread.cwd.trim() || this.snapshot.directoryCatalogRoot?.trim() || "";
    const fileChangeItems = turnsToRollback
      .slice()
      .reverse()
      .flatMap((turn) =>
        turn.items
          .filter(
            (item): item is Extract<ThreadItem, { type: "fileChange" }> =>
              item.type === "fileChange" && item.status === "completed",
          )
          .slice()
          .reverse(),
      );

    if (fileChangeItems.length > 0) {
      if (!rollbackRoot) {
        throw new Error("Rollback requires a local working directory for this thread.");
      }

      for (const item of fileChangeItems) {
        for (const change of item.changes.slice().reverse()) {
          await this.rollbackLocalFileChange(rollbackRoot, change);
        }
      }
    }

    const response = await this.request<ThreadRollbackResponse>(
      "thread/rollback",
      {
        threadId,
        numTurns: turnsToRollback.length,
      },
    );

    this.mutate((snapshot) => {
      const existingRecord = snapshot.threads.find(
        (entry) => entry.thread.id === threadId,
      );
      if (!existingRecord) {
        return;
      }

      const nextTurns = sortTurnsById(
        response.thread.turns.map((turn) =>
          mergeIncomingTurn(
            turn,
            existingRecord.thread.turns.find((entry) => entry.id === turn.id),
          ),
        ),
      );
      const nextThread: Thread = {
        ...existingRecord.thread,
        ...response.thread,
        cwd: rollbackRoot || response.thread.cwd || existingRecord.thread.cwd,
        turns: nextTurns,
      };

      updateThreadRecord(snapshot, threadId, (record) => ({
        ...record,
        thread: nextThread,
        steers: (record.steers ?? []).filter((entry) =>
          nextTurns.some((turn) => turn.id === entry.turnId),
        ),
        approvals: record.approvals.filter(
          (approval) =>
            !approval.turnId || nextTurns.some((turn) => turn.id === approval.turnId),
        ),
        review: parseReviewFindings(nextThread),
      }));
    });
  }

  async resolveApproval(requestId: string, decision: ApprovalDecision) {
    const request = this.approvalMap.get(requestId);
    if (!request) {
      return;
    }

    if (request.method === "item/commandExecution/requestApproval") {
      this.respond(request.rawRequestId, {
        decision,
      });
    }

    if (request.method === "item/fileChange/requestApproval") {
      this.respond(request.rawRequestId, {
        decision,
      });
    }

    if (request.method === "item/permissions/requestApproval") {
      this.respond(request.rawRequestId, {
        permissions:
          decision === "accept" || decision === "acceptForSession"
            ? (request.params.permissions ?? {})
            : {},
        scope: decision === "acceptForSession" ? "session" : "turn",
      });
    }

    if (request.method === "execCommandApproval" || request.method === "applyPatchApproval") {
      this.respond(request.rawRequestId, {
        decision: legacyReviewDecisionFromApprovalDecision(decision),
      });
    }

    this.mutate((snapshot) => {
      const threadId = safeString(
        request.params.threadId,
        safeString(request.params.conversationId),
      );
      const record = snapshot.threads.find((entry) => entry.thread.id === threadId);
      if (!record) {
        return;
      }

      record.approvals = record.approvals.map((approval) =>
        approval.id === requestId
          ? {
              ...approval,
              state: approvalStateFromDecision(decision),
            }
          : approval,
      );
    });
  }

  async submitQuestion(
    requestId: string,
    answers: QuestionAnswerPayload,
  ) {
    const request = this.approvalMap.get(requestId);
    if (!request) {
      return;
    }

    const threadId = safeString(request.params.threadId);
    const storageKeys = buildPendingQuestionStorageKeys({
      threadId,
      turnId: safeString(request.params.turnId) || null,
      itemId: safeString(request.params.itemId) || null,
      requestId,
      questions: normalizeQuestionStorageQuestions(request.params.questions),
    });

    writeStoredPendingQuestionAnswersForKeys(
      storageKeys,
      Object.keys(answers).length > 0 ? answers : null,
    );

    this.respond(request.rawRequestId, {
      answers,
    });

    this.approvalMap.set(requestId, {
      ...request,
      responded: true,
    });

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, threadId, (record) => {
        const approvals = record.approvals.filter((approval) => approval.id !== requestId);
        const hasPendingApprovals = approvals.some((approval) => approval.state === "pending");
        const nextStatus =
          record.thread.status.type === "active" && !hasPendingApprovals
            ? {
                ...record.thread.status,
                activeFlags: record.thread.status.activeFlags.filter(
                  (flag) => flag !== "waitingOnApproval" && flag !== "waitingOnUserInput",
                ),
              }
            : record.thread.status;

        return {
          ...record,
          approvals,
          thread: {
            ...record.thread,
            status: nextStatus,
          },
        };
      });
    });

    if (threadId && !isLocalProviderThreadId(threadId)) {
      globalThis.setTimeout(() => {
        void this.resumeThread(threadId, true).catch(() => undefined);
      }, 400);
    }
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

    this.respond(request.rawRequestId, {
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
      const permissionsSummary = summarizeAdditionalPermissions(commandParams.additionalPermissions);
      return {
        id: requestId,
        kind: "command",
        title: "Approve command execution",
        detail: commandParams.reason ?? "The agent is requesting permission to run a command.",
        risk:
          commandParams.networkApprovalContext || permissionsSummary.length > 0 ? "high" : "medium",
        state: "pending",
        threadId: commandParams.threadId,
        turnId: commandParams.turnId,
        itemId: commandParams.itemId,
        method,
        command: commandParams.command ?? undefined,
        cwd: commandParams.cwd ?? undefined,
        availableDecisions: normalizeApprovalDecisionList(commandParams.availableDecisions, [
          "accept",
          "decline",
        ]),
        permissionsSummary:
          permissionsSummary.length > 0 ? permissionsSummary : undefined,
      };
    }

    if (method === "item/fileChange/requestApproval") {
      const fileParams = params as unknown as FileChangeRequestApprovalParams;
      return {
        id: requestId,
        kind: "patch",
        title: "Approve file changes",
        detail: fileParams.reason ?? "The agent is requesting write access for file updates.",
        risk: fileParams.grantRoot ? "high" : "medium",
        state: "pending",
        threadId: fileParams.threadId,
        turnId: fileParams.turnId,
        itemId: fileParams.itemId,
        method,
        files: fileParams.grantRoot ? [fileParams.grantRoot] : undefined,
        availableDecisions: fileParams.grantRoot
          ? ["accept", "acceptForSession", "decline"]
          : ["accept", "decline"],
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
      const permissionsParams = params as unknown as { permissions?: AdditionalPermissionProfile | null };
      const permissionsSummary = summarizeAdditionalPermissions(permissionsParams.permissions);
      return {
        id: requestId,
        kind: "permissions",
        title: "Approve additional permissions",
        detail: safeString(params.reason, "The agent requested additional permissions."),
        risk: "high",
        state: "pending",
        threadId: safeString(params.threadId),
        turnId: safeString(params.turnId),
        itemId: safeString(params.itemId),
        method,
        availableDecisions: ["accept", "decline"],
        permissionsSummary:
          permissionsSummary.length > 0 ? permissionsSummary : undefined,
      };
    }

    if (method === "execCommandApproval") {
      const commandParams = params as {
        approvalId?: string | null;
        callId?: string | null;
        command?: Array<string>;
        conversationId?: string;
        cwd?: string | null;
        reason?: string | null;
      };

      return {
        id: requestId,
        kind: "command",
        title: "Approve command execution",
        detail:
          safeString(commandParams.reason) ||
          "The agent is requesting permission to run a command.",
        risk: "medium",
        state: "pending",
        threadId: safeString(commandParams.conversationId),
        turnId: null,
        itemId: safeString(commandParams.approvalId, safeString(commandParams.callId)) || null,
        method,
        command: commandArrayToString(commandParams.command),
        cwd: safeString(commandParams.cwd) || undefined,
        availableDecisions: ["accept", "acceptForSession", "decline"],
      };
    }

    if (method === "applyPatchApproval") {
      const patchParams = params as {
        callId?: string | null;
        conversationId?: string;
        fileChanges?: Record<string, unknown> | null;
        grantRoot?: string | null;
        reason?: string | null;
      };
      const files = [
        ...Object.keys(patchParams.fileChanges ?? {}),
        ...(safeString(patchParams.grantRoot) ? [safeString(patchParams.grantRoot)] : []),
      ];

      return {
        id: requestId,
        kind: "patch",
        title: "Approve file changes",
        detail:
          safeString(patchParams.reason) ||
          "The agent is requesting write access for file updates.",
        risk: patchParams.grantRoot ? "high" : "medium",
        state: "pending",
        threadId: safeString(patchParams.conversationId),
        turnId: null,
        itemId: safeString(patchParams.callId) || null,
        method,
        files: files.length > 0 ? [...new Set(files)] : undefined,
        availableDecisions: patchParams.grantRoot
          ? ["accept", "acceptForSession", "decline"]
          : ["accept", "decline"],
      };
    }

    return null;
  }

  private handleServerRequest(
    requestId: string,
    rawRequestId: RequestId,
    method: string,
    params: Record<string, unknown>,
  ) {
    const approval = this.buildApproval(requestId, method, params);
    if (!approval || !approval.threadId) {
      return;
    }

    this.approvalMap.set(approval.id, {
      rawRequestId,
      method,
      params,
      responded: false,
    });

    if (method === "item/tool/requestUserInput") {
      const storedAnswers = readStoredPendingQuestionAnswerByKeys(
        buildPendingQuestionStorageKeys({
          threadId: approval.threadId,
          turnId: approval.turnId,
          itemId: approval.itemId,
          requestId,
          questions: approval.questions,
        }),
      );
      if (storedAnswers) {
        globalThis.setTimeout(() => {
          void this.submitQuestion(requestId, storedAnswers).catch(() => undefined);
        }, 0);
        return;
      }
    }

    this.mutate((snapshot) => {
      updateThreadRecord(snapshot, approval.threadId!, (record) => ({
        ...record,
        approvals: [approval, ...record.approvals.filter((entry) => entry.id !== approval.id)],
        thread: {
          ...record.thread,
          status: {
            type: "active",
            activeFlags: [
              method === "item/tool/requestUserInput"
                ? "waitingOnUserInput"
                : "waitingOnApproval",
            ],
          },
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

      case "thread/archived":
      case "thread/closed": {
        const threadId = safeString(params.threadId);
        this.forgetThreadState(threadId);
        this.mutate((snapshot) => {
          removeThreadRecord(snapshot, threadId);
          snapshot.streams = snapshot.streams.filter((entry) => entry.threadId !== threadId);
        });
        return;
      }

      case "thread/unarchived": {
        void this.refreshThreads().catch(() => undefined);
        return;
      }

      case "thread/status/changed": {
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => {
            const incomingStatus = params.status as Thread["status"];
            const waitingFlags =
              incomingStatus.type === "active"
                ? incomingStatus.activeFlags.filter(
                    (flag) => flag === "waitingOnApproval" || flag === "waitingOnUserInput",
                  )
                : [];
            const hasVisiblePendingApprovals = record.approvals.some(
              (approval) => approval.state === "pending",
            );
            const hasUnansweredServerRequests =
              waitingFlags.length > 0 &&
              [...this.approvalMap.values()].some(
                (request) =>
                  safeString(request.params.threadId) === record.thread.id &&
                  request.responded !== true,
              );

            const nextStatus =
              incomingStatus.type === "active" &&
              waitingFlags.length > 0 &&
              !hasVisiblePendingApprovals &&
              !hasUnansweredServerRequests
                ? {
                    ...incomingStatus,
                    activeFlags: incomingStatus.activeFlags.filter(
                      (flag) =>
                        flag !== "waitingOnApproval" && flag !== "waitingOnUserInput",
                    ),
                  }
                : incomingStatus;

            return {
              ...record,
              thread: {
                ...record.thread,
                status: nextStatus,
              },
            };
          });
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
              let optimisticUserMessage: Extract<ThreadItem, { type: "userMessage" }> | undefined;
              if (item.type === "userMessage") {
                for (let index = items.length - 1; index >= 0; index -= 1) {
                  if (isOptimisticUserMessage(items[index])) {
                    optimisticUserMessage = items[index] as Extract<ThreadItem, { type: "userMessage" }>;
                    items.splice(index, 1);
                  }
                }
              }

              let nextItem = item;
              if (item.type === "userMessage" && optimisticUserMessage) {
                nextItem = mergeIncomingItem(item, optimisticUserMessage);
              }
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
              terminals: mergeTerminalsForThread(
                {
                  ...record.thread,
                  turns,
                },
                record.terminals,
              ),
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
              terminals: mergeTerminalsForThread(nextThread, record.terminals),
            };
          });
        });
        return;
      }

      case "command/exec/outputDelta": {
        const processId = safeString(params.processId);
        const stream = params.stream === "stderr" ? "stderr" : "stdout";
        const deltaBase64 = safeString(params.deltaBase64);

        if (!processId || !deltaBase64) {
          return;
        }

        if (this.providerAuthRuns.has(processId)) {
          this.appendProviderAuthOutput(processId, stream, deltaBase64);
          return;
        }

        if (this.externalProviderRuns.has(processId)) {
          const decoded = this.decodeStandaloneTerminalChunk(
            processId,
            stream,
            deltaBase64,
          );
          const meta = this.externalProviderRuns.get(processId);
          if (!meta) {
            return;
          }

          if (stream === "stderr") {
            meta.stderr = `${meta.stderr}${decoded}`;
          } else {
            this.appendExternalProviderDelta(
              meta.threadId,
              meta.turnId,
              meta.itemId,
              decoded,
              true,
            );
          }
          return;
        }

        const decoded = this.decodeStandaloneTerminalChunk(processId, stream, deltaBase64);
        this.updateStandaloneTerminalLog(processId, decoded);
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
        const request = this.approvalMap.get(requestId);
        if (request && request.method === "item/tool/requestUserInput") {
          writeStoredPendingQuestionAnswersForKeys(
            buildPendingQuestionStorageKeys({
              threadId: safeString(request.params.threadId),
              turnId: safeString(request.params.turnId) || null,
              itemId: safeString(request.params.itemId) || null,
              requestId,
              questions: normalizeQuestionStorageQuestions(request.params.questions),
            }),
            null,
          );
        }
        this.approvalMap.delete(requestId);
        this.mutate((snapshot) => {
          updateThreadRecord(snapshot, safeString(params.threadId), (record) => {
            const approvals = record.approvals.filter((approval) => approval.id !== requestId);
            const hasPendingApprovals = approvals.some((approval) => approval.state === "pending");
            const nextStatus =
              record.thread.status.type === "active" && !hasPendingApprovals
                ? {
                    ...record.thread.status,
                    activeFlags: record.thread.status.activeFlags.filter(
                      (flag) => flag !== "waitingOnApproval" && flag !== "waitingOnUserInput",
                    ),
                  }
                : record.thread.status;

            return {
              ...record,
              approvals,
              thread: {
                ...record.thread,
                status: nextStatus,
              },
            };
          });
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
