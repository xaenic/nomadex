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
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";

import type {
  MentionAttachment,
  ThreadRecord,
} from "./mockData";
import { toBrowseUrl } from "./services/presentation/workspacePresentationService";
import {
  buildComposerHighlightSegments,
  buildDiffReviewLines,
  composerHasMentionToken,
  diffKindLabel,
  shorten,
} from "./workspaceHelpers";
import type {
  DiffReviewEntry,
  FilePreviewState,
  QueuedComposerMessage,
} from "./workspaceTypes";

export const FileExplorerPanel = memo(function FileExplorerPanel({
  breadcrumbs,
  currentPath,
  directoryEntries,
  editorPath,
  loading,
  mentionedPaths,
  modifiedByPath,
  onNavigate,
  onOpenEntry,
  parentPath,
  rootPath,
}: {
  breadcrumbs: Array<{
    label: string;
    path: string;
  }>;
  currentPath: string;
  directoryEntries: Array<MentionAttachment>;
  editorPath: string | null;
  loading: boolean;
  mentionedPaths: Set<string>;
  modifiedByPath: Map<string, "mod" | "new" | "del">;
  onNavigate: (path: string) => void;
  onOpenEntry: (entry: MentionAttachment) => void | Promise<void>;
  parentPath: string | null;
  rootPath: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: directoryEntries.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 38,
    overscan: 10,
  });

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = 0;
  }, [currentPath]);

  return (
    <div className="file-explorer-panel">
      <div className="panel-head-row">
        {parentPath ? (
          <button className="mini-action" type="button" onClick={() => onNavigate(parentPath)}>
            ← Back
          </button>
        ) : null}
        <div className="panel-hint">📁 {currentPath} · {modifiedByPath.size} modified</div>
      </div>
      <div className="file-breadcrumbs">
        {breadcrumbs.map((crumb) => (
          <button
            className={clsx("file-crumb", crumb.path === currentPath && "active")}
            key={crumb.path}
            type="button"
            onClick={() => onNavigate(crumb.path)}
          >
            {crumb.label}
          </button>
        ))}
      </div>
      {loading ? <div className="empty-panel">Loading files for this directory…</div> : null}
      {!loading && directoryEntries.length === 0 ? (
        <div className="empty-panel">No direct files or folders found in this directory.</div>
      ) : null}
      {!loading && directoryEntries.length > 0 ? (
        <div className="file-explorer-scroll" ref={listRef}>
          <div
            className="file-explorer-list"
            role="presentation"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = directoryEntries[virtualRow.index];
              if (!entry) {
                return null;
              }

              const relativePath = entry.path.startsWith(`${rootPath}/`)
                ? entry.path.slice(rootPath.length + 1)
                : entry.name;
              const badge = modifiedByPath.get(entry.name) ?? modifiedByPath.get(relativePath);
              const mentioned = mentionedPaths.has(entry.path);

              return (
                <button
                  className={clsx(
                    "fi file-explorer-row",
                    entry.kind === "directory" && "dir",
                    badge === "mod" && "active",
                    mentioned && "mentioned",
                    editorPath === entry.path && "open",
                  )}
                  key={entry.id}
                  type="button"
                  onClick={() => void onOpenEntry(entry)}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <span>{entry.kind === "directory" ? "📁" : "📄"}</span>
                  <span className="fi-n">{entry.name}</span>
                  {mentioned ? <span className="fbdg mention">@</span> : null}
                  {badge ? <span className={clsx("fbdg", badge)}>{badge}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="panel-meta">
        <div>Tap a file to open the full editor. Tap folders to drill in.</div>
        <div>Use <code>/mention filename</code> or type <code>@filename</code> in the composer.</div>
      </div>
    </div>
  );
});

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
  const defaultComposerHeight = 60;
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

    node.style.height = "auto";
    node.style.height = `${Math.max(defaultComposerHeight, Math.min(node.scrollHeight, 140))}px`;

    syncMirrorScroll();
  }, [defaultComposerHeight, draft, syncMirrorScroll, textareaRef]);

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
        rows={3}
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
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 20,
    overscan: 16,
  });

  useEffect(() => {
    const node = scrollContainerRef.current;
    if (!node || preview.loading) {
      return;
    }

    if (typeof highlightedLine === "number" && highlightedLine > 0) {
      rowVirtualizer.scrollToIndex(Math.max(0, highlightedLine - 1), {
        align: "center",
      });
      return;
    }

    node.scrollTo({
      left: 0,
      top: 0,
    });
  }, [highlightedLine, preview.loading, preview.path, rowVirtualizer]);

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
          <div
            className="file-editor-scroll"
            ref={scrollContainerRef}
          >
            <div
              className="file-editor-code file-editor-code-virtual"
              role="presentation"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const line = lines[virtualRow.index] ?? "";
                const lineNumber = virtualRow.index + 1;

                return (
                  <div
                    className={clsx(
                      "file-editor-line",
                      highlightedLine === lineNumber && "active",
                    )}
                    key={`${preview.path}:${virtualRow.index}`}
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <span className="file-editor-gutter">{lineNumber}</span>
                    <code className="file-editor-text">{line || " "}</code>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
