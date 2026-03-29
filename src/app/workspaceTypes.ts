import type { ThreadItem } from "../protocol/v2";
import type {
  ApprovalDecision,
  ComposerFile,
  ComposerImage,
  DashboardData,
  MentionAttachment,
  ProviderAuthFlow,
  SettingsState,
  SkillCard,
  WorkspaceMode,
} from "./mockData";
import type { ProviderId } from "./services/providers";

export type UiApprovalMode = "auto" | "ro" | "fa";
export type UiThemeId =
  | "void"
  | "ember"
  | "plasma"
  | "arctic"
  | "crimson"
  | "matrix"
  | "solar"
  | "midnight";

export type UiThemeOption = {
  id: UiThemeId;
  name: string;
  description: string;
  mode: "dark" | "light";
  themeColor: string;
  swatches: [string, string, string];
};

export type QuestionAnswerPayload = Record<
  string,
  {
    answers: string[];
  }
>;

export type PanelTab = "files" | "graph" | "diff" | "terminal" | "agents" | "config";
export type QuickMode = "slash" | "mention" | "skill";
export type RouteSection =
  | "chat"
  | "editor"
  | "ops"
  | "agents"
  | "review"
  | "skills"
  | "mcp"
  | "settings";

export const HIDDEN_ADMIN_ROUTE_SEGMENT = "@dm1n-acce$$";

export const ROUTE_SECTION_SEGMENTS: Record<RouteSection, string> = {
  chat: "chat",
  editor: "editor",
  ops: "ops",
  agents: "agents",
  review: "review",
  skills: "skills",
  mcp: "mcp",
  settings: HIDDEN_ADMIN_ROUTE_SEGMENT,
};

export const ROUTE_SECTION_VALUES: Array<RouteSection> = [
  "chat",
  "editor",
  "ops",
  "agents",
  "review",
  "skills",
  "mcp",
  "settings",
];

export const isRouteSection = (value: string | null | undefined): value is RouteSection =>
  typeof value === "string" && ROUTE_SECTION_VALUES.includes(value as RouteSection);

export const routeSectionToSegment = (section: RouteSection) =>
  ROUTE_SECTION_SEGMENTS[section];

export const routeSegmentToSection = (
  value: string | null | undefined,
): RouteSection | null => {
  if (typeof value !== "string") {
    return null;
  }

  const matchedEntry = Object.entries(ROUTE_SECTION_SEGMENTS).find(
    ([, segment]) => segment === value,
  );
  return (matchedEntry?.[0] as RouteSection | undefined) ?? null;
};
export type ToastTone = "" | "ok" | "warn" | "err";

export type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

export type ComposerPayload = {
  prompt: string;
  mentions: Array<MentionAttachment>;
  skills: Array<SkillCard>;
  images: Array<ComposerImage>;
  files: Array<ComposerFile>;
};

export type QueuedComposerMessage = ComposerPayload & {
  id: string;
  mode: WorkspaceMode;
};

