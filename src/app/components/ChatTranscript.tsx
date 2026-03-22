import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

import type { ThreadItem, Turn } from "../../protocol/v2";
import type { ThreadRecord } from "../mockData";
import {
  getUserMessageDisplay,
  parseInlineSegments,
  parseMessageBlocks,
  resolveLocalFileReference,
  summarizeTurnFileChanges,
  toBrowseUrl,
  toRenderableImageUrl,
} from "../services/presentation/workspacePresentationService";
import {
  diffEntryId,
  formatTurnErrorCode,
  getFileAttachmentPreview,
  shorten,
  turnErrorText,
} from "../workspaceHelpers";
import { BrandMark } from "./BrandMark";
import { ConnectionLoadingState } from "./ConnectionLoadingState";
import { FileChangeSummary } from "./FileChangeSummary";

type TextStreamFx = {
  from: number;
  to: number;
};

const ASSISTANT_LABEL = "Agent";

export function WelcomeState({
  onFill,
  onSlash,
}: {
  onFill: (value: string) => void;
  onSlash: (value: string) => void;
}) {
  return (
    <div className="ww">
      <BrandMark className="wico" />
      <h1>Nomadex</h1>
      <p>
        Agentic coding workspace for live threads, repo edits, command runs,
        and multi-provider orchestration.
      </p>
      <div className="wbadges">
        <div className="wbadge">⚡ Live stream</div>
        <div className="wbadge">🔍 Web search</div>
        <div className="wbadge">⑂ Multi-agent</div>
        <div className="wbadge">🔧 MCP tools</div>
        <div className="wbadge">📋 Skills ($)</div>
        <div className="wbadge">apply_patch</div>
        <div className="wbadge">/ 25 slash cmds</div>
      </div>
      <div className="wsug">
        <button
          className="sug"
          type="button"
          onClick={() =>
            onFill(
              "Refactor the auth middleware to use JWT properly with full TypeScript types",
            )
          }
        >
          <div className="sug-i">⚡</div>
          <div className="sug-t">Refactor code</div>
          <div className="sug-d">apply_patch + diffs</div>
        </button>
        <button className="sug" type="button" onClick={() => onSlash("/review")}>
          <div className="sug-i">🔍</div>
          <div className="sug-t">/review</div>
          <div className="sug-d">Audit working tree</div>
        </button>
        <button
          className="sug"
          type="button"
          onClick={() =>
            onFill("Write Jest unit tests for the auth service with 80%+ coverage")
          }
        >
          <div className="sug-i">🧪</div>
          <div className="sug-t">Write tests</div>
          <div className="sug-d">Jest + coverage</div>
        </button>
        <button className="sug" type="button" onClick={() => onSlash("/init")}>
          <div className="sug-i">📋</div>
          <div className="sug-t">/init</div>
          <div className="sug-d">Generate AGENTS.md</div>
        </button>
      </div>
      <p className="welcome-foot">
        /slash cmds · $skills · @file or /mention · !shell · ⌘K palette · Ctrl+G
        editor
      </p>
    </div>
  );
}

export function LoadingConversationState({
  threadLabelText,
}: {
  threadLabelText: string;
}) {
  return (
    <ConnectionLoadingState
      messages={[
        "Opening conversation",
        "Reattaching thread",
        "Loading recent history",
        "Syncing transcript",
      ]}
      metaText={`Restoring ${shorten(threadLabelText, 42)}`}
      variant="inline"
    />
  );
}

