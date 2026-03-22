import type { Thread, ThreadItem, Turn, TurnError } from "../protocol/v2";
import { getUserMessageDisplay } from "./services/presentation/workspacePresentationService";
import {
  activeProviderAdapter,
  buildProviderOptimisticUploadPath,
} from "./services/providers";
import {
  createFallbackDashboardData,
  type ComposerFile,
  type DashboardData,
  type MentionAttachment,
  type SettingsState,
  type StreamSpec,
  type ThreadRecord,
} from "./mockData";
import type {
  ComposerHighlightSegment,
  DiffReviewLine,
  FileChangeDiff,
  PanelTab,
  ParsedRoute,
  RouteSection,
  UiApprovalMode,
  UiThemeId,
  UiThemeOption,
} from "./workspaceTypes";

const FALLBACK_MENTIONS = createFallbackDashboardData().mentionCatalog;
const OMIT_DIRECTORY_NAMES = new Set([".git", "node_modules"]);
export const DEFAULT_UI_THEME_ID: UiThemeId = "void";
export const UI_THEME_STORAGE_KEY = "nomadex-ui-theme";

export const APPROVAL_ORDER: Array<UiApprovalMode> = ["auto", "ro", "fa"];

export const APPROVAL_LABELS: Record<UiApprovalMode, string> = {
  auto: "Auto",
  ro: "Read-only",
  fa: "Full Access",
};

export const APPROVAL_CLASS: Record<UiApprovalMode, string> = {
  auto: "auto",
  ro: "ro",
  fa: "fa",
};

export const PANEL_TITLE: Record<PanelTab, string> = {
  files: "Files",
  graph: "Branches",
  diff: "Diff",
  terminal: "Terminal",
  agents: "Agents",
  config: "Config",
};

export const QUICK_HINTS = {
  slash:
    "Ask Nomadex… / for slash commands · @ mention · $ skills · ! shell · Ctrl+G editor",
  mention: "Attach a file or folder to the conversation",
  skill: "Attach an installed or marketplace skill",
} as const;

export const SLASH_COMMANDS: Array<{ cmd: string; dsc: string }> = [
  { cmd: "/permissions", dsc: "Switch Auto, Read-only, or Full Access approval mode" },
  { cmd: "/apps", dsc: "Browse connectors and insert $app-slug into the prompt" },
  { cmd: "/compact", dsc: "Summarize the conversation and free context" },
  { cmd: "/diff", dsc: "Open the git diff view in the right panel" },
  { cmd: "/exit", dsc: "End the current session" },
  { cmd: "/feedback", dsc: "Send logs and feedback to maintainers" },
  { cmd: "/fork", dsc: "Fork the current session into a new thread" },
  { cmd: "/init", dsc: "Generate AGENTS.md in the workspace" },
  { cmd: "/logout", dsc: "Sign out of the active account" },
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
  { cmd: "/copy", dsc: "Copy the latest assistant response" },
  { cmd: "/skills", dsc: "Open installed and marketplace skills" },
  { cmd: "/status", dsc: "Show model, tokens, approvals, git, and MCP state" },
  { cmd: "/theme", dsc: "Preview and save UI theme variants" },
  { cmd: "/experimental", dsc: "Toggle experimental feature flags" },
];

export const UI_THEME_OPTIONS: Array<UiThemeOption> = [
  {
    id: "void",
    name: "Void",
    description: "Teal-black glass with a cold terminal edge.",
    mode: "dark",
    themeColor: "#17384b",
    swatches: ["#081019", "#3de8c8", "#4a9eff"],
  },
  {
    id: "ember",
    name: "Ember",
    description: "Burnt amber surfaces with warm relay highlights.",
    mode: "dark",
    themeColor: "#4b2616",
    swatches: ["#140c08", "#ff8c42", "#ffcc44"],
  },
  {
    id: "plasma",
    name: "Plasma",
    description: "Electric magenta-violet glow without neon overload.",
    mode: "dark",
    themeColor: "#4b215e",
    swatches: ["#110b18", "#c060ff", "#ff60c0"],
  },
  {
    id: "arctic",
    name: "Arctic",
    description: "Icy cyan layers with cleaner blue signal tones.",
    mode: "dark",
    themeColor: "#163a4f",
    swatches: ["#071523", "#40c8ff", "#40ffcc"],
  },
  {
    id: "crimson",
    name: "Crimson",
    description: "Red-black control room with warmer alert contrast.",
    mode: "dark",
    themeColor: "#4a1d28",
    swatches: ["#140707", "#ff4466", "#ff8844"],
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "Green phosphor palette for a sharper terminal feel.",
    mode: "dark",
    themeColor: "#183720",
    swatches: ["#041007", "#00ff46", "#80ff40"],
  },
  {
    id: "solar",
    name: "Solar",
    description: "Warm light mode with paper-like translucent panes.",
    mode: "light",
    themeColor: "#e8d5bc",
    swatches: ["#f8f4ec", "#e05820", "#d4980a"],
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Muted indigo glass for a calmer late-night shell.",
    mode: "dark",
    themeColor: "#2a3260",
    swatches: ["#0d1020", "#8888ff", "#ff88cc"],
  },
];

