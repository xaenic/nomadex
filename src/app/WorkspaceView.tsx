import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import clsx from "clsx";

import type { ThreadItem, Turn } from "../protocol/v2";
import {
  getUserMessageDisplay,
  parseInlineSegments,
  parseMessageBlocks,
  toBrowseUrl,
  toRenderableImageUrl,
} from "./codexUiBridge";
import type {
  DashboardData,
  MentionAttachment,
  SettingsState,
  ThreadRecord,
} from "./mockData";
import {
  approvalModeFromSettings,
  buildComposerHighlightSegments,
  buildDiffReviewLines,
  composerHasMentionToken,
  diffEntryId,
  diffKindLabel,
  formatTurnErrorCode,
  getFileAttachmentPreview,
  settingsPatchFromApprovalMode,
  shorten,
  turnErrorText,
} from "./workspaceHelpers";
import type {
  DiffReviewEntry,
  FilePreviewState,
  QueuedComposerMessage,
  ToastTone,
  UiThemeId,
  UiThemeOption,
  WorkspaceActions,
} from "./workspaceTypes";

type TextStreamFx = {
  from: number;
  to: number;
};

export function WelcomeState({
  onFill,
  onSlash,
}: {
  onFill: (value: string) => void;
  onSlash: (value: string) => void;
}) {
  return (
    <div className="ww">
      <div className="wico">⬡</div>
      <h1>Nomadex</h1>
      <p>
        Agentic coding assistant — reads repos, patches files, runs sandboxed
        commands, streams live turns, and tracks operational state inline.
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
    <div className="ww">
      <div className="wico">…</div>
      <h1>Loading conversation</h1>
      <p>
        Reattaching this saved thread and pulling its history into the
        transcript.
      </p>
      <div className="wbadges">
        <div className="wbadge">Thread</div>
        <div className="wbadge">{shorten(threadLabelText, 42)}</div>
        <div className="wbadge">History sync</div>
      </div>
      <p className="welcome-foot">
        The starter cards are hidden until the saved turns are loaded.
      </p>
    </div>
  );
}

