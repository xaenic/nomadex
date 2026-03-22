import type { ThreadItem, Turn, UserInput } from "../../../protocol/v2";
import {
  buildProviderBrowseUrl,
  buildProviderImageUrl,
  getProviderAdapter,
  type ProviderId,
} from "../providers";
import type { ThreadRecord } from "../../mockData";
import type {
  GitActivityGraphLane,
  GitActivityGraphModel,
  GitActivityGraphRef,
  GitActivityGraphRow,
  GitWorkingTreeBucket,
  GitWorkingTreeEntry,
  GitWorkingTreeState,
} from "../../workspaceTypes";

export type UiFileAttachment = {
  label: string;
  path: string;
};

export type TurnFileChangeSummaryEntry = {
  itemId: string;
  path: string;
  kind: "add" | "update" | "delete";
  status: Extract<ThreadItem, { type: "fileChange" }>["status"];
};

export type LocalFileReference = {
  path: string;
  line: number | null;
  browseUrl: string;
};

export type InlineSegment =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "file"; value: string; path: string; line: number | null; displayPath: string; downloadName: string };

export type MessageBlock =
  | { kind: "text"; value: string }
  | { kind: "image"; url: string; alt: string; markdown: string };

export type UserMessageDisplay = {
  text: string;
  images: string[];
  fileAttachments: UiFileAttachment[];
};

export type UiLiveOverlay = {
  activityLabel: string;
  activityDetails: string[];
  activityTone:
    | "thinking"
    | "writing"
    | "command"
    | "editing"
    | "tool"
    | "agent"
    | "search"
    | "image"
    | "error";
  statusText: string;
  reasoningText: string;
  errorText: string;
};

const FILE_ATTACHMENT_LINE = /^##\s+(.+?):\s+(.+?)\s*$/;
const FILES_MENTIONED_MARKER = /^#\s*files mentioned by the user\s*:?\s*$/i;

function getBasename(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  const name = normalized.split("/").filter(Boolean).pop();
  return name || pathValue;
}

function isFilePath(value: string): boolean {
  if (!value || /\s/u.test(value)) return false;
  if (value.endsWith("/") || value.endsWith("\\")) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)) return false;

  const looksLikeUnixAbsolute = value.startsWith("/");
  const looksLikeWindowsAbsolute = /^[A-Za-z]:[\\/]/u.test(value);
  const looksLikeRelative = value.startsWith("./") || value.startsWith("../") || value.startsWith("~/");
  const hasPathSeparator = value.includes("/") || value.includes("\\");
  return looksLikeUnixAbsolute || looksLikeWindowsAbsolute || looksLikeRelative || hasPathSeparator;
}

function parseFileReference(value: string): { path: string; line: number | null } | null {
  if (!value) return null;

  let pathValue = value;
  let line: number | null = null;

  const hashLineMatch = pathValue.match(/^(.*)#L(\d+)(?:C\d+)?$/u);
  if (hashLineMatch) {
    pathValue = hashLineMatch[1];
    line = Number(hashLineMatch[2]);
  } else {
    const colonLineMatch = pathValue.match(/^(.*):(\d+)(?::\d+)?$/u);
    if (colonLineMatch) {
      pathValue = colonLineMatch[1];
      line = Number(colonLineMatch[2]);
    }
  }

  if (!isFilePath(pathValue)) return null;
  return { path: pathValue, line };
}

const looksLikeAbsolutePath = (candidate: string): boolean =>
  candidate.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(candidate);

export function resolveLocalFileReference(
  value: string,
  providerId?: ProviderId,
): LocalFileReference | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const adapter = getProviderAdapter(providerId);
  const parsed = parseFileReference(normalized);
  if (!parsed?.path || !looksLikeAbsolutePath(parsed.path)) {
    return null;
  }

  return {
    path: parsed.path,
    line: parsed.line,
    browseUrl: buildProviderBrowseUrl(adapter, parsed.path),
  };
}

function formatFileReferenceLabel(pathValue: string, line: number | null): string {
  const base = getBasename(pathValue);
  if (line === null) {
    return base;
  }

  return `${base}:${String(line)}`;
}