export const isUiThemeId = (value: string | null | undefined): value is UiThemeId =>
  UI_THEME_OPTIONS.some((theme) => theme.id === value);

export const getUiThemeOption = (value: string | null | undefined): UiThemeOption =>
  UI_THEME_OPTIONS.find((theme) => theme.id === value) ?? UI_THEME_OPTIONS[0];

export const nextId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const isDesktopViewport = () =>
  typeof window === "undefined" ? true : window.innerWidth >= 768;

export const sortThreads = (threads: Array<ThreadRecord>) =>
  [...threads].sort((left, right) => right.thread.updatedAt - left.thread.updatedAt);

const turnSortWeight = (id: string) =>
  id.startsWith("optimistic-turn:") ? 1 : 0;

export const sortTurnsById = (turns: Array<Turn>) =>
  [...turns].sort((left, right) => {
    const weightDiff = turnSortWeight(left.id) - turnSortWeight(right.id);
    if (weightDiff !== 0) {
      return weightDiff;
    }

    return left.id.localeCompare(right.id);
  });

export const approvalModeFromSettings = (
  settings: SettingsState,
): UiApprovalMode => {
  if (settings.approvalPolicy === "untrusted") {
    return "ro";
  }

  if (settings.approvalPolicy === "never") {
    return "fa";
  }

  return "auto";
};

