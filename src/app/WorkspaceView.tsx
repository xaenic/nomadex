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
import CodeMirror from "@uiw/react-codemirror";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { tags } from "@lezer/highlight";

import type {
  MentionAttachment,
  ThreadRecord,
} from "./mockData";
import type { ProviderId } from "./services/providers";
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

const FILE_EDITOR_THEME = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "var(--file-editor-ink)",
      backgroundColor: "var(--file-editor-surface)",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "var(--mono)",
      lineHeight: "1.72",
    },
    ".cm-content": {
      minHeight: "100%",
      padding: "14px 0 24px",
      caretColor: "var(--file-editor-caret)",
    },
    ".cm-line": {
      padding: "0 20px 0 16px",
    },
    ".cm-gutters": {
      backgroundColor: "var(--file-editor-gutter)",
      color: "var(--file-editor-muted)",
      borderRight: "1px solid var(--file-editor-rule)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 12px 0 16px",
      minWidth: "42px",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--file-editor-active)",
    },
    ".cm-activeLineGutter": {
      color: "var(--file-editor-ink)",
      backgroundColor: "transparent",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--file-editor-selection)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--file-editor-caret)",
    },
    ".cm-searchMatch": {
      backgroundColor: "rgb(255 214 102 / 16%)",
      outline: "1px solid rgb(255 214 102 / 18%)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgb(255 214 102 / 26%)",
    },
    ".cm-tooltip": {
      border: "1px solid var(--file-editor-rule)",
      borderRadius: "10px",
      backgroundColor: "rgb(11 15 27 / 98%)",
      boxShadow: "0 20px 48px rgb(0 0 0 / 38%)",
    },
    ".cm-panels": {
      backgroundColor: "rgb(11 15 27 / 96%)",
      borderBottom: "1px solid var(--file-editor-rule)",
    },
  },
  { dark: true },
);