function parseMarkdownFileLinkSegments(value: string): InlineSegment[] {
  if (!value.includes("[") || !value.includes("](")) {
    return [{ kind: "text", value }];
  }

  const segments: InlineSegment[] = [];
  const markdownLinkRegex = /\[([^\]\n]+)\]\(([^)\n]+)\)/gu;
  let cursor = 0;

  for (const match of value.matchAll(markdownLinkRegex)) {
    const fullMatch = match[0];
    const label = match[1]?.trim() ?? "";
    const hrefRaw = match[2]?.trim() ?? "";
    const start = match.index ?? -1;
    if (start < 0) {
      continue;
    }

    if (start > cursor) {
      segments.push({ kind: "text", value: value.slice(cursor, start) });
    }

    const fileReference = parseFileReference(hrefRaw);
    if (fileReference) {
      segments.push({
        kind: "file",
        value: label || hrefRaw,
        path: fileReference.path,
        line: fileReference.line,
        displayPath: formatFileReferenceLabel(fileReference.path, fileReference.line),
        downloadName: getBasename(fileReference.path),
      });
    } else {
      segments.push({ kind: "text", value: fullMatch });
    }

    cursor = start + fullMatch.length;
  }

  if (cursor < value.length) {
    segments.push({ kind: "text", value: value.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ kind: "text", value }];
}

function pushTextSegments(segments: InlineSegment[], value: string) {
  parseMarkdownFileLinkSegments(value).forEach((segment) => {
    if (segment.kind === "text" && segment.value.length === 0) {
      return;
    }

    segments.push(segment);
  });
}