export type WorkspaceActions = {
  createThread: (
    settings: SettingsState,
    options?: {
      title?: string;
      cwd?: string;
    },
  ) => Promise<string>;
  refreshThreads: () => Promise<void>;
  resumeThread: (threadId: string) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  interruptTurn: (threadId: string) => Promise<boolean>;
  sendComposer: (
    args: ComposerPayload & {
      threadId: string;
      mode: WorkspaceMode;
      settings: SettingsState;
    },
  ) => Promise<string>;
  applySteer: (args: ComposerPayload & { threadId: string }) => Promise<boolean>;
  searchMentions: (cwd: string, query: string) => Promise<void>;
  loadDirectory: (cwd: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  saveFile: (path: string, content: string) => Promise<void>;
  readGitGraph: (cwd: string, limit?: number) => Promise<string>;
  readGitStatus: (cwd: string) => Promise<string>;
  readWorkspaceCommitPreferences: (
    cwd: string,
  ) => Promise<{ provider: ProviderId; filePath: string }>;
  writeWorkspaceCommitPreferences: (
    cwd: string,
    patch: { provider?: ProviderId },
  ) => Promise<{ provider: ProviderId; filePath: string }>;
  generateCommitMessage: (args: {
    cwd: string;
    providerId: ProviderId;
  }) => Promise<string>;
  commitWorkingTree: (args: {
    cwd: string;
    message: string;
  }) => Promise<{ summary: string; sha: string | null; stagedAll: boolean }>;
  checkProviderSetup: (providerId?: SettingsState["provider"]) => Promise<void>;
  startProviderAuth: (
    providerId?: SettingsState["provider"],
    flow?: ProviderAuthFlow,
  ) => Promise<void>;
  submitProviderAuthSecret: (
    providerId: SettingsState["provider"] | undefined,
    secret: string,
  ) => Promise<void>;
  cancelProviderAuth: (providerId?: SettingsState["provider"]) => Promise<void>;
  switchProviderAccount: (
    providerId?: SettingsState["provider"],
    flow?: ProviderAuthFlow,
  ) => Promise<void>;
  updateSettings: (patch: Partial<SettingsState>) => Promise<void>;
  toggleFeatureFlag: (name: string) => Promise<void>;
  toggleInstalledSkill: (skillId: string) => Promise<void>;
  installSkill: (skillId: string) => Promise<void>;
  toggleMcpAuth: (serverName: string) => Promise<void>;
  startChatGptLogin: () => Promise<string | null>;
  completeChatGptLogin: (callbackUrl: string) => Promise<void>;
  loginWithApiKey: (apiKey: string) => Promise<void>;
  logoutAccount: () => Promise<void>;
  refreshAccount: () => Promise<void>;
  cleanTerminals: (threadId: string) => Promise<void>;
  startProjectTerminal: (threadId: string, cwd: string) => Promise<string>;
  sendTerminalInput: (threadId: string, terminalId: string, input: string) => Promise<void>;
  terminateTerminal: (threadId: string, terminalId: string) => Promise<void>;
  resolveApproval: (requestId: string, decision: ApprovalDecision) => Promise<void>;
  submitQuestion: (
    requestId: string,
    answers: QuestionAnswerPayload,
  ) => Promise<void>;
  submitMcp: (
    requestId: string,
    action: "accept" | "decline" | "cancel",
    contentText: string,
  ) => Promise<void>;
  rollbackToTurn: (threadId: string, targetTurnId: string) => Promise<void>;
  forkThread: (threadId: string) => Promise<string>;
  compactThread: (threadId: string) => Promise<void>;
};

export type WorkspaceContextValue = {
  snapshot: DashboardData;
  actions: WorkspaceActions;
};

export type ParsedRoute = {
  threadId: string | null;
  section: RouteSection;
};

export type QuickEntry = {
  id: string;
  label: string;
  description: string;
  mode: QuickMode;
  value: string;
};

export type FilePreviewState = {
  path: string;
  name: string;
  content: string;
  loading: boolean;
  error: string | null;
  line: number | null;
};

export type FileChangeItem = Extract<ThreadItem, { type: "fileChange" }>;
export type FileChangeDiff = FileChangeItem["changes"][number];

export type DiffReviewEntry = {
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

export type DiffReviewLine = {
  id: string;
  kind: "meta" | "hunk" | "add" | "rem" | "ctx";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export type ComposerHighlightSegment = {
  text: string;
  mention: MentionAttachment | null;
};

export type GitActivityGraphLane = {
  id: string;
  label: string;
  accent: string;
  emphasis: "base" | "active" | "peer";
};

export type GitActivityGraphRef = {
  id: string;
  label: string;
  kind: "head" | "local" | "remote" | "tag" | "other";
  active: boolean;
};

export type GitWorkingTreeEntry = {
  id: string;
  path: string;
  originalPath: string | null;
  badge: string;
  kind: "add" | "update" | "delete" | "rename" | "copy" | "type" | "conflict" | "unknown";
};

export type GitWorkingTreeBucket = {
  id: "staged" | "unstaged" | "untracked" | "conflicted";
  label: string;
  entries: Array<GitWorkingTreeEntry>;
};

export type GitWorkingTreeState = {
  dirty: boolean;
  summary: string;
  buckets: Array<GitWorkingTreeBucket>;
};

export type GitActivityGraphRow = {
  id: string;
  graph: string;
  subject: string;
  dateLabel: string;
  author: string;
  sha: string;
  refs: Array<GitActivityGraphRef>;
  emphasis: "current" | "normal" | "muted";
  threadId: string | null;
  hint: string | null;
};

export type GitActivityGraphModel = {
  repoLabel: string;
  branchLabel: string;
  commitLabel: string | null;
  graphWidth: number;
  source: "git" | "session";
  lanes: Array<GitActivityGraphLane>;
  rows: Array<GitActivityGraphRow>;
  workingTree: GitWorkingTreeState | null;
};