const FILE_EDITOR_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: tags.keyword, color: "#c792ea" },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: "#82aaff" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#82aaff" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: "#f78c6c" },
  { tag: [tags.definition(tags.name), tags.separator], color: "#eeffff" },
  { tag: [tags.className, tags.typeName], color: "#ffcb6b" },
  { tag: [tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: "#f78c6c" },
  { tag: [tags.operator, tags.operatorKeyword], color: "#89ddff" },
  { tag: [tags.url, tags.escape, tags.regexp, tags.link], color: "#80cbc4" },
  { tag: [tags.meta, tags.comment], color: "#637777", fontStyle: "italic" },
  { tag: [tags.string, tags.inserted], color: "#c3e88d" },
  { tag: [tags.invalid], color: "#ff5370" },
  { tag: [tags.bool, tags.null], color: "#f78c6c" },
  { tag: tags.heading, color: "#82aaff", fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);

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
  onSave,
  providerId,
}: {
  preview: FilePreviewState;
  variant?: "panel" | "page";
  onBack?: () => void;
  backLabel?: string;
  onSave?: (path: string, content: string) => Promise<void>;
  providerId?: ProviderId;
}) {
  const browseHref = toBrowseUrl(preview.path, providerId);
  const editorViewRef = useRef<EditorView | null>(null);
  const [draft, setDraft] = useState(preview.content);
  const [savedContent, setSavedContent] = useState(preview.content);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [languageName, setLanguageName] = useState("Plain text");
  const [languageExtension, setLanguageExtension] = useState<Extension | null>(null);
  const isDirty = draft !== savedContent;

  useEffect(() => {
    setDraft(preview.content);
    setSavedContent(preview.content);
    setSaveError(null);
    setIsSaving(false);
  }, [preview.content, preview.error, preview.loading, preview.path]);

  useEffect(() => {
    const fileName = preview.path || preview.name;
    const description = LanguageDescription.matchFilename(languages, fileName);
    let cancelled = false;

    setLanguageExtension(null);
    setLanguageName(description?.name ?? "Plain text");

    if (!description) {
      return;
    }

    void description
      .load()
      .then((support) => {
        if (!cancelled) {
          setLanguageExtension(support.extension);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLanguageExtension(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [preview.name, preview.path]);

  const saveChanges = useCallback(async () => {
    if (!onSave || preview.loading || preview.error || isSaving || !isDirty) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      await onSave(preview.path, draft);
      setSavedContent(draft);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save this file.");
    } finally {
      setIsSaving(false);
    }
  }, [draft, isDirty, isSaving, onSave, preview.error, preview.loading, preview.path]);

  const editorExtensions = useMemo<Extension[]>(() => {
    const extensions: Extension[] = [
      FILE_EDITOR_THEME,
      syntaxHighlighting(FILE_EDITOR_HIGHLIGHT_STYLE),
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            void saveChanges();
            return true;
          },
        },
      ]),
    ];

    if (languageExtension) {
      extensions.push(languageExtension);
    }

    return extensions;
  }, [languageExtension, saveChanges]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || preview.loading || preview.error) {
      return;
    }

    if (typeof preview.line === "number" && preview.line > 0) {
      const targetLine = view.state.doc.line(Math.min(preview.line, view.state.doc.lines));
      view.dispatch({
        selection: { anchor: targetLine.from },
        effects: EditorView.scrollIntoView(targetLine.from, { y: "center" }),
      });
      return;
    }

    view.scrollDOM.scrollTo({
      left: 0,
      top: 0,
    });
  }, [preview.error, preview.line, preview.loading, preview.path]);

  const handleBack = useCallback(() => {
    if (!onBack) {
      return;
    }

    if (isDirty && typeof window !== "undefined") {
      const confirmed = window.confirm(`Discard unsaved changes to ${preview.name}?`);
      if (!confirmed) {
        return;
      }
    }

    onBack();
  }, [isDirty, onBack, preview.name]);

  const saveLabel = isSaving ? "Saving…" : isDirty ? "Save" : "Saved";
  const statusLabel = saveError ? "Save failed" : isSaving ? "Saving" : isDirty ? "Unsaved" : "Saved";

  return (
    <div className={clsx("file-editor", variant === "page" && "page")}>
      <div className="file-editor-head">
        {variant === "page" ? (
          <button className="file-editor-back" onClick={handleBack} type="button">
            ← {backLabel}
          </button>
        ) : null}
        <div className="file-editor-copy">
          <div className="file-editor-title">{preview.name}</div>
          <div className="file-editor-path">{preview.path}</div>
        </div>
        <div className="file-editor-actions">
          <div className="file-editor-meta">
            <span className="file-editor-chip">{languageName}</span>
            {typeof preview.line === "number" && preview.line > 0 ? (
              <span className="file-editor-chip">Line {preview.line}</span>
            ) : null}
            <span className={clsx("file-editor-status", isDirty && "dirty", saveError && "error")}>
              {statusLabel}
            </span>
          </div>
          {browseHref !== "#" ? (
            <a className="file-editor-link" href={browseHref} rel="noreferrer noopener" target="_blank">
              Raw
            </a>
          ) : null}
          <button
            className="file-editor-save"
            disabled={!onSave || preview.loading || Boolean(preview.error) || isSaving || !isDirty}
            onClick={() => void saveChanges()}
            type="button"
          >
            {saveLabel}
          </button>
        </div>
      </div>
      <div className="file-editor-body">
        {preview.loading ? <div className="file-editor-empty">Opening file…</div> : null}
        {!preview.loading && preview.error ? (
          <div className="file-editor-empty">{preview.error}</div>
        ) : null}
        {!preview.loading && !preview.error ? (
          <CodeMirror
            className="file-editor-surface"
            editable={Boolean(onSave)}
            extensions={editorExtensions}
            height="100%"
            onChange={(value) => {
              setDraft(value);
              if (saveError) {
                setSaveError(null);
              }
            }}
            onCreateEditor={(view) => {
              editorViewRef.current = view;
            }}
            value={draft}
          />
        ) : null}
      </div>
    </div>
  );
}