function extractFileAttachments(value: string): UiFileAttachment[] {
  const markerIdx = value.split("\n").findIndex((line) => FILES_MENTIONED_MARKER.test(line.trim()));
  if (markerIdx < 0) return [];
  const lines = value.split("\n").slice(markerIdx + 1);
  const attachments: UiFileAttachment[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(FILE_ATTACHMENT_LINE);
    if (!match) break;
    const label = match[1]?.trim();
    const path = match[2]?.trim().replace(/\s+\((?:lines?\s+\d+(?:-\d+)?)\)\s*$/, "");
    if (label && path) {
      const key = `${label.toLowerCase()}:${path}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      attachments.push({ label, path });
    }
  }

  return attachments;
}

function isTransientImageReference(value: string): boolean {
  return value.startsWith("blob:") || value.startsWith("data:");
}

function extractUserRequestText(value: string, providerId?: ProviderId): string {
  const markerRegex = getProviderAdapter(providerId).requestMarkerPattern;
  const matches = Array.from(value.matchAll(markerRegex));
  if (matches.length === 0) {
    return value.trim();
  }

  const lastMatch = matches.at(-1);
  if (!lastMatch || typeof lastMatch.index !== "number") {
    return value.trim();
  }

  const markerOffset = lastMatch.index + lastMatch[0].length;
  return value.slice(markerOffset).trim();
}

export function getUserMessageDisplay(
  item: Extract<ThreadItem, { type: "userMessage" }>,
  providerId?: ProviderId,
): UserMessageDisplay {
  const textChunks: string[] = [];
  const imageCandidates: string[] = [];

  for (const block of item.content as UserInput[]) {
    if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      textChunks.push(block.text);
    }

    if (block.type === "image" && typeof block.url === "string" && block.url.trim().length > 0) {
      imageCandidates.push(block.url.trim());
    }

    if (block.type === "localImage" && typeof block.path === "string" && block.path.trim().length > 0) {
      imageCandidates.push(block.path.trim());
    }
  }

  const persistedImages = imageCandidates.filter((image) => !isTransientImageReference(image));
  const images = [...new Set(persistedImages.length > 0 ? persistedImages : imageCandidates)];
  const fullText = textChunks.join("\n");
  return {
    text: extractUserRequestText(fullText, providerId),
    images,
    fileAttachments: extractFileAttachments(fullText),
  };
}

export function parseInlineSegments(text: string): InlineSegment[] {
  if (!text.includes("`")) {
    return parseMarkdownFileLinkSegments(text);
  }

  const segments: InlineSegment[] = [];
  let cursor = 0;
  let textStart = 0;

  while (cursor < text.length) {
    if (text[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    let openLength = 1;
    while (cursor + openLength < text.length && text[cursor + openLength] === "`") {
      openLength += 1;
    }
    const delimiter = "`".repeat(openLength);

    let searchFrom = cursor + openLength;
    let closingStart = -1;
    while (searchFrom < text.length) {
      const candidate = text.indexOf(delimiter, searchFrom);
      if (candidate < 0) break;

      const hasBacktickBefore = candidate > 0 && text[candidate - 1] === "`";
      const hasBacktickAfter = candidate + openLength < text.length && text[candidate + openLength] === "`";
      const hasNewLineInside = text.slice(cursor + openLength, candidate).includes("\n");

      if (!hasBacktickBefore && !hasBacktickAfter && !hasNewLineInside) {
        closingStart = candidate;
        break;
      }
      searchFrom = candidate + 1;
    }

    if (closingStart < 0) {
      cursor += openLength;
      continue;
    }

    if (cursor > textStart) {
      pushTextSegments(segments, text.slice(textStart, cursor));
    }

    const token = text.slice(cursor + openLength, closingStart);
    if (token.length > 0) {
      const fileReference = parseFileReference(token);
      if (fileReference) {
        const displayPath = formatFileReferenceLabel(
          fileReference.path,
          fileReference.line,
        );
        segments.push({
          kind: "file",
          value: token,
          path: fileReference.path,
          line: fileReference.line,
          displayPath,
          downloadName: getBasename(fileReference.path),
        });
      } else {
        segments.push({ kind: "code", value: token });
      }
    } else {
      segments.push({ kind: "text", value: `${delimiter}${delimiter}` });
    }

    cursor = closingStart + openLength;
    textStart = cursor;
  }

  if (textStart < text.length) {
    pushTextSegments(segments, text.slice(textStart));
  }

  return segments;
}

export function toRenderableImageUrl(value: string, providerId?: ProviderId): string {
  const normalized = value.trim();
  if (!normalized) return "";
  const adapter = getProviderAdapter(providerId);
  if (
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith(`${adapter.localImagePath}?`)
  ) {
    return normalized;
  }

  if (normalized.startsWith("file://")) {
    return buildProviderImageUrl(adapter, normalized);
  }

  const looksLikeUnixAbsolute = normalized.startsWith("/");
  const looksLikeWindowsAbsolute = /^[A-Za-z]:[\\/]/u.test(normalized);
  if (looksLikeUnixAbsolute || looksLikeWindowsAbsolute) {
    return buildProviderImageUrl(adapter, normalized);
  }

  return normalized;
}

export function toBrowseUrl(pathValue: string, providerId?: ProviderId): string {
  const normalized = pathValue.trim();
  if (!normalized) return "#";

  const adapter = getProviderAdapter(providerId);
  const resolved = resolveLocalFileReference(normalized, providerId);
  if (resolved) {
    return resolved.browseUrl;
  }

  if (looksLikeAbsolutePath(normalized)) {
    return buildProviderBrowseUrl(adapter, normalized);
  }

  return "#";
}

export function parseMessageBlocks(text: string, providerId?: ProviderId): MessageBlock[] {
  if (!text.includes("![") || !text.includes("](")) {
    return [{ kind: "text", value: text }];
  }

  const blocks: MessageBlock[] = [];
  const imagePattern = /!\[([^\]]*)\]\(([^)\n]+)\)/gu;
  let cursor = 0;

  for (const match of text.matchAll(imagePattern)) {
    const [fullMatch, altRaw, urlRaw] = match;
    if (typeof match.index !== "number") continue;

    const start = match.index;
    const end = start + fullMatch.length;
    const imageUrl = toRenderableImageUrl(urlRaw.trim(), providerId);
    if (!imageUrl) continue;

    if (start > cursor) {
      blocks.push({ kind: "text", value: text.slice(cursor, start) });
    }

    blocks.push({ kind: "image", url: imageUrl, alt: altRaw.trim(), markdown: fullMatch });
    cursor = end;
  }

  if (cursor < text.length) {
    blocks.push({ kind: "text", value: text.slice(cursor) });
  }

  return blocks.length > 0 ? blocks : [{ kind: "text", value: text }];
}

export function summarizeTurnFileChanges(turn: Turn | null): TurnFileChangeSummaryEntry[] {
  if (!turn) {
    return [];
  }

  const entries = new Map<string, TurnFileChangeSummaryEntry>();

  for (const item of turn.items) {
    if (item.type !== "fileChange") {
      continue;
    }

    for (const change of item.changes) {
      const path = change.path.trim();
      if (!path || path === "Editing files") {
        continue;
      }

      if (entries.has(path)) {
        entries.delete(path);
      }

      entries.set(path, {
        itemId: item.id,
        path,
        kind: change.kind.type,
        status: item.status,
      });
    }
  }

  return [...entries.values()];
}

export function deriveLiveOverlay(turn: Turn | null): UiLiveOverlay | null {
  if (!turn || turn.status !== "inProgress") {
    return null;
  }

  const reversedItems = [...turn.items].reverse();
  const reasoning = reversedItems.find(
    (item): item is Extract<ThreadItem, { type: "reasoning" }> =>
      item.type === "reasoning",
  );
  const plan = reversedItems.find(
    (item): item is Extract<ThreadItem, { type: "plan" }> => item.type === "plan",
  );

  let activityLabel = "Thinking";
  const activityDetails: string[] = [];
  let activityTone: UiLiveOverlay["activityTone"] = "thinking";
  let statusText = "The agent is thinking through the next step";
  const reasoningText = reasoning
    ? [...reasoning.summary, ...reasoning.content].filter(Boolean).join("\n\n").trim()
    : "";
  let errorText = "";

  for (const item of reversedItems) {
    if (item.type === "commandExecution" && item.status === "inProgress") {
      activityLabel = "Running command";
      activityTone = "command";
      statusText = "The agent is running a command";
      if (item.command.trim()) {
        activityDetails.push(item.command.trim());
      }
      break;
    }

    if (item.type === "fileChange" && item.status === "inProgress") {
      activityLabel = "Editing files";
      activityTone = "editing";
      statusText = "The agent is editing files";
      activityDetails.push(
        ...item.changes
          .map((change) => change.path)
          .filter((path) => Boolean(path) && path !== "Editing files")
          .slice(0, 2),
      );
      break;
    }

    if (item.type === "mcpToolCall" && item.status === "inProgress") {
      activityLabel = "Using MCP tool";
      activityTone = "tool";
      statusText = "The agent is using an MCP tool";
      activityDetails.push([item.server, item.tool].filter(Boolean).join(" · "));
      break;
    }

    if (item.type === "dynamicToolCall" && item.status === "inProgress") {
      activityLabel = "Using tool";
      activityTone = "tool";
      statusText = "The agent is using a tool";
      if (item.tool.trim()) {
        activityDetails.push(item.tool.trim());
      }
      break;
    }

    if (item.type === "collabAgentToolCall" && item.status === "inProgress") {
      activityLabel = "Calling subagent";
      activityTone = "agent";
      statusText = "The agent is working with a subagent";
      if (item.tool.trim()) {
        activityDetails.push(item.tool.trim());
      }
      break;
    }

    if (item.type === "webSearch" && item.query.trim()) {
      activityLabel = "Searching web";
      activityTone = "search";
      statusText = "The agent is searching the web";
      activityDetails.push(item.query.trim());
      break;
    }

    if (item.type === "imageGeneration" && item.status !== "completed") {
      activityLabel = "Generating image";
      activityTone = "image";
      statusText = "The agent is generating an image";
      if (item.revisedPrompt?.trim()) {
        activityDetails.push(item.revisedPrompt.trim());
      }
      break;
    }

    if (item.type === "agentMessage") {
      activityLabel = "Writing response";
      activityTone = "writing";
      statusText = "The agent is writing the response";
      break;
    }

    if (item.type === "plan") {
      activityLabel = "Planning";
      activityTone = "thinking";
      statusText = "The agent is planning the next steps";
      if (item.text.trim()) {
        activityDetails.push(item.text.trim().split("\n")[0]);
      }
      break;
    }

    if (item.type === "reasoning") {
      activityLabel = "Reasoning";
      activityTone = "thinking";
      statusText = "The agent is reasoning about the next step";
      if (item.summary[0]?.trim()) {
        activityDetails.push(item.summary[0].trim());
      }
      break;
    }
  }

  if (
    activityTone === "thinking" &&
    activityLabel === "Thinking" &&
    plan?.text.trim()
  ) {
    activityLabel = "Planning";
    statusText = "The agent is planning the next steps";
    activityDetails.push(plan.text.trim().split("\n")[0]);
  }

  if (turn.error && typeof turn.error === "object" && "message" in turn.error) {
    errorText = typeof (turn.error as { message?: unknown }).message === "string" ? (turn.error as { message: string }).message : "";
    activityTone = "error";
    statusText = "The agent hit an error";
  }

  return {
    activityLabel,
    activityDetails: activityDetails.filter(Boolean),
    activityTone,
    statusText,
    reasoningText,
    errorText,
  };
}

const MAIN_BRANCH_NAMES = new Set(["main", "master", "trunk"]);
const GRAPH_ACCENTS = [
  "var(--ac)",
  "var(--ac2)",
  "var(--ac3)",
  "var(--gn)",
  "var(--og)",
];

const compactText = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;

const basename = (value: string) =>
  value.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? value;

const compactPath = (value: string, maxLength = 42) => {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  return compactText(tail || normalized, maxLength);
};

const normalizeBranchName = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "workspace";
};

