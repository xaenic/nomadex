import type { ThreadItem } from "../protocol/v2";
import type {
  ComposerFile,
  ComposerImage,
  DashboardData,
  MentionAttachment,
  SettingsState,
  SkillCard,
  WorkspaceMode,
} from "./mockData";

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
  resumeThread: (threadId: string) => Promise<void>;
  interruptTurn: (threadId: string) => Promise<boolean>;
  sendComposer: (
    args: ComposerPayload & {
      threadId: string;
      mode: WorkspaceMode;
      settings: SettingsState;
    },
  ) => Promise<void>;
  applySteer: (args: ComposerPayload & { threadId: string }) => Promise<boolean>;
  searchMentions: (cwd: string, query: string) => Promise<void>;
  loadDirectory: (cwd: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  saveFile: (path: string, content: string) => Promise<void>;
  readGitGraph: (cwd: string, limit?: number) => Promise<string>;
  readGitStatus: (cwd: string) => Promise<string>;
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
  resolveApproval: (requestId: string, approved: boolean) => Promise<void>;
  submitQuestion: (requestId: string, answers: string[]) => Promise<void>;
  submitMcp: (
    requestId: string,
    action: "accept" | "decline" | "cancel",
    contentText: string,
  ) => Promise<void>;
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