export const ChatTranscript = memo(function ChatTranscript({
  activeThread,
  activeThreadLabel,
  activeTurns,
  existingThreadHistoryPending,
  streamVisible,
  streamTextFx,
  onReview,
  onFill,
  onSlash,
  onCopy,
  onFork,
  onPlan,
  onEdit,
  onContext,
  onOpenFile,
}: {
  activeThread: ThreadRecord | null;
  activeThreadLabel: string;
  activeTurns: Array<Turn>;
  existingThreadHistoryPending: boolean;
  streamVisible: Record<string, number>;
  streamTextFx: Record<string, TextStreamFx>;
  onReview: (diffId?: string) => void;
  onFill: (value: string) => void;
  onSlash: (value: string) => void;
  onCopy: (value: string) => void;
  onFork: () => void;
  onPlan: () => void;
  onEdit: (value: string) => void;
  onContext: (event: ReactMouseEvent<HTMLElement>, item: ThreadItem) => void;
  onOpenFile: (path: string, line?: number | null) => void;
}) {
  if (!activeThread) {
    return <WelcomeState onFill={onFill} onSlash={onSlash} />;
  }

  if (existingThreadHistoryPending) {
    return <LoadingConversationState threadLabelText={activeThreadLabel} />;
  }

  if (activeTurns.length === 0) {
    return <WelcomeState onFill={onFill} onSlash={onSlash} />;
  }

  return (
    <>
      {activeTurns.map((turn) => {
        const errorText = turnErrorText(turn);
        const turnFileChanges = summarizeTurnFileChanges(turn);
        const liveAgentMessageId =
          turn.status === "inProgress"
            ? [...turn.items].reverse().find((entry) => entry.type === "agentMessage")?.id ?? null
            : null;

        return (
          <div className="turn-block" key={turn.id}>
            {turn.items.map((item) => (
              <ThreadItemView
                item={item}
                key={item.id}
                onContext={onContext}
                onCopy={onCopy}
                onEdit={onEdit}
                onFork={onFork}
                onOpenFile={onOpenFile}
                onPlan={onPlan}
                onReview={onReview}
                outputVisible={
                  item.type === "commandExecution"
                    ? streamVisible[`${item.id}:aggregatedOutput`]
                    : undefined
                }
                streaming={item.type === "agentMessage" && item.id === liveAgentMessageId}
                textFx={
                  item.type === "agentMessage"
                    ? streamTextFx[`${item.id}:text`]
                    : undefined
                }
                textVisible={
                  item.type === "agentMessage"
                    ? streamVisible[`${item.id}:text`]
                    : undefined
                }
                turnStatus={turn.status}
              />
            ))}
            {errorText ? (
              <TurnErrorCard
                code={formatTurnErrorCode(turn.error?.codexErrorInfo ?? null)}
                onOpenFile={onOpenFile}
                status={turn.status}
                text={errorText}
              />
            ) : null}
            {turn.status !== "inProgress" ? (
              <FileChangeSummary
                entries={turnFileChanges}
                onOpenFile={onOpenFile}
                title="Changed files"
                variant="turn"
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
});

const commandStatusLabel = (
  item: Extract<ThreadItem, { type: "commandExecution" }>,
) => {
  switch (item.status) {
    case "inProgress":
      return "Running";
    case "completed":
      return item.exitCode === 0 ? "Completed" : `Exit ${item.exitCode ?? "?"}`;
    case "failed":
      return "Failed";
    case "declined":
      return "Declined";
    default:
      return item.status;
  }
};

const commandStatusTone = (
  item: Extract<ThreadItem, { type: "commandExecution" }>,
) => {
  if (item.status === "inProgress") {
    return "run";
  }

  if (item.status === "completed" && item.exitCode === 0) {
    return "ok";
  }

  return "err";
};

const basenameFromCommandPath = (value: string) =>
  value.replace(/\\/gu, "/").split("/").filter(Boolean).pop() ?? value;

const formatCommandDuration = (durationMs: number | null) => {
  if (durationMs == null) {
    return null;
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  if (durationMs < 60000) {
    const seconds = durationMs / 1000;
    return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1).replace(/\.0$/u, "")}s`;
  }

  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.round((durationMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};

const compactCommandCwd = (cwd: string) => {
  const normalized = cwd.replace(/\\/gu, "/").trim();
  if (!normalized) {
    return "(cwd)";
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "/";
  }

  if (normalized.startsWith("/home/") && segments.length >= 3) {
    return `~/${segments.slice(2).join("/")}`;
  }

  if (segments.length > 3) {
    return `.../${segments.slice(-3).join("/")}`;
  }

  return normalized;
};

const SHELL_WRAPPER_RE =
  /^(?:\/usr\/bin\/env\s+)?((?:\/[^ "'`]+|[A-Za-z0-9_.-]+))(?:\s+(?:--?[A-Za-z0-9_-]+))*\s+(?:-lc|-c|\/c|-Command|-command)\s+(['"])([\s\S]*)\2$/u;

const getCommandExecutionDisplay = (
  item: Extract<ThreadItem, { type: "commandExecution" }>,
) => {
  const rawCommand =
    item.commandActions.find((entry) => entry.command?.trim())?.command.trim() ??
    item.command.trim();
  const wrappedMatch = rawCommand.match(SHELL_WRAPPER_RE);
  const shellSource = wrappedMatch?.[1] ?? rawCommand;
  const shellLabel = basenameFromCommandPath(shellSource).replace(/\.(?:bat|cmd|exe)$/iu, "") || "terminal";
  const displayCommand = wrappedMatch?.[3]?.trim() || rawCommand || "(command)";

  return {
    commandText: displayCommand,
    cwdText: compactCommandCwd(item.cwd),
    durationText: formatCommandDuration(item.durationMs),
    processText: item.processId ?? "pty",
    shellLabel,
  };
};

const messageAttachmentIdentity = (label: string, path: string) =>
  `${label.trim().toLowerCase()}:${path.trim()}`;

const TurnErrorCard = memo(function TurnErrorCard({
  status,
  text,
  code,
  onOpenFile,
}: {
  status: Turn["status"];
  text: string;
  code: string | null;
  onOpenFile: (path: string, line?: number | null) => void;
}) {
  return (
    <div className="msg">
      <div className="mh">
        <div className="mav a">⬡</div>
        <span className="mn">{ASSISTANT_LABEL}</span>
        <span className="mt">{status}</span>
      </div>
      <div className="mb">
        <div className="turn-error-card">
          <MessageTextFlow onOpenFile={onOpenFile} text={text} />
          {code ? <div className="turn-error-code">{code}</div> : null}
        </div>
      </div>
    </div>
  );
});

const MessageInlineFlow = memo(function MessageInlineFlow({
  text,
  onOpenFile,
}: {
  text: string;
  onOpenFile: (path: string, line?: number | null) => void;
}) {
  const segments = useMemo(() => parseInlineSegments(text), [text]);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return <span key={`text-${index}`}>{segment.value}</span>;
        }

        if (segment.kind === "code") {
          return (
            <code className="message-inline-code" key={`code-${index}`}>
              {segment.value}
            </code>
          );
        }

        const href = toBrowseUrl(segment.path);
        if (href === "#") {
          return onOpenFile ? (
            <button
              className="message-file-link file-link-button"
              key={`file-${index}`}
              onClick={() => onOpenFile(segment.path, segment.line)}
              title={segment.path}
              type="button"
            >
              {segment.displayPath}
            </button>
          ) : (
            <code className="message-inline-code" key={`file-${index}`}>
              {segment.displayPath}
            </code>
          );
        }

        return (
          <button
            className="message-file-link file-link-button"
            key={`file-${index}`}
            onClick={() => onOpenFile(segment.path, segment.line)}
            title={segment.path}
            type="button"
          >
            {segment.displayPath}
          </button>
        );
      })}
    </>
  );
});

function MessageImagePreview({
  url,
  alt,
  markdown,
  className,
}: {
  url: string;
  alt: string;
  markdown?: string;
  className?: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (loadFailed && markdown) {
    return <p className="message-text">{markdown}</p>;
  }

  return (
    <a className="message-image-link" href={url} rel="noreferrer noopener" target="_blank">
      <img
        alt={alt}
        className={clsx("message-image-preview", className)}
        loading="lazy"
        onError={() => setLoadFailed(true)}
        src={url}
      />
    </a>
  );
}

const extractCodeBlockLanguage = (children: ReactNode): string | null => {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<{ className?: string }>(child)) {
      continue;
    }

    const className = child.props.className;
    if (typeof className !== "string") {
      continue;
    }

    const match = className.match(/language-([A-Za-z0-9_-]+)/u);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
};

const MessageMarkdownFlow = memo(function MessageMarkdownFlow({
  text,
  onOpenFile,
}: {
  text: string;
  onOpenFile: (path: string, line?: number | null) => void;
}) {
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        const localFile = typeof href === "string" ? resolveLocalFileReference(href) : null;
        if (localFile) {
          return (
            <button
              className="message-file-link file-link-button message-markdown-link"
              onClick={() => onOpenFile(localFile.path, localFile.line)}
              title={localFile.path}
              type="button"
            >
              {children}
            </button>
          );
        }

        if (!href) {
          return <span className="message-markdown-anchor">{children}</span>;
        }

        return (
          <a
            className="message-markdown-anchor"
            href={href}
            rel="noreferrer noopener"
            target="_blank"
          >
            {children}
          </a>
        );
      },
      img({ src, alt }) {
        const renderableUrl = typeof src === "string" ? toRenderableImageUrl(src) : "";
        if (!renderableUrl) {
          return alt ? <span className="message-inline-code">{alt}</span> : null;
        }

        return (
          <MessageImagePreview
            alt={alt || "Embedded message image"}
            className="message-markdown-image"
            url={renderableUrl}
          />
        );
      },
      pre({ children }) {
        const language = extractCodeBlockLanguage(children);

        return (
          <div className="message-code-shell">
            <div className="message-code-head">
              <span>{language ?? "text"}</span>
            </div>
            <pre className="message-code-block">{children}</pre>
          </div>
        );
      },
      code({ className, children }) {
        return <code className={clsx("message-markdown-code", className)}>{children}</code>;
      },
    }),
    [onOpenFile],
  );

  return (
    <div className="message-text-flow message-markdown">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

const MessageTextFlow = memo(function MessageTextFlow({
  text,
  onOpenFile,
  textFx,
  streaming = false,
  showCursor = false,
}: {
  text: string;
  onOpenFile: (path: string, line?: number | null) => void;
  textFx?: TextStreamFx;
  streaming?: boolean;
  showCursor?: boolean;
}) {
  const blocks = useMemo(() => (streaming ? [] : parseMessageBlocks(text)), [streaming, text]);

  if (streaming) {
    const activeFx = textFx ?? null;
    const fadeFrom = activeFx ? Math.max(0, Math.min(text.length, activeFx.from)) : 0;
    const fadeTo = activeFx ? Math.max(fadeFrom, Math.min(text.length, activeFx.to)) : 0;

    return (
      <div className="message-text-flow message-text-flow-streaming">
        <p className="message-text message-text-streaming">
          {text.slice(0, fadeFrom)}
          {fadeTo > fadeFrom ? (
            <span className="message-text-tail">{text.slice(fadeFrom, fadeTo)}</span>
          ) : null}
          {text.slice(fadeTo)}
          {showCursor ? <span aria-hidden="true" className="live-cursor live-cursor-inline" /> : null}
        </p>
      </div>
    );
  }

  let blockCursor = 0;

  return (
    <div className="message-text-flow">
      {blocks.map((block, index) => {
        const blockStart = blockCursor;
        const blockLength =
          block.kind === "image" ? block.markdown.length : block.value.length;
        blockCursor += blockLength;

        if (block.kind === "image") {
          return (
            <MessageImagePreview
              alt={block.alt || "Embedded message image"}
              className="message-markdown-image"
              key={`image-${index}`}
              markdown={block.markdown}
              url={block.url}
            />
          );
        }

        if (!block.value) {
          return null;
        }

        const blockEnd = blockStart + block.value.length;
        const activeFx = textFx ?? null;
        const fadeFrom = activeFx ? Math.max(0, activeFx.from - blockStart) : 0;
        const fadeTo = activeFx
          ? Math.max(0, Math.min(block.value.length, activeFx.to - blockStart))
          : 0;
        let hasFade = false;
        if (activeFx) {
          hasFade =
            activeFx.to > activeFx.from &&
            fadeTo > fadeFrom &&
            blockEnd > activeFx.from &&
            blockStart < activeFx.to;
        }

        if (!hasFade) {
          return (
            <p className="message-text" key={`text-${index}`}>
              <MessageInlineFlow onOpenFile={onOpenFile} text={block.value} />
            </p>
          );
        }

        const stablePrefix = block.value.slice(0, fadeFrom);
        const freshText = block.value.slice(fadeFrom, fadeTo);
        const trailingSuffix = block.value.slice(fadeTo);

        return (
          <p className="message-text" key={`text-${index}`}>
            {stablePrefix ? (
              <MessageInlineFlow onOpenFile={onOpenFile} text={stablePrefix} />
            ) : null}
            {freshText ? (
              <span
                className="message-text-tail"
                key={`tail-${index}-${activeFx?.to ?? block.value.length}`}
              >
                <MessageInlineFlow onOpenFile={onOpenFile} text={freshText} />
              </span>
            ) : null}
            {trailingSuffix ? (
              <MessageInlineFlow onOpenFile={onOpenFile} text={trailingSuffix} />
            ) : null}
          </p>
        );
      })}
    </div>
  );
});

const ThreadItemView = memo(function ThreadItemView({
  item,
  turnStatus,
  streaming = false,
  textVisible,
  textFx,
  outputVisible,
  onCopy,
  onFork,
  onPlan,
  onReview,
  onEdit,
  onContext,
  onOpenFile,
}: {
  item: ThreadItem;
  turnStatus: Turn["status"];
  streaming?: boolean;
  textVisible?: number;
  textFx?: TextStreamFx;
  outputVisible?: number;
  onCopy: (value: string) => void;
  onFork: () => void;
  onPlan: () => void;
  onReview: (diffId?: string) => void;
  onEdit: (value: string) => void;
  onContext: (event: ReactMouseEvent<HTMLElement>, item: ThreadItem) => void;
  onOpenFile: (path: string, line?: number | null) => void;
}) {
  const [commandExpanded, setCommandExpanded] = useState(
    item.type === "commandExecution" ? item.status === "inProgress" : false,
  );
  const [userMessageTimeLabel] = useState(() =>
    item.type === "userMessage"
      ? new Intl.DateTimeFormat([], {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date())
      : "",
  );
  const previousCommandStatusRef = useRef<string | null>(
    item.type === "commandExecution" ? item.status : null,
  );

  const commandStatus = item.type === "commandExecution" ? item.status : null;

  useEffect(() => {
    if (item.type !== "commandExecution" || !commandStatus) {
      previousCommandStatusRef.current = null;
      return;
    }

    let frame: number | null = null;
    let collapseTimer: number | null = null;

    if (commandStatus === "inProgress") {
      frame = window.requestAnimationFrame(() => {
        setCommandExpanded(true);
      });
    } else if (previousCommandStatusRef.current === "inProgress") {
      collapseTimer = window.setTimeout(() => setCommandExpanded(false), 1000);
    }

    previousCommandStatusRef.current = commandStatus;

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      if (collapseTimer !== null) {
        window.clearTimeout(collapseTimer);
      }
    };
  }, [commandStatus, item.type]);

  if (item.type === "userMessage") {
    const display = getUserMessageDisplay(item);
    const fileAttachmentKeys = new Set(
      display.fileAttachments.map((attachment) =>
        messageAttachmentIdentity(attachment.label, attachment.path),
      ),
    );
    const extraAttachments = item.content.filter(
      (
        entry,
      ): entry is Extract<ThreadItem, { type: "userMessage" }>["content"][number] & (
        | { type: "mention"; name: string; path: string }
        | { type: "skill"; name: string; path: string }
      ) => {
        if (entry.type === "skill") {
          return true;
        }

        if (entry.type !== "mention") {
          return false;
        }

        return !fileAttachmentKeys.has(
          messageAttachmentIdentity(entry.name, entry.path),
        );
      },
    );

    return (
      <div className="msg user" onContextMenu={(event) => onContext(event, item)}>
        <div className="mb">
          {display.images.length > 0 ? (
            <div className="message-image-list">
              {display.images.map((imageUrl, index) => {
                const renderableUrl = toRenderableImageUrl(imageUrl);
                if (!renderableUrl) {
                  return null;
                }

                return (
                  <MessageImagePreview
                    alt="Message image preview"
                    key={`${item.id}-image-${index}`}
                    url={renderableUrl}
                  />
                );
              })}
            </div>
          ) : null}
          {display.fileAttachments.length > 0 || extraAttachments.length > 0 ? (
            <div className="attachment-row">
              {display.fileAttachments.map((attachment) => {
                const preview = getFileAttachmentPreview(
                  attachment.label,
                  attachment.path,
                );

                return (
                  <button
                    className={clsx(
                      "attachment-chip attachment-chip-file file-link-button",
                      `file-tone-${preview.tone}`,
                    )}
                    key={`${item.id}-file-${attachment.path}`}
                    onClick={() => onOpenFile(attachment.path)}
                    title={attachment.path}
                    type="button"
                  >
                    <span aria-hidden="true" className="file-chip-preview">
                      <span className="file-chip-ext">{preview.badge}</span>
                    </span>
                    <span className="file-chip-copy">
                      <span className="file-chip-title">{preview.title}</span>
                      <span className="file-chip-meta">{preview.kindLabel}</span>
                    </span>
                  </button>
                );
              })}
              {extraAttachments.map((attachment) => {
                if (attachment.type === "mention") {
                  const preview = getFileAttachmentPreview(attachment.name, attachment.path);

                  return (
                    <button
                      className={clsx(
                        "attachment-chip attachment-chip-file file-link-button",
                        `file-tone-${preview.tone}`,
                      )}
                      key={`${item.id}-${attachment.type}-${attachment.name}`}
                      onClick={() => onOpenFile(attachment.path)}
                      title={attachment.path}
                      type="button"
                    >
                      <span aria-hidden="true" className="file-chip-preview">
                        <span className="file-chip-ext">{preview.badge}</span>
                      </span>
                      <span className="file-chip-copy">
                        <span className="file-chip-title">{preview.title}</span>
                        <span className="file-chip-meta">{preview.kindLabel}</span>
                      </span>
                    </button>
                  );
                }

                return (
                  <span
                    className="attachment-chip"
                    key={`${item.id}-${attachment.type}-${attachment.name}`}
                  >
                    <span>📋</span>
                    <span>{attachment.name}</span>
                  </span>
                );
              })}
            </div>
          ) : null}
          {display.text ? <MessageTextFlow onOpenFile={onOpenFile} text={display.text} /> : null}
          <div className="msg-time">{userMessageTimeLabel}</div>
        </div>
        <div className="macts">
          <button className="mact" type="button" onClick={() => onCopy(display.text)}>
            📋 Copy
          </button>
          <button className="mact" type="button" onClick={() => onEdit(display.text)}>
            ✏ Edit
          </button>
        </div>
      </div>
    );
  }

  if (item.type === "agentMessage") {
    const text =
      typeof textVisible === "number" ? item.text.slice(0, textVisible) : item.text;

    return (
      <div
        className={clsx("msg assistant", streaming && "streaming")}
        onContextMenu={(event) => onContext(event, item)}
      >
        <div className="mh">
          <div className="mav a">⬡</div>
          <span className="mn">{ASSISTANT_LABEL}</span>
          <span className="mt">{turnStatus === "inProgress" ? "live" : turnStatus}</span>
        </div>
        <div className="mb">
          {text ? (
            streaming ? (
              <MessageTextFlow
                onOpenFile={onOpenFile}
                showCursor={streaming}
                streaming={streaming}
                text={text}
                textFx={textFx}
              />
            ) : (
              <MessageMarkdownFlow onOpenFile={onOpenFile} text={text} />
            )
          ) : null}
        </div>
        <div className="macts">
          <button className="mact" type="button" onClick={() => onFork()}>
            ⑂ /fork
          </button>
          <button className="mact" type="button" onClick={() => onPlan()}>
            📋 /plan
          </button>
          <button className="mact" type="button" onClick={() => onCopy(item.text)}>
            📋
          </button>
        </div>
      </div>
    );
  }

  if (item.type === "reasoning") {
    return null;
  }

  if (item.type === "plan") {
    return (
      <div className="compact-bar">
        <span className="compact-ico">📋</span>
        <span>{item.text}</span>
      </div>
    );
  }

  if (item.type === "commandExecution") {
    const output =
      typeof outputVisible === "number" && item.aggregatedOutput
        ? item.aggregatedOutput.slice(0, outputVisible)
        : item.aggregatedOutput ?? "";
    const badge = commandStatusTone(item);
    const commandDisplay = getCommandExecutionDisplay(item);

    return (
      <div className={clsx("cmd-inline", badge, commandExpanded && "open")}>
        <button
          className={clsx("cmd-inline-row", badge, commandExpanded && "open")}
          type="button"
          onClick={() => setCommandExpanded((current) => !current)}
        >
          <div className="cmd-inline-window-bar">
            <div className="cmd-inline-traffic" aria-hidden="true">
              <span className="cmd-inline-dot close" />
              <span className="cmd-inline-dot minimize" />
              <span className="cmd-inline-dot zoom" />
            </div>
            <span className="cmd-inline-shell">{commandDisplay.shellLabel}</span>
            <span className={clsx("cmd-inline-status-chip", badge)}>
              {commandStatusLabel(item)}
            </span>
          </div>
          <div className="cmd-inline-main">
            <span className={clsx("cmd-inline-chevron", commandExpanded && "open")}>▶</span>
            <div className="cmd-inline-copy">
              <code className="cmd-inline-label">{commandDisplay.commandText}</code>
              <div className="cmd-inline-meta-line">
                <span className="cmd-inline-meta-pill">{commandDisplay.cwdText}</span>
                <span className="cmd-inline-meta-pill">{commandDisplay.processText}</span>
                {commandDisplay.durationText ? (
                  <span className="cmd-inline-meta-pill">{commandDisplay.durationText}</span>
                ) : null}
              </div>
            </div>
          </div>
        </button>
        {commandExpanded ? (
          <div className="cmd-inline-output">
            <div className="cmd-inline-output-head">
              <span>Output</span>
              <span>{item.cwd}</span>
            </div>
            <pre>{output || "(no output)"}</pre>
          </div>
        ) : null}
      </div>
    );
  }

  if (item.type === "fileChange") {
    return <DiffCard item={item} onReview={onReview} />;
  }

  if (item.type === "mcpToolCall") {
    const body = item.result
      ? JSON.stringify(item.result.structuredContent ?? item.result.content ?? {}, null, 2)
      : item.error?.message ?? "No output";

    return (
      <div className={clsx("tool", item.error ? "err" : "ok")}>
        <div className="tool-h">
          {item.error ? "✗" : "✓"} MCP · {item.server}/{item.tool}
          <span className="tbadge">{item.status}</span>
        </div>
        <div className="tool-b">
          <pre className="tool-pre">{body}</pre>
        </div>
      </div>
    );
  }

  if (item.type === "dynamicToolCall") {
    return (
      <div className={clsx("tool", item.success ? "ok" : "run")}>
        <div className="tool-h">
          {item.success ? "✓" : "↻"} Tool · {item.tool}
          <span className="tbadge">{item.status}</span>
        </div>
        <div className="tool-b">
          {item.contentItems?.map((entry, index) => (
            <div key={`${item.id}-${index}`}>{JSON.stringify(entry)}</div>
          )) ?? "No tool payload."}
        </div>
      </div>
    );
  }

  if (item.type === "collabAgentToolCall") {
    return (
      <div className="agc">
        <div className="agh">
          <div className="agdot" />
          <span className="agn">⑂ {item.tool}</span>
          <span className="ags">{item.status}</span>
        </div>
        <div className="agt">{item.prompt ?? "Subagent activity"}</div>
        <div className="agprog">
          <div
            className="agbar"
            style={{ width: item.status === "completed" ? "100%" : "58%" }}
          />
        </div>
      </div>
    );
  }

  if (item.type === "webSearch") {
    return (
      <div className="tool ok">
        <div className="tool-h">
          ✓ Web search
          <span className="tbadge">search</span>
        </div>
        <div className="tool-b">{item.query}</div>
      </div>
    );
  }

  if (item.type === "imageView") {
    return (
      <div className="image-card">
        <div className="tool-h">
          🖼 Image
          <span className="tbadge">view</span>
        </div>
        <div className="tool-b">{item.path}</div>
      </div>
    );
  }

  if (item.type === "imageGeneration") {
    return (
      <div className="tool ok">
        <div className="tool-h">
          ✓ Image generation
          <span className="tbadge">{item.status}</span>
        </div>
        <div className="tool-b">
          <div>{item.revisedPrompt}</div>
          <div>{item.result}</div>
        </div>
      </div>
    );
  }

  if (item.type === "enteredReviewMode" || item.type === "exitedReviewMode") {
    return (
      <div className="compact-bar">
        <span className="compact-ico">
          {item.type === "enteredReviewMode" ? "🔍" : "✓"}
        </span>
        <span>{item.review}</span>
      </div>
    );
  }

  if (item.type === "contextCompaction") {
    return (
      <div className="compact-bar">
        <span className="compact-ico">🗜</span>
        <span>Conversation compacted to free context tokens.</span>
      </div>
    );
  }

  return null;
});

function DiffCard({
  item,
  onReview,
}: {
  item: Extract<ThreadItem, { type: "fileChange" }>;
  onReview: (diffId?: string) => void;
}) {
  const liveLabel =
    item.status === "inProgress"
      ? "editing"
      : item.status === "completed"
        ? "applied"
        : item.status === "failed"
          ? "failed"
          : item.status;
  const changes =
    item.changes.length > 0
      ? item.changes
      : [
          {
            path: "Editing files",
            kind: { type: "update", move_path: null } as const,
            diff: "",
          },
        ];

  return (
    <>
      {changes.map((change, index) => (
        <div
          className={clsx("dw", item.status === "inProgress" && "live")}
          key={`${item.id}-${change.path}-${index}`}
        >
          <div className="dh">
            📄 {change.path}
            <div className="diff-head-actions">
              <button
                className="diff-review"
                type="button"
                onClick={() => onReview(diffEntryId(item.id, index, change.path))}
              >
                Review diff
              </button>
              <span className="dstats">
                {change.kind.type === "add" ? (
                  <span className="diff-new">new</span>
                ) : null}
                {change.kind.type === "update" ? (
                  <span className="diff-mod">mod</span>
                ) : null}
                {change.kind.type === "delete" ? (
                  <span className="diff-del">del</span>
                ) : null}
                <span
                  className={clsx(
                    "diff-status",
                    item.status === "inProgress" && "live",
                    item.status === "failed" && "err",
                  )}
                >
                  {liveLabel}
                </span>
              </span>
            </div>
          </div>
          {change.diff ? (
            change.diff.split("\n").map((line, lineIndex) => (
              <div
                className={clsx(
                  "dl",
                  line.startsWith("+") && "add",
                  line.startsWith("-") && "rem",
                  !line.startsWith("+") && !line.startsWith("-") && "ctx",
                )}
                key={`${change.path}-${lineIndex}`}
              >
                {line}
              </div>
            ))
          ) : (
            <div className="dl ctx">Waiting for diff…</div>
          )}
        </div>
      ))}
    </>
  );
}
