import { memo, type CSSProperties } from "react";
import clsx from "clsx";

import type {
  GitActivityGraphModel,
  GitActivityGraphRef,
} from "../workspaceTypes";

const DEFAULT_GRAPH_COLORS = [
  "var(--ac)",
  "var(--ac2)",
  "var(--ac3)",
  "var(--gn)",
  "var(--og)",
];

const refClassName = (ref: GitActivityGraphRef) => {
  if (ref.kind === "head" || ref.active) {
    return "current";
  }

  if (ref.kind === "remote") {
    return "remote";
  }

  if (ref.kind === "tag") {
    return "tag";
  }

  return "local";
};

const renderGraphPrefix = (
  graph: string,
  graphWidth: number,
  palette: string[],
) => {
  const padded = graph.padEnd(graphWidth, " ");

  return (
    <span aria-hidden="true" className="git-activity-graph-text">
      {Array.from(padded).map((character, index) => {
        if (character === " ") {
          return (
            <span className="git-activity-graph-char" key={`blank:${index}`}>
              {" "}
            </span>
          );
        }

        const accent = palette[index % palette.length] ?? "var(--ac)";
        return (
          <span
            className={clsx(
              "git-activity-graph-char",
              "on",
              character === "*" && "node",
            )}
            key={`${character}:${index}`}
            style={{ "--graph-accent": accent } as CSSProperties}
          >
            {character}
          </span>
        );
      })}
    </span>
  );
};

export const GitActivityGraph = memo(function GitActivityGraph({
  model,
  onOpenThread,
}: {
  model: GitActivityGraphModel;
  onOpenThread?: (threadId: string) => void;
}) {
  const palette =
    model.lanes.length > 0
      ? model.lanes.map((lane) => lane.accent)
      : DEFAULT_GRAPH_COLORS;

  return (
    <section className="git-activity-card">
      <div className="git-activity-toolbar">
        <div className="git-activity-copy">
          <div className="git-activity-title">Git Graph</div>
          <div className="git-activity-meta">{model.repoLabel}</div>
        </div>
        <div className="git-activity-summary">
          <span className="git-activity-summary-label">{model.branchLabel}</span>
          {model.commitLabel ? (
            <code className="git-activity-summary-code">{model.commitLabel}</code>
          ) : null}
        </div>
      </div>

      {model.lanes.length > 0 ? (
        <div className="git-activity-legend" role="list" aria-label="Branch legend">
          {model.lanes.map((lane) => (
            <div
              className={clsx("git-activity-legend-item", lane.emphasis)}
              key={lane.id}
              role="listitem"
              style={{ "--lane-accent": lane.accent } as CSSProperties}
            >
              <span className="git-activity-legend-swatch" />
              <span className="git-activity-legend-label">{lane.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {model.workingTree ? (
        <div className="git-working-tree-card">
          <div className="git-working-tree-toolbar">
            <div className="git-working-tree-title">Working tree</div>
            <div
              className={clsx(
                "git-working-tree-summary",
                model.workingTree.dirty && "dirty",
              )}
            >
              {model.workingTree.summary}
            </div>
          </div>

          {model.workingTree.buckets.length > 0 ? (
            <div className="git-working-tree-grid">
              {model.workingTree.buckets.map((bucket) => (
                <div className="git-working-tree-group" key={bucket.id}>
                  <div className="git-working-tree-group-head">
                    <span>{bucket.label}</span>
                    <span>{bucket.entries.length}</span>
                  </div>
                  <div className="git-working-tree-list">
                    {bucket.entries.slice(0, 6).map((entry) => (
                      <div className="git-working-tree-item" key={entry.id}>
                        <span
                          className={clsx(
                            "git-working-tree-badge",
                            entry.kind,
                          )}
                        >
                          {entry.badge}
                        </span>
                        <span
                          className="git-working-tree-path"
                          title={
                            entry.originalPath
                              ? `${entry.originalPath} -> ${entry.path}`
                              : entry.path
                          }
                        >
                          {entry.path}
                        </span>
                      </div>
                    ))}
                    {bucket.entries.length > 6 ? (
                      <div className="git-working-tree-more">
                        +{bucket.entries.length - 6} more
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="git-working-tree-clean">
              No uncommitted files in this repo.
            </div>
          )}
        </div>
      ) : null}

      <div className="git-activity-table">
        <div className="git-activity-table-head">
          <div
            className="git-activity-graph-head"
            style={{ width: `${Math.max(model.graphWidth, 4) + 1}ch` }}
          />
          <div className="git-activity-head-message">Message</div>
          <div className="git-activity-head-date">Date</div>
          <div className="git-activity-head-author">Author</div>
          <div className="git-activity-head-sha">Commit</div>
        </div>

        <div className="git-activity-table-body">
          {model.rows.map((row) => {
            const interactive = Boolean(
              row.threadId && onOpenThread,
            );
            const rowContent = (
              <>
                <div
                  className="git-activity-graph-cell"
                  style={{ width: `${Math.max(model.graphWidth, 4) + 1}ch` }}
                >
                  {renderGraphPrefix(row.graph, Math.max(model.graphWidth, 4), palette)}
                </div>
                <div className="git-activity-message-cell" title={row.hint ?? row.subject}>
                  {row.refs.length > 0 ? (
                    <div className="git-activity-ref-row">
                      {row.refs.slice(0, 3).map((ref) => (
                        <span
                          className={clsx(
                            "git-activity-ref",
                            refClassName(ref),
                          )}
                          key={ref.id}
                        >
                          {ref.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="git-activity-message-text">{row.subject}</div>
                </div>
                <div className="git-activity-cell git-activity-date-cell">
                  {row.dateLabel}
                </div>
                <div className="git-activity-cell git-activity-author-cell">
                  {row.author}
                </div>
                <code className="git-activity-cell git-activity-sha-cell">
                  {row.sha}
                </code>
              </>
            );

            if (interactive && row.threadId && onOpenThread) {
              return (
                <button
                  className={clsx(
                    "git-activity-table-row",
                    row.emphasis,
                    "interactive",
                  )}
                  key={row.id}
                  onClick={() => onOpenThread(row.threadId as string)}
                  type="button"
                >
                  {rowContent}
                </button>
              );
            }

            return (
              <div
                className={clsx("git-activity-table-row", row.emphasis)}
                key={row.id}
              >
                {rowContent}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
});