export function ProjectFolderPickerModal({
  activePath,
  breadcrumbs,
  busy,
  entries,
  loading,
  onClose,
  onNavigate,
  onPick,
  parentPath,
}: {
  activePath: string;
  breadcrumbs: Array<{
    label: string;
    path: string;
  }>;
  busy: boolean;
  entries: Array<MentionAttachment>;
  loading: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onPick: (path: string) => void;
  parentPath: string | null;
}) {
  return (
    <div
      className="project-picker-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="project-picker-modal">
        <div className="project-picker-head">
          <div className="project-picker-copy">
            <div className="project-picker-title">Start New Session</div>
            <div className="project-picker-subtitle">
              Pick the project folder to use as this session&apos;s working
              directory.
            </div>
          </div>
          <button
            aria-label="Close project picker"
            className="project-picker-close"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="project-picker-breadcrumbs">
          {breadcrumbs.map((crumb) => (
            <button
              className={clsx(
                "project-picker-crumb",
                crumb.path === activePath && "active",
              )}
              disabled={busy}
              key={crumb.path}
              onClick={() => onNavigate(crumb.path)}
              type="button"
            >
              {crumb.label}
            </button>
          ))}
        </div>

        <div className="project-picker-toolbar">
          {parentPath ? (
            <button
              className="project-picker-action"
              disabled={busy}
              onClick={() => onNavigate(parentPath)}
              type="button"
            >
              ← Up
            </button>
          ) : (
            <span className="project-picker-root">Root</span>
          )}

          <button
            className="project-picker-start"
            disabled={busy || loading}
            onClick={() => onPick(activePath)}
            type="button"
          >
            {busy ? "Starting…" : "Use This Folder"}
          </button>
        </div>

        <div className="project-picker-current">{activePath}</div>

        <div className="project-picker-list">
          {loading ? (
            <div className="project-picker-empty">Loading folders…</div>
          ) : entries.length === 0 ? (
            <div className="project-picker-empty">
              No folders found here.
            </div>
          ) : (
            entries.map((entry) => (
              <button
                className="project-picker-entry"
                disabled={busy}
                key={entry.id}
                onClick={() => onNavigate(entry.path)}
                type="button"
              >
                <span className="project-picker-entry-icon">📁</span>
                <span className="project-picker-entry-copy">
                  <span className="project-picker-entry-name">
                    {entry.name}
                  </span>
                  <span className="project-picker-entry-path">
                    {entry.path}
                  </span>
                </span>
                <span className="project-picker-entry-arrow">→</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function QueuedMessagesStrip({
  messages,
  onSteer,
  onDelete,
}: {
  messages: Array<QueuedComposerMessage>;
  onSteer: (messageId: string) => void;
  onDelete: (messageId: string) => void;
}) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="queued-messages">
      <div className="queued-messages-inner">
        {messages.map((message) => {
          const fallbackText =
            message.prompt.trim() ||
            [
              message.images.length > 0 ? `${message.images.length} image` : "",
              message.files.length > 0 ? `${message.files.length} upload` : "",
              message.mentions.length > 0 ? `${message.mentions.length} file` : "",
              message.skills.length > 0 ? `${message.skills.length} skill` : "",
            ]
              .filter(Boolean)
              .join(" · ");

          return (
            <div className="queued-row" key={message.id}>
              <span className="queued-row-icon">💬</span>
              <span className="queued-row-text">
                {shorten(fallbackText || "Queued follow-up", 96)}
              </span>
              <div className="queued-row-actions">
                <button
                  className="queued-row-steer"
                  type="button"
                  onClick={() => onSteer(message.id)}
                >
                  Steer
                </button>
                <button
                  aria-label="Delete queued message"
                  className="queued-row-delete"
                  type="button"
                  onClick={() => onDelete(message.id)}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const ComposerTextarea = memo(function ComposerTextarea({
  value,
  mentions,
  placeholder,
  textareaRef,
  composerMirrorRef,
  onPaste,
  onValueChange,
  onKeyDown,
}: {
  value: string;
  mentions: Array<MentionAttachment>;
  placeholder: string;
  textareaRef: { current: HTMLTextAreaElement | null };
  composerMirrorRef: { current: HTMLDivElement | null };
  onPaste?: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onValueChange: (value: string) => void;
  onKeyDown: (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);

  const activeMentions = useMemo(
    () => mentions.filter((mention) => composerHasMentionToken(draft, mention)),
    [draft, mentions],
  );

  const highlightSegments = useMemo(
    () =>
      activeMentions.length > 0
        ? buildComposerHighlightSegments(draft, activeMentions)
        : [],
    [activeMentions, draft],
  );

  const syncMirrorScroll = useCallback(() => {
    if (activeMentions.length === 0) {
      return;
    }

    const textarea = textareaRef.current;
    const mirror = composerMirrorRef.current;
    if (!textarea || !mirror) {
      return;
    }

    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
  }, [activeMentions.length, composerMirrorRef, textareaRef]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) {
      return;
    }

    if (!draft) {
      node.style.height = "24px";
    } else {
      node.style.height = "auto";
      node.style.height = `${Math.min(node.scrollHeight, 140)}px`;
    }

    syncMirrorScroll();
  }, [draft, syncMirrorScroll, textareaRef]);

  const handleChange = useCallback(
    (event: ReactChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = event.target.value;
      setDraft(nextValue);
      onValueChange(nextValue);
    },
    [onValueChange],
  );

  return (
    <div className="composer-text-shell">
      {activeMentions.length > 0 ? (
        <div className="composer-mirror" ref={composerMirrorRef} aria-hidden="true">
          {draft
            ? highlightSegments.map((segment, index) => (
                <span
                  className={clsx(
                    "composer-segment",
                    segment.mention && "file",
                  )}
                  key={`${segment.text}-${index}`}
                >
                  {segment.text}
                </span>
              ))
            : null}
        </div>
      ) : null}
      {!draft ? <span className="composer-placeholder">{placeholder}</span> : null}
      <textarea
        id="ta"
        ref={textareaRef}
        rows={1}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        placeholder=""
        spellCheck={false}
        value={draft}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onScroll={syncMirrorScroll}
      />
    </div>
  );
});

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
                turnStatus={turn.status}
                streaming={item.type === "agentMessage" && item.id === liveAgentMessageId}
                textVisible={
                  item.type === "agentMessage"
                    ? streamVisible[`${item.id}:text`]
                    : undefined
                }
                textFx={
                  item.type === "agentMessage"
                    ? streamTextFx[`${item.id}:text`]
                    : undefined
                }
                outputVisible={
                  item.type === "commandExecution"
                    ? streamVisible[`${item.id}:aggregatedOutput`]
                    : undefined
                }
                onCopy={onCopy}
                onFork={onFork}
                onPlan={onPlan}
                onReview={onReview}
                onEdit={onEdit}
                onContext={onContext}
                onOpenFile={onOpenFile}
              />
            ))}
            {errorText ? (
              <TurnErrorCard
                status={turn.status}
                text={errorText}
                code={formatTurnErrorCode(turn.error?.codexErrorInfo ?? null)}
                onOpenFile={onOpenFile}
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
      return "⟳ Running";
    case "completed":
      return item.exitCode === 0 ? "✓ Completed" : `✗ Exit ${item.exitCode ?? "?"}`;
    case "failed":
      return "✗ Failed";
    case "declined":
      return "⊘ Declined";
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
        <span className="mn">Codex</span>
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
            <span className="message-text-tail">
              {text.slice(fadeFrom, fadeTo)}
            </span>
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
          <p
            className="message-text"
            key={`text-${index}`}
          >
            {stablePrefix ? (
              <MessageInlineFlow
                onOpenFile={onOpenFile}
                text={stablePrefix}
              />
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
              <MessageInlineFlow
                onOpenFile={onOpenFile}
                text={trailingSuffix}
              />
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

  const commandStatus =
    item.type === "commandExecution" ? item.status : null;

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
      collapseTimer = window.setTimeout(
        () => setCommandExpanded(false),
        1000,
      );
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
      <div
        className="msg user"
        onContextMenu={(event) => onContext(event, item)}
      >
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
      typeof textVisible === "number"
        ? item.text.slice(0, textVisible)
        : item.text;

    return (
      <div
        className={clsx("msg assistant", streaming && "streaming")}
        onContextMenu={(event) => onContext(event, item)}
      >
        <div className="mh">
          <div className="mav a">⬡</div>
          <span className="mn">Codex</span>
          <span className="mt">{turnStatus === "inProgress" ? "live" : turnStatus}</span>
        </div>
        <div className="mb">
          {text ? (
            <MessageTextFlow
              onOpenFile={onOpenFile}
              showCursor={streaming}
              streaming={streaming}
              text={text}
              textFx={textFx}
            />
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

    return (
      <div className="cmd-inline">
        <button
          className={clsx("cmd-inline-row", badge, commandExpanded && "open")}
          type="button"
          onClick={() => setCommandExpanded((current) => !current)}
        >
          <span className={clsx("cmd-inline-chevron", commandExpanded && "open")}>
            ▶
          </span>
          <code className="cmd-inline-label">{item.command || "(command)"}</code>
          <span className="cmd-inline-status">{commandStatusLabel(item)}</span>
        </button>
        {commandExpanded ? (
          <div className="cmd-inline-output">
            <div className="cmd-inline-meta">
              {item.cwd} · {item.processId ?? "pty"}
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

export function DiffPatchViewer({ entry }: { entry: DiffReviewEntry }) {
  const rows = buildDiffReviewLines(entry.diff);

  if (rows.length === 0) {
    return <div className="diff-patch-empty">Waiting for diff…</div>;
  }

  return (
    <div className="diff-patch-viewer">
      {rows.map((row) => (
        <div className={clsx("diff-patch-row", row.kind)} key={row.id}>
          <span className="diff-patch-num">{row.oldLine ?? ""}</span>
          <span className="diff-patch-num">{row.newLine ?? ""}</span>
          <pre className="diff-patch-text">{row.text || " "}</pre>
        </div>
      ))}
    </div>
  );
}

export function DiffReviewPage({
  backLabel = "Back to Chat",
  diffEntries,
  findings,
  onBack,
  onSelectEntry,
  selectedEntryId,
}: {
  backLabel?: string;
  diffEntries: Array<DiffReviewEntry>;
  findings: ThreadRecord["review"];
  onBack: () => void;
  onSelectEntry: (entryId: string) => void;
  selectedEntryId: string | null;
}) {
  const selectedEntry = useMemo(
    () =>
      diffEntries.find((entry) => entry.id === selectedEntryId) ??
      diffEntries[0] ??
      null,
    [diffEntries, selectedEntryId],
  );
  const totalAdditions = useMemo(
    () => diffEntries.reduce((sum, entry) => sum + entry.additions, 0),
    [diffEntries],
  );
  const totalRemovals = useMemo(
    () => diffEntries.reduce((sum, entry) => sum + entry.removals, 0),
    [diffEntries],
  );

  return (
    <div id="review-page">
      <div className="diff-review-shell page">
        <div className="diff-review-page-head">
          <button className="file-editor-back" onClick={onBack} type="button">
            ← {backLabel}
          </button>
          <div className="diff-review-page-copy">
            <div className="diff-review-page-title">Patch review</div>
            <div className="diff-review-page-subtitle">
              {diffEntries.length} changed file
              {diffEntries.length === 1 ? "" : "s"} · +{totalAdditions} / -
              {totalRemovals}
            </div>
          </div>
        </div>

        {diffEntries.length === 0 ? (
          <div className="empty-panel">No diff items in this thread yet.</div>
        ) : (
          <div className="diff-review-layout page">
            <div className="diff-review-sidebar">
              {diffEntries.map((entry) => (
                <button
                  className={clsx(
                    "diff-review-entry",
                    selectedEntry?.id === entry.id && "active",
                  )}
                  key={entry.id}
                  type="button"
                  onClick={() => onSelectEntry(entry.id)}
                >
                  <div className="diff-review-entry-top">
                    <span
                      className={clsx(
                        "diff-kind-pill",
                        entry.kind.type === "add" && "new",
                        entry.kind.type === "delete" && "del",
                      )}
                    >
                      {diffKindLabel(entry.kind)}
                    </span>
                    <span
                      className={clsx(
                        "diff-status",
                        entry.status === "inProgress" && "live",
                        entry.status === "failed" && "err",
                      )}
                    >
                      {entry.status === "inProgress" ? "editing" : entry.status}
                    </span>
                  </div>
                  <div className="diff-review-entry-path">{entry.path}</div>
                  <div className="diff-review-entry-meta">
                    <span>+{entry.additions}</span>
                    <span>-{entry.removals}</span>
                    <span>
                      {entry.hunks} hunk{entry.hunks === 1 ? "" : "s"}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {selectedEntry ? (
              <div className="diff-review-main">
                <div className="diff-focus-head">
                  <div className="diff-focus-title">{selectedEntry.path}</div>
                  <div className="diff-focus-meta">
                    <span
                      className={clsx(
                        "diff-kind-pill",
                        selectedEntry.kind.type === "add" && "new",
                        selectedEntry.kind.type === "delete" && "del",
                      )}
                    >
                      {diffKindLabel(selectedEntry.kind)}
                    </span>
                    <span
                      className={clsx(
                        "diff-status",
                        selectedEntry.status === "inProgress" && "live",
                        selectedEntry.status === "failed" && "err",
                      )}
                    >
                      {selectedEntry.status === "inProgress"
                        ? "editing"
                        : selectedEntry.status}
                    </span>
                    <span className="diff-stat-chip">+{selectedEntry.additions}</span>
                    <span className="diff-stat-chip">-{selectedEntry.removals}</span>
                    <span className="diff-stat-chip">
                      {selectedEntry.hunks} hunk
                      {selectedEntry.hunks === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <DiffPatchViewer entry={selectedEntry} />
              </div>
            ) : null}
          </div>
        )}

        {findings.length > 0 ? (
          <div className="review-list">
            {findings.map((finding) => (
              <div
                className={clsx("review-item", finding.severity)}
                key={finding.id}
              >
                <div className="review-header">
                  <span>{finding.severity}</span>
                  <span>{finding.file.split("/").slice(-2).join("/")}</span>
                  <span>:{finding.line}</span>
                </div>
                <div className="review-title">{finding.title}</div>
                <div className="review-summary">{finding.summary}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function FileEditorPreview({
  preview,
  variant = "panel",
  onBack,
  backLabel = "Back",
}: {
  preview: FilePreviewState;
  variant?: "panel" | "page";
  onBack?: () => void;
  backLabel?: string;
}) {
  const highlightedLine = preview.line;
  const lines = preview.loading || preview.error ? [] : preview.content.split("\n");
  const browseHref = toBrowseUrl(preview.path);
  const activeLineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeLineRef.current || preview.loading) {
      return;
    }

    activeLineRef.current.scrollIntoView({
      block: "center",
    });
  }, [highlightedLine, preview.loading, preview.path]);

  return (
    <div className={clsx("file-editor", variant === "page" && "page")}>
      <div className="file-editor-head">
        {variant === "page" ? (
          <button className="file-editor-back" onClick={onBack} type="button">
            ← {backLabel}
          </button>
        ) : null}
        <div className="file-editor-copy">
          <div className="file-editor-title">{preview.name}</div>
          <div className="file-editor-path">{preview.path}</div>
        </div>
        <div className="file-editor-actions">
          {browseHref !== "#" ? (
            <a className="file-editor-link" href={browseHref} rel="noreferrer noopener" target="_blank">
              Open raw
            </a>
          ) : null}
        </div>
      </div>
      <div className="file-editor-body">
        {preview.loading ? <div className="file-editor-empty">Opening file…</div> : null}
        {!preview.loading && preview.error ? (
          <div className="file-editor-empty">{preview.error}</div>
        ) : null}
        {!preview.loading && !preview.error ? (
          <div className="file-editor-code" role="presentation">
            {lines.map((line, index) => (
              <div
                className={clsx(
                  "file-editor-line",
                  highlightedLine === index + 1 && "active",
                )}
                key={`${preview.path}:${index}`}
                ref={
                  highlightedLine === index + 1
                    ? activeLineRef
                    : undefined
                }
              >
                <span className="file-editor-gutter">{index + 1}</span>
                <code className="file-editor-text">{line || " "}</code>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const formatRateReset = (resetsAt: number | null) => {
  if (!resetsAt) {
    return "Reset time unavailable";
  }

  const resetDate = new Date(resetsAt * 1000);
  const now = Date.now();
  const diff = resetDate.getTime() - now;

  if (diff <= 1000 * 60 * 60 * 24) {
    return `Resets ${resetDate.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  return `Resets ${resetDate.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
};

const skillMatchesQuery = (
  skill: {
    name: string;
    description: string;
    tags?: string[];
    repo?: string;
    downloads?: string;
    scope?: string;
  },
  query: string,
) => {
  if (!query) {
    return true;
  }

  const haystack = [
    skill.name,
    skill.description,
    skill.scope ?? "",
    skill.repo ?? "",
    skill.downloads ?? "",
    ...(skill.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
};

export function SkillsLibraryModal({
  snapshot,
  actions,
  onClose,
  pushToast,
}: {
  snapshot: DashboardData;
  actions: WorkspaceActions;
  onClose: () => void;
  pushToast: (message: string, tone: ToastTone) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const enabledCount = useMemo(
    () => snapshot.installedSkills.filter((skill) => skill.enabled).length,
    [snapshot.installedSkills],
  );
  const filteredInstalledSkills = useMemo(
    () =>
      snapshot.installedSkills.filter((skill) =>
        skillMatchesQuery(skill, normalizedQuery),
      ),
    [normalizedQuery, snapshot.installedSkills],
  );
  const filteredRemoteSkills = useMemo(
    () =>
      snapshot.remoteSkills.filter((skill) =>
        skillMatchesQuery(skill, normalizedQuery),
      ),
    [normalizedQuery, snapshot.remoteSkills],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="skills-library-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="skills-library-modal">
        <div className="skills-library-hero">
          <div className="skills-library-copy">
            <div className="skills-library-kicker">Nomadex Skill Library</div>
            <div className="skills-library-title">
              Manage installed and remote skills in one place
            </div>
            <div className="skills-library-subtitle">
              Toggle what stays active globally, browse marketplace packs, and
              keep the composer focused on actual prompts instead of setup.
            </div>
          </div>
          <button
            aria-label="Close skill library"
            className="skills-library-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="skills-library-toolbar">
          <div className="skills-library-stats">
            <div className="skills-library-stat">
              <strong>{snapshot.installedSkills.length}</strong>
              <span>Installed</span>
            </div>
            <div className="skills-library-stat">
              <strong>{enabledCount}</strong>
              <span>Enabled</span>
            </div>
            <div className="skills-library-stat">
              <strong>{snapshot.remoteSkills.length}</strong>
              <span>Marketplace</span>
            </div>
          </div>
          <input
            autoFocus
            className="skills-library-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills, tags, repo, or description…"
            value={query}
          />
        </div>

        <div className="skills-library-grid">
          <section className="skills-library-pane">
            <div className="skills-library-pane-head">
              <div>
                <div className="skills-library-pane-title">Installed</div>
                <div className="skills-library-pane-copy">
                  Toggle globally available skills and inspect their local path.
                </div>
              </div>
              <span className="skills-library-pane-count">
                {filteredInstalledSkills.length}
              </span>
            </div>

            <div className="skills-library-list">
              {filteredInstalledSkills.length === 0 ? (
                <div className="skills-library-empty">
                  No installed skills matched this search.
                </div>
              ) : (
                filteredInstalledSkills.map((skill) => (
                  <article
                    className={clsx(
                      "skills-library-card installed",
                      skill.enabled && "enabled",
                    )}
                    key={skill.id}
                  >
                    <div className="skills-library-card-head">
                      <div>
                        <div className="skills-library-card-title">
                          {skill.name}
                        </div>
                        <div className="skills-library-card-meta">
                          <span className="skills-library-chip">
                            {skill.scope}
                          </span>
                          <span
                            className={clsx(
                              "skills-library-chip",
                              skill.enabled && "live",
                            )}
                          >
                            {skill.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </div>
                      <button
                        className={clsx(
                          "skills-library-action",
                          skill.enabled && "active",
                        )}
                        onClick={() => void actions.toggleInstalledSkill(skill.id)}
                        type="button"
                      >
                        {skill.enabled ? "Disable" : "Enable"}
                      </button>
                    </div>
                    <div className="skills-library-card-description">
                      {skill.description}
                    </div>
                    {skill.tags.length > 0 ? (
                      <div className="skills-library-tag-row">
                        {skill.tags.map((tag) => (
                          <span className="skills-library-tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <code className="skills-library-path">{skill.path}</code>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="skills-library-pane marketplace">
            <div className="skills-library-pane-head">
              <div>
                <div className="skills-library-pane-title">Marketplace</div>
                <div className="skills-library-pane-copy">
                  Install remote skills into your local Codex skill catalog.
                </div>
              </div>
              <span className="skills-library-pane-count">
                {filteredRemoteSkills.length}
              </span>
            </div>

            <div className="skills-library-list">
              {filteredRemoteSkills.length === 0 ? (
                <div className="skills-library-empty">
                  No marketplace skills matched this search.
                </div>
              ) : (
                filteredRemoteSkills.map((skill) => (
                  <article
                    className="skills-library-card remote"
                    key={skill.id}
                  >
                    <div className="skills-library-card-head">
                      <div>
                        <div className="skills-library-card-title">
                          {skill.name}
                        </div>
                        <div className="skills-library-card-meta">
                          <span className="skills-library-chip">
                            {skill.downloads} downloads
                          </span>
                          <span className="skills-library-chip">
                            {skill.repo}
                          </span>
                        </div>
                      </div>
                      <button
                        className="skills-library-action install"
                        onClick={() => {
                          void actions.installSkill(skill.id);
                          pushToast(`Installing ${skill.name}`, "ok");
                        }}
                        type="button"
                      >
                        Install
                      </button>
                    </div>
                    <div className="skills-library-card-description">
                      {skill.description}
                    </div>
                    {skill.tags.length > 0 ? (
                      <div className="skills-library-tag-row">
                        {skill.tags.map((tag) => (
                          <span className="skills-library-tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function ThemePickerPanel({
  activeTheme,
  onClose,
  onSelect,
  themes,
}: {
  activeTheme: UiThemeId;
  onClose: () => void;
  onSelect: (themeId: UiThemeId) => void;
  themes: Array<UiThemeOption>;
}) {
  return (
    <div
      className="theme-picker-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div id="tpicker">
        <div className="tpicker-head">
          <div>
            <div className="tpicker-title">Theme</div>
            <div className="tpicker-subtitle">Transparent shell palettes for Nomadex.</div>
          </div>
          <button className="tpicker-close" onClick={onClose} type="button" aria-label="Close theme picker">
            ×
          </button>
        </div>
        <div className="tpicker-grid">
          {themes.map((theme) => (
            <button
              className={clsx("theme-card", activeTheme === theme.id && "active")}
              key={theme.id}
              onClick={() => onSelect(theme.id)}
              type="button"
            >
              <div className="theme-card-preview">
                <span className="theme-card-surface" style={{ background: theme.swatches[0] }} />
                <span className="theme-card-accent" style={{ background: theme.swatches[1] }} />
                <span className="theme-card-accent" style={{ background: theme.swatches[2] }} />
              </div>
              <div className="theme-card-copy">
                <div className="theme-card-name">
                  {theme.name}
                  <span className="theme-card-mode">{theme.mode}</span>
                </div>
                <div className="theme-card-description">{theme.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ConfigPanel({
  snapshot,
  activeThreadLabel,
  actions,
  pushToast,
  selectModel,
  activeTheme,
  onOpenSkills,
  onOpenTheme,
}: {
  snapshot: DashboardData;
  activeThreadLabel: string;
  actions: WorkspaceActions;
  pushToast: (message: string, tone: ToastTone) => void;
  selectModel: (modelId: string) => Promise<void>;
  activeTheme: UiThemeId;
  onOpenSkills: () => void;
  onOpenTheme: () => void;
}) {
  const [mobileCallbackUrl, setMobileCallbackUrl] = useState("");
  const activeThemeLabel =
    activeTheme.charAt(0).toUpperCase() + activeTheme.slice(1);

  const handleChatGptLogin = useCallback(async () => {
    try {
      const authUrl = await actions.startChatGptLogin();
      if (authUrl) {
        window.open(authUrl, "_blank", "noopener,noreferrer");
      }
      pushToast(snapshot.account.loggedIn ? "Opened ChatGPT account switch" : "Opened ChatGPT sign-in", "ok");
      pushToast("If mobile redirects to localhost:1455, paste that callback URL below.", "");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to start ChatGPT login", "err");
    }
  }, [actions, pushToast, snapshot.account.loggedIn]);

  const handleCompleteMobileLogin = useCallback(async () => {
    if (!mobileCallbackUrl.trim()) {
      pushToast("Paste the full callback URL first", "warn");
      return;
    }

    try {
      await actions.completeChatGptLogin(mobileCallbackUrl.trim());
      setMobileCallbackUrl("");
      pushToast("Mobile sign-in completed", "ok");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to complete mobile sign-in", "err");
    }
  }, [actions, mobileCallbackUrl, pushToast]);

  const handleApiKeyLogin = useCallback(async () => {
    const apiKey = window.prompt(
      snapshot.account.authMode === "apiKey" ? "Enter the replacement API key" : "Enter your OpenAI API key",
      "",
    );

    if (!apiKey?.trim()) {
      return;
    }

    try {
      await actions.loginWithApiKey(apiKey.trim());
      pushToast("API key account connected", "ok");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to connect API key", "err");
    }
  }, [actions, pushToast, snapshot.account.authMode]);

  const handleLogout = useCallback(async () => {
    try {
      await actions.logoutAccount();
      pushToast("Signed out of Codex", "ok");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to sign out", "err");
    }
  }, [actions, pushToast]);

  const handleRefreshAccount = useCallback(async () => {
    try {
      await actions.refreshAccount();
      pushToast("Account status refreshed", "ok");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to refresh account", "err");
    }
  }, [actions, pushToast]);

  return (
    <div className="config-stack">
      <div className="sg">
        <div className="sg-t">Account</div>
        <div className="account-card">
          <div className="account-head">
            <div>
              <strong>{snapshot.account.loggedIn ? snapshot.account.workspace : "No active account"}</strong>
              <div className="account-copy">
                {snapshot.account.planType} · {snapshot.account.authMode}
              </div>
            </div>
            <span className={clsx("account-badge", snapshot.account.loggedIn ? "ok" : "off")}>
              {snapshot.account.loginInProgress ? "Signing in…" : snapshot.account.loggedIn ? "Active" : "Signed out"}
            </span>
          </div>
          <div className="account-meta">
            <span>{snapshot.account.credits}</span>
            {snapshot.account.requiresOpenaiAuth ? <span>OpenAI auth required</span> : null}
          </div>
          <div className="usage-limit-list">
            {snapshot.account.usageWindows.map((windowEntry) => (
              <div className="usage-limit-card" key={windowEntry.id}>
                <div className="usage-limit-head">
                  <strong>{windowEntry.label}</strong>
                  <span>{Math.round(windowEntry.usedPercent)}% used</span>
                </div>
                <div className="usage-limit-bar">
                  <span
                    className="usage-limit-fill"
                    style={{ width: `${Math.max(0, Math.min(100, windowEntry.usedPercent))}%` }}
                  />
                </div>
                <div className="usage-limit-copy">{formatRateReset(windowEntry.resetsAt)}</div>
              </div>
            ))}
            {snapshot.account.usageWindows.length === 0 ? (
              <div className="usage-limit-empty">Sign in to view your 5-hour and weekly Codex usage.</div>
            ) : null}
          </div>
          <div className="account-actions">
            <button className="mini-action" type="button" onClick={() => void handleRefreshAccount()}>
              Refresh
            </button>
            <button className="mini-action" type="button" onClick={() => void handleChatGptLogin()}>
              {snapshot.account.authMode === "chatgpt" ? "Switch ChatGPT" : "Use ChatGPT"}
            </button>
            <button className="mini-action" type="button" onClick={() => void handleApiKeyLogin()}>
              {snapshot.account.authMode === "apiKey" ? "Replace API key" : "Use API key"}
            </button>
            {snapshot.account.loggedIn ? (
              <button className="mini-action danger" type="button" onClick={() => void handleLogout()}>
                Log out
              </button>
            ) : null}
          </div>
          {snapshot.account.loginInProgress ? (
            <div className="account-helper">
              <div className="account-helper-copy">
                On mobile, if ChatGPT returns to <code>localhost:1455</code>, copy that full URL and paste it here.
                You can also replace the failed callback host with <code>{typeof window !== "undefined" ? window.location.origin : ""}</code>
                and keep the same path/query.
              </div>
              <div className="account-callback-form">
                <input
                  className="account-callback-input"
                  placeholder="http://localhost:1455/auth/callback?code=…&state=…"
                  value={mobileCallbackUrl}
                  onChange={(event) => setMobileCallbackUrl(event.target.value)}
                />
                <button className="mini-action" type="button" onClick={() => void handleCompleteMobileLogin()}>
                  Finish mobile login
                </button>
              </div>
            </div>
          ) : null}
          {snapshot.account.loginError ? <div className="account-error">{snapshot.account.loginError}</div> : null}
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">Model</div>
        <div className="sr">
          <span className="sl">model</span>
          <select
            className="ssel"
            value={snapshot.settings.model}
            onChange={(event) => void selectModel(event.target.value)}
          >
            {snapshot.models.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="sr">
          <span className="sl">reasoning_effort</span>
          <select
            className="ssel"
            value={snapshot.settings.reasoningEffort}
            onChange={(event) =>
              void actions.updateSettings({
                reasoningEffort: event.target.value as SettingsState["reasoningEffort"],
              })
            }
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="xhigh">xhigh</option>
          </select>
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">Approval &amp; Sandbox</div>
        <div className="sr">
          <span className="sl">approval_policy</span>
          <select
            className="ssel"
            value={approvalModeFromSettings(snapshot.settings)}
            onChange={(event) =>
              void actions.updateSettings(
                settingsPatchFromApprovalMode(
                  event.target.value as ReturnType<typeof approvalModeFromSettings>,
                ),
              )
            }
          >
            <option value="auto">auto</option>
            <option value="ro">read-only</option>
            <option value="fa">full-access</option>
          </select>
        </div>
        <div className="sr">
          <span className="sl">sandbox</span>
          <select
            className="ssel"
            value={snapshot.settings.sandboxMode}
            onChange={(event) =>
              void actions.updateSettings({
                sandboxMode: event.target.value as SettingsState["sandboxMode"],
              })
            }
          >
            <option value="workspace-write">workspace-write</option>
            <option value="read-only">read-only</option>
            <option value="danger-full-access">danger-full-access</option>
          </select>
        </div>
        <div className="sr">
          <span className="sl">web_search</span>
          <div
            className={clsx("tog", snapshot.settings.webSearch && "on")}
            onClick={() =>
              void actions.updateSettings({
                webSearch: !snapshot.settings.webSearch,
              })
            }
            role="button"
            tabIndex={0}
            onKeyDown={() => undefined}
          />
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">Appearance</div>
        <div className="config-shortcut-card appearance-shortcut-card">
          <div className="config-shortcut-copy">
            <strong>{activeThemeLabel} theme active</strong>
            <span>Ambient background, translucent panels, and persistent palette selection.</span>
          </div>
          <button className="mini-action" onClick={onOpenTheme} type="button">
            Open Theme Picker
          </button>
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">Skills</div>
        <div className="config-shortcut-card skill-shortcut-card">
          <div className="config-shortcut-copy">
            <strong>Skills moved into a dedicated library</strong>
            <span>
              {snapshot.installedSkills.length} installed ·{" "}
              {snapshot.installedSkills.filter((skill) => skill.enabled).length} enabled
              · {snapshot.remoteSkills.length} available to install
            </span>
          </div>
          <button className="mini-action" onClick={onOpenSkills} type="button">
            Open Skills Library
          </button>
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">MCP</div>
        {snapshot.mcpServers.map((server) => (
          <div className="mcp-card" key={server.name}>
            <div className="mcp-head">
              <strong>{server.name}</strong>
              <span>{server.authStatus}</span>
            </div>
            <div className="mcp-tools">
              {Object.keys(server.tools).slice(0, 4).join(" · ")}
            </div>
            <button
              className="mini-action"
              type="button"
              onClick={() => void actions.toggleMcpAuth(server.name)}
            >
              {server.authStatus === "notLoggedIn" ? "Connect" : "Refresh"}
            </button>
          </div>
        ))}
      </div>

      <div className="sg">
        <div className="sg-t">
          Feature Flags{" "}
          <button
            className="feature-refresh"
            type="button"
            onClick={() => pushToast("codex features list", "ok")}
          >
            ⟳
          </button>
        </div>
        {snapshot.featureFlags.map((flag) => (
          <div className="sr" key={flag.name}>
            <span className="sl">
              {flag.name} <small>({flag.stage})</small>
            </span>
            <div
              className={clsx("tog", flag.enabled && "on")}
              onClick={() => void actions.toggleFeatureFlag(flag.name)}
              role="button"
              tabIndex={0}
              onKeyDown={() => undefined}
            />
          </div>
        ))}
      </div>

      <div className="config-preview">
        <div className="config-title">~/.codex/config.toml</div>
        <div># Nomadex config</div>
        <div>model = "{snapshot.settings.model}"</div>
        <div>approval_policy = "{snapshot.settings.approvalPolicy}"</div>
        <div>model_reasoning_effort = "{snapshot.settings.reasoningEffort}"</div>
        <div>web_search = "{snapshot.settings.webSearch ? "live" : "disabled"}"</div>
        <br />
        <div>[features]</div>
        {snapshot.featureFlags.slice(0, 4).map((flag) => (
          <div key={flag.name}>
            {flag.name} = {flag.enabled ? "true" : "false"}
          </div>
        ))}
        <br />
        <div># active thread</div>
        <div>thread = "{activeThreadLabel}"</div>
      </div>
    </div>
  );
}
