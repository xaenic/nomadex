import type { ThreadItem, Turn, UserInput } from "../protocol/v2";

export type UiFileAttachment = {
  label: string;
  path: string;
};

export type InlineSegment =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "file"; value: string; path: string; displayPath: string; downloadName: string };

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

function extractFileAttachments(value: string): UiFileAttachment[] {
  const markerIdx = value.split("\n").findIndex((line) => FILES_MENTIONED_MARKER.test(line.trim()));
  if (markerIdx < 0) return [];
  const lines = value.split("\n").slice(markerIdx + 1);
  const attachments: UiFileAttachment[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(FILE_ATTACHMENT_LINE);
    if (!match) break;
    const label = match[1]?.trim();
    const path = match[2]?.trim().replace(/\s+\((?:lines?\s+\d+(?:-\d+)?)\)\s*$/, "");
    if (label && path) {
      attachments.push({ label, path });
    }
  }

  return attachments;
}

function extractCodexUserRequestText(value: string): string {
  const markerRegex = /(?:^|\n)\s{0,3}#{0,6}\s*my request for codex\s*:?\s*/giu;
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
  const images: string[] = [];

  for (const block of item.content as UserInput[]) {
    if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      textChunks.push(block.text);
    }

    if (block.type === "image" && typeof block.url === "string" && block.url.trim().length > 0) {
      images.push(block.url.trim());
    }

    if (block.type === "localImage" && typeof block.path === "string" && block.path.trim().length > 0) {
      images.push(block.path.trim());
    }
  }

  const fullText = textChunks.join("\n");
  return {
    text: extractCodexUserRequestText(fullText),
    images,
    fileAttachments: extractFileAttachments(fullText),
  };
}

export function parseInlineSegments(text: string): InlineSegment[] {
  if (!text.includes("`")) return [{ kind: "text", value: text }];

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
      segments.push({ kind: "text", value: text.slice(textStart, cursor) });
    }

    const token = text.slice(cursor + openLength, closingStart);
    if (token.length > 0) {
      const fileReference = parseFileReference(token);
      if (fileReference) {
        const displayPath = fileReference.line ? `${fileReference.path}:${String(fileReference.line)}` : fileReference.path;
        segments.push({
          kind: "file",
          value: token,
          path: fileReference.path,
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
    segments.push({ kind: "text", value: text.slice(textStart) });
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
    normalized.startsWith("/codex-local-image?")
  ) {
    return normalized;
  }

  if (normalized.startsWith("file://")) {
    return `/codex-local-image?path=${encodeURIComponent(normalized)}`;
  }

  const looksLikeUnixAbsolute = normalized.startsWith("/");
  const looksLikeWindowsAbsolute = /^[A-Za-z]:[\\/]/u.test(normalized);
  if (looksLikeUnixAbsolute || looksLikeWindowsAbsolute) {
    return `/codex-local-image?path=${encodeURIComponent(normalized)}`;
  }

  return normalized;
}

export function toBrowseUrl(pathValue: string): string {
  const normalized = pathValue.trim();
  if (!normalized) return "#";

  const looksLikeAbsolutePath = (candidate: string): boolean =>
    candidate.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(candidate);

  const parsed = parseFileReference(normalized);
  if (parsed?.path && looksLikeAbsolutePath(parsed.path)) {
    return `/codex-local-browse${encodeURI(parsed.path)}`;
  }

  if (looksLikeAbsolutePath(normalized)) {
    return `/codex-local-browse${encodeURI(normalized)}`;
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

export function deriveLiveOverlay(turn: Turn | null): UiLiveOverlay | null {
  if (!turn || turn.status !== "inProgress") {
    return null;
  }

  let activityLabel = "Thinking";
  const activityDetails: string[] = [];
  let reasoningText = "";
  let errorText = "";

  for (const item of [...turn.items].reverse()) {
    if (item.type === "commandExecution" && item.status === "inProgress") {
      activityLabel = "Running command";
      if (item.command.trim()) {
        activityDetails.push(item.command.trim());
      }
      break;
    }

    if (item.type === "agentMessage") {
      activityLabel = "Writing response";
      break;
    }

    if (item.type === "reasoning") {
      activityLabel = "Thinking";
      reasoningText = [...item.summary, ...item.content].filter(Boolean).join("\n\n").trim();
      break;
    }
  }

  if (turn.error && typeof turn.error === "object" && "message" in turn.error) {
    errorText = typeof (turn.error as { message?: unknown }).message === "string" ? (turn.error as { message: string }).message : "";
  }

  return {
    activityLabel,
    activityDetails,
    reasoningText,
    errorText,
  };
}
