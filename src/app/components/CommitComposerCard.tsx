import { memo, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { ProviderAdapter, ProviderId } from "../services/providers";

export const CommitComposerCard = memo(function CommitComposerCard({
  branchLabel,
  dirty,
  hasStagedChanges,
  message,
  preferencesPath,
  providers,
  selectedProviderId,
  summary,
  generating,
  committing,
  onCommit,
  onGenerate,
  onMessageChange,
  onProviderChange,
}: {
  branchLabel: string;
  dirty: boolean;
  hasStagedChanges: boolean;
  message: string;
  preferencesPath: string | null;
  providers: ProviderAdapter[];
  selectedProviderId: ProviderId;
  summary: string;
  generating: boolean;
  committing: boolean;
  onCommit: () => void;
  onGenerate: () => void;
  onMessageChange: (value: string) => void;
  onProviderChange: (value: ProviderId) => void;
}) {
  const activeProvider =
    providers.find((provider) => provider.id === selectedProviderId) ??
    providers[0] ??
    null;
  const busy = generating || committing;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!committing && message.trim()) {
        onCommit();
      }
    }
  };

  return (
    <section className="commit-composer-card">
      <div className="commit-composer-head">
        <div className="commit-composer-copy">
          <div className="commit-composer-title">Commit changes</div>
          <div className="commit-composer-meta">
            <span>{branchLabel}</span>
            <span>{summary || (dirty ? "Working tree ready" : "Working tree clean")}</span>
          </div>
        </div>
        <button
          className="commit-generate-button"
          disabled={!dirty || busy}
          onClick={onGenerate}
          type="button"
        >
          {generating ? "Generating…" : "Generate"}
        </button>
      </div>

      <div className="commit-composer-toolbar">
        <label className="commit-provider-field">
          <span>Provider</span>
          <select
            className="commit-provider-select"
            disabled={busy}
            onChange={(event) =>
              onProviderChange(event.target.value as ProviderId)
            }
            value={selectedProviderId}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </label>

        <div className="commit-provider-note">
          <strong>{activeProvider?.displayName ?? "Provider"}</strong>
          <span>
            {preferencesPath
              ? "Saved per project in .nomadex/project.json"
              : "Using the current workspace provider"}
          </span>
        </div>
      </div>

      <textarea
        className="commit-message-input"
        disabled={committing}
        onChange={(event) => onMessageChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="feat(scope): short summary"
        rows={4}
        value={message}
      />

      <div className="commit-composer-footer">
        <div className="commit-composer-hint">
          {hasStagedChanges
            ? "Commits the staged files."
            : dirty
              ? "Stages all current files first, then commits."
              : "No pending files to commit."}
        </div>
        <button
          className="commit-submit-button"
          disabled={!dirty || !message.trim() || busy}
          onClick={onCommit}
          type="button"
        >
          {committing ? "Committing…" : "Commit"}
        </button>
      </div>
    </section>
  );
});
