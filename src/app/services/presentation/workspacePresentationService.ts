import type { ThreadItem, Turn, UserInput } from "../../../protocol/v2";
import {
  activeProviderAdapter,
  buildProviderBrowseUrl,
  buildProviderImageUrl,
} from "../providers";

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

export function resolveLocalFileReference(value: string): LocalFileReference | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = parseFileReference(normalized);
  if (!parsed?.path || !looksLikeAbsolutePath(parsed.path)) {
    return null;
  }

  return {
    path: parsed.path,
    line: parsed.line,
    browseUrl: buildProviderBrowseUrl(activeProviderAdapter, parsed.path),
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

function extractUserRequestText(value: string): string {
  const markerRegex = activeProviderAdapter.requestMarkerPattern;
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

export function getUserMessageDisplay(item: Extract<ThreadItem, { type: "userMessage" }>): UserMessageDisplay {
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
    text: extractUserRequestText(fullText),
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

export function toRenderableImageUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith(`${activeProviderAdapter.localImagePath}?`)
  ) {
    return normalized;
  }

  if (normalized.startsWith("file://")) {
    return buildProviderImageUrl(activeProviderAdapter, normalized);
  }

  const looksLikeUnixAbsolute = normalized.startsWith("/");
  const looksLikeWindowsAbsolute = /^[A-Za-z]:[\\/]/u.test(normalized);
  if (looksLikeUnixAbsolute || looksLikeWindowsAbsolute) {
    return buildProviderImageUrl(activeProviderAdapter, normalized);
  }

  return normalized;
}

export function toBrowseUrl(pathValue: string): string {
  const normalized = pathValue.trim();
  if (!normalized) return "#";

  const resolved = resolveLocalFileReference(normalized);
  if (resolved) {
    return resolved.browseUrl;
  }

  if (looksLikeAbsolutePath(normalized)) {
    return buildProviderBrowseUrl(activeProviderAdapter, normalized);
  }

  return "#";
}

export function parseMessageBlocks(text: string): MessageBlock[] {
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
    const imageUrl = toRenderableImageUrl(urlRaw.trim());
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