const cleanShellWrapper = (command: string) => {
  const trimmed = command.trim();
  const shellWrapperMatch = trimmed.match(/^(?:\/bin\/)?(?:bash|sh|zsh)\s+-lc\s+['"](.+)['"]$/u);
  return shellWrapperMatch?.[1]?.trim() || trimmed;
};

const firstMeaningfulLine = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";

const formatShortDateFromTimestamp = (timestampSeconds: number) =>
  new Intl.DateTimeFormat([], {
    day: "2-digit",
    month: "short",
  }).format(new Date(timestampSeconds * 1000));

const formatShortDateFromGit = (dateValue: string) => {
  const parsed = new Date(`${dateValue.trim()}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateValue.trim();
  }

  return new Intl.DateTimeFormat([], {
    day: "2-digit",
    month: "short",
  }).format(parsed);
};

const rowEmphasisFromStatus = (status: string | null | undefined): GitActivityGraphRow["emphasis"] => {
  if (status === "inProgress" || status === "active") {
    return "current";
  }

  if (status === "completed" || status === "idle" || status === "applied") {
    return "normal";
  }

  return "muted";
};

const normalizeGraphRefLabel = (value: string) => {
  if (value.startsWith("HEAD -> ")) {
    return value.slice(8).trim();
  }

  if (value.startsWith("tag: ")) {
    return value.slice(5).trim();
  }

  return value.trim();
};

function parseGitGraphRefs(rawValue: string, activeBranch: string): GitActivityGraphRef[] {
  const trimmed = rawValue.trim().replace(/^\(|\)$/gu, "");
  if (!trimmed) {
    return [];
  }

  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const label = normalizeGraphRefLabel(entry);
      let kind: GitActivityGraphRef["kind"] = "other";
      let active = false;

      if (entry.startsWith("HEAD -> ")) {
        kind = "head";
        active = true;
      } else if (entry.startsWith("tag: ")) {
        kind = "tag";
      } else if (entry.startsWith("origin/") || entry.startsWith("remotes/")) {
        kind = "remote";
      } else {
        kind = "local";
        active = label === activeBranch;
      }

      return {
        id: `${label}:${index}`,
        label,
        kind,
        active,
      };
    });
}

const buildGitLanes = (labels: string[], activeBranch: string): GitActivityGraphLane[] =>
  labels.slice(0, 6).map((label, index) => {
    let emphasis: GitActivityGraphLane["emphasis"] = "peer";
    if (MAIN_BRANCH_NAMES.has(label)) {
      emphasis = "base";
    } else if (label === activeBranch) {
      emphasis = "active";
    }

    return {
      id: `lane:${label}`,
      label,
      accent: GRAPH_ACCENTS[index % GRAPH_ACCENTS.length],
      emphasis,
    };
  });

const collectLaneLabelsFromRefs = (rows: GitActivityGraphRow[], activeBranch: string) => {
  const labels = new Set<string>();
  if (activeBranch) {
    labels.add(activeBranch);
  }

  rows.forEach((row) => {
    row.refs.forEach((ref) => {
      if (ref.kind === "tag" || ref.kind === "other") {
        return;
      }

      labels.add(ref.label);
    });
  });

  if (![...labels].some((entry) => MAIN_BRANCH_NAMES.has(entry))) {
    labels.add("main");
  }

  return [...labels];
};

function summarizeFileChangeItem(item: Extract<ThreadItem, { type: "fileChange" }>) {
  const paths = [...new Set(item.changes.map((change) => change.path.trim()).filter((path) => path && path !== "Editing files"))];
  if (paths.length === 1) {
    return compactPath(paths[0]);
  }

  if (paths.length > 1) {
    return `Changed ${String(paths.length)} files`;
  }

  return item.status === "inProgress" ? "Editing files" : "Applied patch";
}

function describeThreadActivity(threadRecord: ThreadRecord): {
  subject: string;
  hint: string | null;
  emphasis: GitActivityGraphRow["emphasis"];
} {
  const turns = threadRecord.thread.turns ?? [];
  const latestTurn = turns.at(-1) ?? null;
  const items = turns.flatMap((turn) => turn.items).reverse();

  for (const item of items) {
    if (item.type === "commandExecution") {
      const commandText = cleanShellWrapper(item.command);
      return {
        subject: compactText(commandText, 84),
        hint: item.status === "inProgress" ? "Running command" : "Last command",
        emphasis: rowEmphasisFromStatus(item.status),
      };
    }

    if (item.type === "fileChange") {
      return {
        subject: summarizeFileChangeItem(item),
        hint: item.status === "inProgress" ? "Editing files" : "File changes",
        emphasis: rowEmphasisFromStatus(item.status),
      };
    }

    if (item.type === "plan") {
      return {
        subject: compactText(firstMeaningfulLine(item.text) || "Plan updated", 84),
        hint: "Plan step",
        emphasis: rowEmphasisFromStatus(latestTurn?.status ?? null),
      };
    }

    if (item.type === "reasoning") {
      return {
        subject: compactText(item.summary[0] || item.content[0] || "Reasoning in progress", 84),
        hint: "Thinking",
        emphasis: rowEmphasisFromStatus(latestTurn?.status ?? "inProgress"),
      };
    }

    if (item.type === "agentMessage") {
      return {
        subject: compactText(firstMeaningfulLine(item.text) || "Response updated", 84),
        hint: latestTurn?.status === "inProgress" ? "Writing response" : "Last reply",
        emphasis: rowEmphasisFromStatus(latestTurn?.status ?? null),
      };
    }
  }

  return {
    subject: compactText(threadRecord.thread.preview || threadRecord.thread.name || "Session activity", 84),
    hint: threadRecord.thread.status.type === "active" ? "Active session" : "Session",
    emphasis: rowEmphasisFromStatus(threadRecord.thread.status.type),
  };
}

function buildActiveDetailRows(
  activeThread: ThreadRecord,
  graph: string,
  seenRowKeys: Set<string>,
): GitActivityGraphRow[] {
  const rows: GitActivityGraphRow[] = [];

  const prioritizedSteps = [...(activeThread.plan?.steps ?? [])].sort((left, right) => {
    const rank = (status: string) => {
      if (status === "inProgress") return 0;
      if (status === "pending") return 1;
      return 2;
    };

    return rank(left.status) - rank(right.status);
  });

  for (const step of prioritizedSteps) {
    const subject = compactText(step.step.trim(), 84);
    if (!subject || seenRowKeys.has(`step:${subject}`)) {
      continue;
    }

    seenRowKeys.add(`step:${subject}`);
    rows.push({
      id: `active-step:${subject}`,
      graph,
      subject,
      dateLabel: formatShortDateFromTimestamp(activeThread.thread.updatedAt),
      author: "session",
      sha: activeThread.thread.gitInfo?.sha ?? "live",
      refs: [],
      emphasis: rowEmphasisFromStatus(step.status),
      threadId: null,
      hint: `Plan · ${step.status === "inProgress" ? "in progress" : step.status}`,
    });

    if (rows.length >= 2) {
      break;
    }
  }

  const recentFileItems = [...activeThread.thread.turns]
    .flatMap((turn) => turn.items)
    .reverse()
    .filter((item): item is Extract<ThreadItem, { type: "fileChange" }> => item.type === "fileChange");

  for (const item of recentFileItems) {
    const subject = summarizeFileChangeItem(item);
    if (!subject || seenRowKeys.has(`file:${subject}`)) {
      continue;
    }

    seenRowKeys.add(`file:${subject}`);
    rows.push({
      id: `active-file:${item.id}`,
      graph,
      subject,
      dateLabel: formatShortDateFromTimestamp(activeThread.thread.updatedAt),
      author: "workspace",
      sha: activeThread.thread.gitInfo?.sha ?? "live",
      refs: [],
      emphasis: rowEmphasisFromStatus(item.status),
      threadId: null,
      hint: item.status === "inProgress" ? "Editing files" : "Recent file change",
    });

    if (rows.length >= 4) {
      break;
    }
  }

  return rows;
}

const CONFLICT_STATUS_CODES = new Set([
  "DD",
  "AU",
  "UD",
  "UA",
  "DU",
  "AA",
  "UU",
]);

const WORKING_TREE_BUCKET_ORDER: Array<GitWorkingTreeBucket["id"]> = [
  "staged",
  "unstaged",
  "untracked",
  "conflicted",
];

const WORKING_TREE_BUCKET_LABELS: Record<GitWorkingTreeBucket["id"], string> = {
  staged: "Staged",
  unstaged: "Unstaged",
  untracked: "Untracked",
  conflicted: "Conflicted",
};

const normalizeGitStatusPath = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const splitGitStatusPath = (value: string) => {
  const parts = value.split(/\s+->\s+/u).map((part) => normalizeGitStatusPath(part));
  if (parts.length >= 2) {
    return {
      originalPath: parts[0] || null,
      path: parts.at(-1) ?? value,
    };
  }

  return {
    originalPath: null,
    path: normalizeGitStatusPath(value),
  };
};

const parseGitStatusDescriptor = (
  code: string,
): Pick<GitWorkingTreeEntry, "badge" | "kind"> => {
  switch (code) {
    case "A":
    case "?":
      return { badge: "new", kind: "add" };
    case "M":
      return { badge: "mod", kind: "update" };
    case "D":
      return { badge: "del", kind: "delete" };
    case "R":
      return { badge: "ren", kind: "rename" };
    case "C":
      return { badge: "cpy", kind: "copy" };
    case "T":
      return { badge: "typ", kind: "type" };
    case "U":
      return { badge: "cf", kind: "conflict" };
    default:
      return { badge: "chg", kind: "unknown" };
  }
};

const appendWorkingTreeEntry = (
  buckets: Record<GitWorkingTreeBucket["id"], Array<GitWorkingTreeEntry>>,
  bucketId: GitWorkingTreeBucket["id"],
  statusCode: string,
  path: string,
  originalPath: string | null,
) => {
  const descriptor = parseGitStatusDescriptor(statusCode);
  buckets[bucketId].push({
    id: `${bucketId}:${statusCode}:${originalPath ?? ""}:${path}`,
    path,
    originalPath,
    badge: descriptor.badge,
    kind: descriptor.kind,
  });
};

function buildGitWorkingTreeState(rawStatus: string): GitWorkingTreeState | null {
  if (!rawStatus.trim()) {
    return null;
  }

  const buckets: Record<GitWorkingTreeBucket["id"], Array<GitWorkingTreeEntry>> = {
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  };

  rawStatus
    .split("\n")
    .map((line) => line.replace(/\r$/u, ""))
    .filter(Boolean)
    .forEach((line) => {
      if (line.startsWith("## ") || line.startsWith("!! ")) {
        return;
      }

      const x = line[0] ?? " ";
      const y = line[1] ?? " ";
      const rawPath = line.slice(3).trim();
      if (!rawPath) {
        return;
      }

      const { originalPath, path } = splitGitStatusPath(rawPath);
      if (!path) {
        return;
      }

      if (x === "?" && y === "?") {
        appendWorkingTreeEntry(buckets, "untracked", "?", path, originalPath);
        return;
      }

      if (CONFLICT_STATUS_CODES.has(`${x}${y}`)) {
        appendWorkingTreeEntry(buckets, "conflicted", "U", path, originalPath);
        return;
      }

      if (x !== " ") {
        appendWorkingTreeEntry(buckets, "staged", x, path, originalPath);
      }

      if (y !== " ") {
        appendWorkingTreeEntry(buckets, "unstaged", y, path, originalPath);
      }
    });

  const orderedBuckets = WORKING_TREE_BUCKET_ORDER.flatMap((bucketId) =>
    buckets[bucketId].length > 0
      ? [
          {
            id: bucketId,
            label: WORKING_TREE_BUCKET_LABELS[bucketId],
            entries: buckets[bucketId],
          } satisfies GitWorkingTreeBucket,
        ]
      : [],
  );
  const summary = orderedBuckets.length
    ? orderedBuckets
        .map((bucket) => `${String(bucket.entries.length)} ${bucket.label.toLowerCase()}`)
        .join(" · ")
    : "Working tree clean";

  return {
    dirty: orderedBuckets.length > 0,
    summary,
    buckets: orderedBuckets,
  };
}

export function buildGitHistoryGraphModel(args: {
  activeThread: ThreadRecord | null;
  rawLog: string;
  rawStatus?: string;
}): GitActivityGraphModel | null {
  const { activeThread, rawLog, rawStatus = "" } = args;
  if (!activeThread || !rawLog.trim()) {
    return null;
  }

  const activeBranch = normalizeBranchName(activeThread.thread.gitInfo?.branch);
  const rows = rawLog
    .split("\n")
    .map((line) => line.replace(/\r$/u, ""))
    .filter(Boolean)
    .flatMap((line, index) => {
      const parts = line.split("\u001f");
      if (parts.length < 6) {
        return [];
      }

      const graph = parts[0] ?? "*";
      const sha = parts[1]?.trim() ?? "";
      const dateRaw = parts[2]?.trim() ?? "";
      const author = parts[3]?.trim() ?? "unknown";
      const decorations = parts[4]?.trim() ?? "";
      const subject = parts.slice(5).join("\u001f").trim() || "(no commit message)";
      const refs = parseGitGraphRefs(decorations, activeBranch);
      const current =
        sha === activeThread.thread.gitInfo?.sha ||
        refs.some((ref) => ref.active);

      return [
        {
          id: `git:${sha || index}`,
          graph,
          subject,
          dateLabel: formatShortDateFromGit(dateRaw),
          author,
          sha: sha || "unknown",
          refs,
          emphasis: current ? "current" : "normal",
          threadId: null,
          hint: decorations ? decorations.replace(/^\(|\)$/gu, "") : null,
        } satisfies GitActivityGraphRow,
      ];
    });

  if (rows.length === 0) {
    return null;
  }

  const lanes = buildGitLanes(collectLaneLabelsFromRefs(rows, activeBranch), activeBranch);

  return {
    repoLabel: basename(activeThread.thread.cwd),
    branchLabel: activeBranch,
    commitLabel: activeThread.thread.gitInfo?.sha ?? null,
    graphWidth: Math.max(...rows.map((row) => row.graph.length), 2),
    source: "git",
    lanes,
    rows,
    workingTree: buildGitWorkingTreeState(rawStatus),
  };
}

export function buildGitActivityGraphModel(args: {
  activeThread: ThreadRecord | null;
  relatedThreads: ThreadRecord[];
  rawStatus?: string;
}): GitActivityGraphModel | null {
  const { activeThread, relatedThreads, rawStatus = "" } = args;
  if (!activeThread) {
    return null;
  }

  const activeBranch = normalizeBranchName(activeThread.thread.gitInfo?.branch);
  const repoLabel = basename(activeThread.thread.cwd);
  const sameRepoThreads = relatedThreads.filter((thread) => thread.thread.cwd === activeThread.thread.cwd);
  const distinctBranches = new Map<string, ThreadRecord>();

  sameRepoThreads.forEach((thread) => {
    const branch = normalizeBranchName(thread.thread.gitInfo?.branch);
    if (!distinctBranches.has(branch)) {
      distinctBranches.set(branch, thread);
    }
  });

  if (!distinctBranches.has(activeBranch)) {
    distinctBranches.set(activeBranch, activeThread);
  }

  const threadSourceLabel = (thread: ThreadRecord) => {
    if (thread.thread.agentNickname) {
      return thread.thread.agentNickname;
    }

    if (thread.thread.source === "appServer") {
      return "workspace";
    }

    return typeof thread.thread.source === "string"
      ? thread.thread.source
      : "session";
  };

  const laneLabels = [...distinctBranches.keys()];
  if (!laneLabels.some((label) => MAIN_BRANCH_NAMES.has(label))) {
    laneLabels.unshift("main");
  }

  if (!laneLabels.includes(activeBranch)) {
    laneLabels.unshift(activeBranch);
  }

  const lanes = buildGitLanes(laneLabels, activeBranch);
  const laneIndexByLabel = new Map(lanes.map((lane, index) => [lane.label, index]));
  const rowKeys = new Set<string>();
  const rows: GitActivityGraphRow[] = [];

  const primaryThreads = [
    activeThread,
    ...sameRepoThreads.filter((thread) => thread.thread.id !== activeThread.thread.id),
  ]
    .filter((thread) => laneIndexByLabel.has(normalizeBranchName(thread.thread.gitInfo?.branch)))
    .filter((thread, index, all) => {
      const branch = normalizeBranchName(thread.thread.gitInfo?.branch);
      return all.findIndex((candidate) => normalizeBranchName(candidate.thread.gitInfo?.branch) === branch) === index;
    });

  for (const thread of primaryThreads) {
    const branch = normalizeBranchName(thread.thread.gitInfo?.branch);
    if (!laneIndexByLabel.has(branch)) {
      continue;
    }

    const summary = describeThreadActivity(thread);
    const rowKey = `thread:${branch}:${summary.subject}`;
    if (rowKeys.has(rowKey)) {
      continue;
    }

    rowKeys.add(rowKey);
    const laneIndex = laneIndexByLabel.get(branch) ?? 0;
    rows.push({
      id: `thread:${thread.thread.id}`,
      graph: [...lanes]
        .map((_, index) => (index === laneIndex ? "*" : "│"))
        .join(" "),
      subject: summary.subject,
      dateLabel: formatShortDateFromTimestamp(thread.thread.updatedAt),
      author: threadSourceLabel(thread),
      sha: thread.thread.gitInfo?.sha ?? "thread",
      refs: [
        {
          id: `session-ref:${branch}`,
          label: branch,
          kind: MAIN_BRANCH_NAMES.has(branch) ? "local" : "head",
          active: branch === activeBranch,
        },
      ],
      emphasis: thread.thread.id === activeThread.thread.id ? "current" : summary.emphasis,
      threadId: thread.thread.id,
      hint: summary.hint,
    });

    if (rows.length >= 4) {
      break;
    }
  }

  if (rows.length < 4) {
    const activeLaneIndex = laneIndexByLabel.get(activeBranch) ?? 0;
    const activeGraph = [...lanes]
      .map((_, index) => (index === activeLaneIndex ? "*" : "│"))
      .join(" ");
    rows.push(...buildActiveDetailRows(activeThread, activeGraph, rowKeys));
  }

  return {
    repoLabel,
    branchLabel: activeBranch,
    commitLabel: activeThread.thread.gitInfo?.sha ?? null,
    graphWidth: Math.max(...rows.map((row) => row.graph.length), 2),
    source: "session",
    lanes,
    rows: rows.slice(0, 7),
    workingTree: buildGitWorkingTreeState(rawStatus),
  };
}
