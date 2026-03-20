import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  type UiLiveOverlay,
} from "./codexUiBridge";
import type {
  DashboardData,
  MentionAttachment,
  SettingsState,
  ThreadRecord,
} from "./mockData";
import {
  approvalModeFromSettings,
  attachmentDisplayLabel,
  buildComposerHighlightSegments,
  buildDiffReviewLines,
  composerHasMentionToken,
  diffEntryId,
  formatTurnErrorCode,
  settingsPatchFromApprovalMode,
  shorten,
  turnErrorText,
} from "./workspaceHelpers";
import type {
  DiffReviewEntry,
  FilePreviewState,
  QueuedComposerMessage,
  ToastTone,
  WorkspaceActions,
} from "./workspaceTypes";

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
      <h1>Codex Console</h1>
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
  onValueChange,
  onKeyDown,
}: {
  value: string;
  mentions: Array<MentionAttachment>;
  placeholder: string;
  textareaRef: { current: HTMLTextAreaElement | null };
  composerMirrorRef: { current: HTMLDivElement | null };
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
  activeThreadTimeLabel,
  streamVisible,
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
  activeThreadTimeLabel: string;
  streamVisible: Record<string, number>;
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

        return (
          <div className="turn-block" key={turn.id}>
            {turn.items.map((item) => (
              <ThreadItemView
                item={item}
                key={item.id}
                turnStatus={turn.status}
                threadTimeLabel={activeThreadTimeLabel}
                textVisible={
                  item.type === "agentMessage"
                    ? streamVisible[`${item.id}:text`]
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

export const LiveStatusDock = memo(function LiveStatusDock({
  overlay,
  pendingApprovalsCount,
  queuedCount,
}: {
  overlay: UiLiveOverlay | null;
  pendingApprovalsCount: number;
  queuedCount: number;
}) {
  if (!overlay && pendingApprovalsCount === 0) {
    return null;
  }

  const tone = overlay?.errorText
    ? "error"
    : pendingApprovalsCount > 0
      ? "approval"
      : overlay?.activityTone ?? "thinking";
  const title = pendingApprovalsCount > 0
    ? "Waiting for approval"
    : overlay?.statusText ?? "Codex is active";
  const detail = overlay?.activityDetails[0] ?? null;

  return (
    <div className={clsx("live-status-dock", tone)}>
      <div className="live-status-leading">
        <span className={clsx("live-status-dot", tone)} aria-hidden="true" />
        <div className="live-status-copy">
          <div className="live-status-title">{title}</div>
        </div>
      </div>
      <div className="live-status-meta">
        {detail ? <code className="live-status-pill">{detail}</code> : null}
        {pendingApprovalsCount > 0 ? (
          <span className="live-status-pill">{pendingApprovalsCount} approval{pendingApprovalsCount > 1 ? "s" : ""}</span>
        ) : null}
        {queuedCount > 0 ? (
          <span className="live-status-pill">{queuedCount} queued</span>
        ) : null}
      </div>
    </div>
  );
});

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
}: {
  text: string;
  onOpenFile: (path: string, line?: number | null) => void;
}) {
  const blocks = useMemo(() => parseMessageBlocks(text), [text]);

  return (
    <div className="message-text-flow">
      {blocks.map((block, index) => {
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

        return (
          <p className="message-text" key={`text-${index}`}>
            <MessageInlineFlow onOpenFile={onOpenFile} text={block.value} />
          </p>
        );
      })}
    </div>
  );
});

const ThreadItemView = memo(function ThreadItemView({
  item,
  turnStatus,
  threadTimeLabel,
  textVisible,
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
  threadTimeLabel: string;
  textVisible?: number;
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
    const extraAttachments = item.content.filter(
      (entry) => entry.type === "mention" || entry.type === "skill",
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
                const href = toBrowseUrl(attachment.path);
                const attachmentLabel = attachmentDisplayLabel(
                  attachment.label,
                  attachment.path,
                );

                return (
                  <span className="attachment-chip" key={`${item.id}-file-${attachment.path}`}>
                    <span>📄</span>
                    {href === "#" ? (
                      <button
                        className="message-file-link attachment-chip-link file-link-button"
                        onClick={() => onOpenFile(attachment.path)}
                        title={attachment.path}
                        type="button"
                      >
                        {attachmentLabel}
                      </button>
                    ) : (
                      <button
                        className="message-file-link attachment-chip-link file-link-button"
                        onClick={() => onOpenFile(attachment.path)}
                        title={attachment.path}
                        type="button"
                      >
                        {attachmentLabel}
                      </button>
                    )}
                  </span>
                );
              })}
              {extraAttachments.map((attachment) => (
                <span
                  className="attachment-chip"
                  key={`${item.id}-${attachment.type}-${attachment.name}`}
                >
                  <span>{attachment.type === "skill" ? "📋" : "📄"}</span>
                  <span>{attachment.name}</span>
                </span>
              ))}
            </div>
          ) : null}
          {display.text ? <MessageTextFlow onOpenFile={onOpenFile} text={display.text} /> : null}
          <div className="msg-time">{threadTimeLabel}</div>
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
    const streaming =
      typeof textVisible === "number" && textVisible < item.text.length;

    return (
      <div className="msg" onContextMenu={(event) => onContext(event, item)}>
        <div className="mh">
          <div className="mav a">⬡</div>
          <span className="mn">Codex</span>
          <span className="mt">{turnStatus === "inProgress" ? "live" : turnStatus}</span>
        </div>
        <div className="mb">
          {text ? <MessageTextFlow onOpenFile={onOpenFile} text={text} /> : null}
          {streaming ? <div className="live-cursor" /> : null}
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

export function ConfigPanel({
  snapshot,
  activeThreadLabel,
  actions,
  pushToast,
  selectModel,
}: {
  snapshot: DashboardData;
  activeThreadLabel: string;
  actions: WorkspaceActions;
  pushToast: (message: string, tone: ToastTone) => void;
  selectModel: (modelId: string) => Promise<void>;
}) {
  const [mobileCallbackUrl, setMobileCallbackUrl] = useState("");

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
        <div className="sg-t">Skills</div>
        {snapshot.installedSkills.map((skill) => (
          <div className="sr" key={skill.id}>
            <span className="sl">{skill.name}</span>
            <div
              className={clsx("tog", skill.enabled && "on")}
              onClick={() => void actions.toggleInstalledSkill(skill.id)}
              role="button"
              tabIndex={0}
              onKeyDown={() => undefined}
            />
          </div>
        ))}
        {snapshot.remoteSkills.length > 0 ? (
          <div className="remote-skill-list">
            {snapshot.remoteSkills.map((skill) => (
              <button
                className="remote-skill-card"
                key={skill.id}
                type="button"
                onClick={() => {
                  void actions.installSkill(skill.id);
                  pushToast(`Installing ${skill.name}`, "ok");
                }}
              >
                <strong>{skill.name}</strong>
                <span>{skill.description}</span>
                <small>{skill.downloads} downloads</small>
              </button>
            ))}
          </div>
        ) : null}
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
        <div># Codex Console config</div>
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
