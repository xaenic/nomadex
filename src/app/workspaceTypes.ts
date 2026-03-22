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

export type PanelTab = "files" | "diff" | "terminal" | "agents" | "config";
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