export const settingsPatchFromApprovalMode = (
  mode: UiApprovalMode,
): Partial<SettingsState> => {
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

export const sectionToPanel = (section: RouteSection): PanelTab | null => {
  switch (section) {
    case "ops":
      return "files";
    case "agents":
      return "agents";
    case "review":
      return "diff";
    case "mcp":
    case "settings":
      return "config";
    default:
      return null;
  }
};

export const panelToSection = (tab: PanelTab): RouteSection => {
  switch (tab) {
    case "files":
    case "graph":
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

export const statusTone = (status: DashboardData["transport"]["status"]) => {
  if (status === "connected") {
    return "gn";
  }

  if (status === "error") {
    return "rd";
  }

  return "yw";
};

export const parseRoute = (pathname: string): ParsedRoute => {
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

export const threadDayGroup = (updatedAt: number) => {
  const updated = new Date(updatedAt * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const value = new Date(
    updated.getFullYear(),
    updated.getMonth(),
    updated.getDate(),
  );
  const days = Math.round((today.getTime() - value.getTime()) / 86400000);

  if (days <= 0) {
    return "Today";
  }

  if (days === 1) {
    return "Yesterday";
  }

  return "Earlier";
};

export const threadLabel = (thread: Thread) =>
  thread.name ?? thread.preview ?? "Untitled Session";

export const formatClock = (value: number) =>
  new Date(value * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export const shorten = (value: string, max = 76) =>
  value.length <= max ? value : `${value.slice(0, max - 3)}...`;

export const formatUploadSize = (bytes: number) =>
  `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const localUploadedFilesToMentions = (
  cwd: string,
  files: Array<ComposerFile>,
): Array<MentionAttachment> =>
  files.map((file) => ({
    id: `upload-${file.id}`,
    name: file.name,
    path: buildProviderOptimisticUploadPath(activeProviderAdapter, cwd, file.name),
    kind: "file",
  }));

export const sortMentionAttachments = (entries: Array<MentionAttachment>) =>
  [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

export const deriveLocalDirectoryCatalog = (cwd: string): Array<MentionAttachment> => {
  const prefix = `${cwd.replace(/\/+$/u, "")}/`;
  const entries = new Map<string, MentionAttachment>();

  FALLBACK_MENTIONS.forEach((entry) => {
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

export const isPathWithinRoot = (root: string, value: string) => {
  const normalizedRoot = root.replace(/\/+$/u, "");
  return value === normalizedRoot || value.startsWith(`${normalizedRoot}/`);
};

export const getUserText = (
  item: Extract<ThreadItem, { type: "userMessage" }>,
) => getUserMessageDisplay(item).text;

export const latestThreadLabel = (record: ThreadRecord) => {
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

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export const mentionInlineLabel = (mention: MentionAttachment) => {
  const baseName = mention.name.split("/").filter(Boolean).at(-1) ?? mention.name;
  return baseName.replace(/\s+/gu, "-");
};

export const mentionInlineToken = (mention: MentionAttachment) =>
  `@${mentionInlineLabel(mention)}`;

export const composerHasMentionToken = (
  value: string,
  mention: MentionAttachment,
) => {
  const token = mentionInlineToken(mention);
  const pattern = new RegExp(
    `(^|\\s)${escapeRegExp(token)}(?=$|\\s|[.,!?;:])`,
    "u",
  );
  return pattern.test(value);
};

export const insertInlineMentionToken = (
  value: string,
  mention: MentionAttachment,
) => {
  const token = mentionInlineToken(mention);
  const tokenQueryPattern = /(?:^|\s)@[^\s]*$/u;
  const hasTokenAlready = composerHasMentionToken(value, mention);

  if (tokenQueryPattern.test(value)) {
    return value.replace(
      tokenQueryPattern,
      (match) => `${match.startsWith(" ") ? " " : ""}${token} `,
    );
  }

  if (hasTokenAlready) {
    return value;
  }

  const spacer = value && !/\s$/u.test(value) ? " " : "";
  return `${value}${spacer}${token} `;
};

export const buildComposerHighlightSegments = (
  value: string,
  mentions: Array<MentionAttachment>,
) => {
  if (!value) {
    return [] as Array<ComposerHighlightSegment>;
  }

  const tokenMap = new Map(
    mentions.map((mention) => [mentionInlineToken(mention), mention]),
  );
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

export type FileAttachmentPreview = {
  badge: string;
  kindLabel: string;
  title: string;
  tone: "archive" | "code" | "document" | "generic" | "media" | "sheet";
};

const basenameFromPath = (value: string) =>
  value.replace(/\\/gu, "/").split("/").filter(Boolean).pop() ?? value;

const fileTitleFromInput = (label: string, path?: string) => {
  const trimmedLabel = label.trim();
  if (trimmedLabel && !trimmedLabel.startsWith("/") && !trimmedLabel.includes("\\")) {
    return trimmedLabel;
  }

  return path ? basenameFromPath(path) : basenameFromPath(trimmedLabel);
};

const extensionFromName = (value: string) => {
  const basename = basenameFromPath(value).trim();
  if (!basename || !basename.includes(".")) {
    return "";
  }

  const extension = basename.split(".").pop()?.toLowerCase() ?? "";
  if (!extension || extension === basename.toLowerCase()) {
    return "";
  }

  return extension;
};

const SHEET_EXTENSIONS = new Set(["csv", "numbers", "ods", "tsv", "xls", "xlsx"]);
const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "md", "mdx", "odt", "pages", "pdf", "ppt", "pptx", "rtf", "txt"]);
const CODE_EXTENSIONS = new Set(["bash", "c", "cpp", "css", "go", "html", "java", "js", "json", "jsx", "kt", "py", "rb", "rs", "scss", "sh", "sql", "toml", "ts", "tsx", "xml", "yaml", "yml", "zsh"]);
const MEDIA_EXTENSIONS = new Set(["ai", "avif", "gif", "heic", "jpeg", "jpg", "m4a", "mkv", "mov", "mp3", "mp4", "png", "psd", "svg", "wav", "webm", "webp"]);
const ARCHIVE_EXTENSIONS = new Set(["7z", "bz2", "gz", "rar", "tar", "tgz", "xz", "zip"]);

const fileToneFromExtension = (extension: string): FileAttachmentPreview["tone"] => {
  if (SHEET_EXTENSIONS.has(extension)) {
    return "sheet";
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return "document";
  }

  if (CODE_EXTENSIONS.has(extension)) {
    return "code";
  }

  if (MEDIA_EXTENSIONS.has(extension)) {
    return "media";
  }

  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return "archive";
  }

  return "generic";
};

const fileKindLabel = (tone: FileAttachmentPreview["tone"]) => {
  switch (tone) {
    case "sheet":
      return "Spreadsheet";
    case "document":
      return "Document";
    case "code":
      return "Code file";
    case "media":
      return "Media file";
    case "archive":
      return "Archive";
    default:
      return "Attachment";
  }
};

const fileBadgeFromExtension = (extension: string, tone: FileAttachmentPreview["tone"]) => {
  if (tone === "sheet") {
    if (extension === "csv" || extension === "tsv") {
      return extension.toUpperCase();
    }
    return "XLS";
  }

  if (tone === "document") {
    if (extension === "pdf") {
      return "PDF";
    }
    if (extension === "ppt" || extension === "pptx") {
      return "PPT";
    }
    return extension ? extension.slice(0, 3).toUpperCase() : "DOC";
  }

  if (tone === "code") {
    if (extension === "json") {
      return "JSON";
    }
    if (extension === "yaml" || extension === "yml") {
      return "YAML";
    }
    return extension ? extension.slice(0, 4).toUpperCase() : "CODE";
  }

  if (tone === "media") {
    if (["mp4", "mov", "webm", "mkv"].includes(extension)) {
      return "VID";
    }
    if (["mp3", "wav", "m4a"].includes(extension)) {
      return "AUD";
    }
    return extension ? extension.slice(0, 3).toUpperCase() : "IMG";
  }

  if (tone === "archive") {
    return extension ? extension.slice(0, 3).toUpperCase() : "ZIP";
  }

  return extension ? extension.slice(0, 4).toUpperCase() : "FILE";
};

export const getFileAttachmentPreview = (
  label: string,
  path?: string,
): FileAttachmentPreview => {
  const title = fileTitleFromInput(label, path);
  const extension = extensionFromName(title || path || "");
  const tone = fileToneFromExtension(extension);

  return {
    badge: fileBadgeFromExtension(extension, tone),
    kindLabel: fileKindLabel(tone),
    title,
    tone,
  };
};

export const attachmentDisplayLabel = (label: string, path: string) => {
  const trimmedLabel = label.trim();
  if (trimmedLabel && !trimmedLabel.startsWith("/") && !trimmedLabel.includes("\\")) {
    return `@${trimmedLabel}`;
  }

  return `@${
    path.replace(/\\/gu, "/").split("/").filter(Boolean).pop() ?? path
  }`;
};

export const isExistingThreadHistoryPending = (
  record: ThreadRecord | null,
  turns: Array<Turn>,
) => {
  if (!record) {
    return false;
  }

  if (turns.length > 0) {
    return false;
  }

  const threadName = record.thread.name?.trim();
  if (
    threadName &&
    threadName !== "New Session" &&
    threadName !== "New Thread" &&
    threadName !== "Untitled Session"
  ) {
    return true;
  }

  return Boolean(record.thread.preview?.trim());
};

export const turnErrorText = (turn: Turn) => {
  if (!turn.error?.message) {
    return "";
  }

  const details = turn.error.additionalDetails?.trim();
  return details ? `${turn.error.message}\n\n${details}` : turn.error.message;
};

export const formatTurnErrorCode = (code: TurnError["codexErrorInfo"] | null) => {
  if (!code) {
    return null;
  }

  if (typeof code === "string") {
    return code;
  }

  return Object.keys(code)[0] ?? null;
};

export const diffEntryId = (
  itemId: string,
  changeIndex: number,
  path: string,
) => `${itemId}:${changeIndex}:${path}`;

export const normalizeDiffPath = (value: string) =>
  value.replace(/^\.?\//u, "").replace(/\\/gu, "/");

export const diffKindLabel = (kind: FileChangeDiff["kind"]) => {
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

export const countDiffStats = (diff: string) => {
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

export const buildDiffReviewLines = (diff: string) => {
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

export const getStreamTarget = (entry: StreamSpec) =>
  entry.visible === 0 ? entry.total : entry.visible;

export const stopStreamsForThreadTurn = (
  draft: DashboardData,
  threadId: string,
  turnId: string,
) => {
  draft.streams = draft.streams.map((entry) =>
    entry.threadId === threadId && entry.turnId === turnId
      ? {
          ...entry,
          total: entry.visible,
        }
      : entry,
  );
};
