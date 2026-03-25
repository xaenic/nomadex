import type { ProviderId } from "./providers";

export const WORKSPACE_PROJECT_SETTINGS_RELATIVE_PATH = ".nomadex/project.json";

export type WorkspaceProjectSettings = {
  version: 1;
  commitAssistant: {
    provider: ProviderId;
  };
};

export type CommitGenerationScope = "staged" | "working-tree";

export type CommitGenerationContext = {
  scope: CommitGenerationScope;
  status: string;
  diffStat: string;
  diff: string;
};

const MAX_DIFF_STAT_CHARS = 3000;
const MAX_DIFF_CHARS = 16000;

const truncateSection = (value: string, maxChars: number) => {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return normalized || "(empty)";
  }

  return `${normalized.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
};

export const normalizeWorkspaceProjectSettings = (
  value: unknown,
  fallbackProvider: ProviderId,
): WorkspaceProjectSettings => {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const commitAssistant =
    record.commitAssistant &&
    typeof record.commitAssistant === "object" &&
    !Array.isArray(record.commitAssistant)
      ? (record.commitAssistant as Record<string, unknown>)
      : {};

  const provider = commitAssistant.provider;

  return {
    version: 1,
    commitAssistant: {
      provider:
        provider === "codex" ||
        provider === "antigravity" ||
        provider === "opencode" ||
        provider === "qwen-code" ||
        provider === "gemini-cli" ||
        provider === "github-copilot"
          ? provider
          : fallbackProvider,
    },
  };
};

export const serializeWorkspaceProjectSettings = (
  settings: WorkspaceProjectSettings,
) => `${JSON.stringify(settings, null, 2)}\n`;

export const buildCommitGenerationPrompt = ({
  scope,
  status,
  diffStat,
  diff,
}: CommitGenerationContext) => {
  const scopeInstruction =
    scope === "staged"
      ? "Write the commit message for the staged changes only. Ignore unstaged and untracked files."
      : "No files are currently staged. Write the commit message for the full working tree changes because the commit action will stage all pending files before running git commit.";

  return [
    "Generate a git commit message for the current repository state.",
    "",
    "Follow the commit-work workflow:",
    "- inspect the actual change set before writing",
    "- do not invent files, behavior, or reasons that are not supported by the status or diff",
    "- use Conventional Commits",
    "- keep the subject line specific and concise",
    "- add a short body only when it adds useful why/context",
    "",
    scopeInstruction,
    "",
    "Return only this envelope and nothing else:",
    "<commit_message>",
    "type(scope): short summary",
    "",
    "optional body paragraph",
    "</commit_message>",
    "",
    "## Git status",
    status.trim() || "(empty)",
    "",
    "## Diff stat",
    truncateSection(diffStat, MAX_DIFF_STAT_CHARS),
    "",
    "## Diff",
    truncateSection(diff, MAX_DIFF_CHARS),
  ].join("\n");
};

export const extractCommitMessageCandidate = (value: string) => {
  const normalized = value.replace(/\r/g, "").trim();
  if (!normalized) {
    return "";
  }

  const tagged = normalized.match(
    /<commit_message>\s*([\s\S]*?)\s*<\/commit_message>/i,
  );
  if (tagged?.[1]) {
    return tagged[1].trim();
  }

  const fenced = normalized.match(/```(?:text|md|markdown)?\n([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const lines = normalized.split("\n");
  const subjectIndex = lines.findIndex((line) =>
    /^[a-z]+(?:\([^)]+\))?!?:\s+\S+/u.test(line.trim()),
  );
  if (subjectIndex >= 0) {
    return lines.slice(subjectIndex).join("\n").trim();
  }

  return normalized;
};

export const splitCommitMessageParagraphs = (value: string) =>
  value
    .replace(/\r/g, "")
    .trim()
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
