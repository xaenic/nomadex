import { useState } from "react";
import clsx from "clsx";

import type { TurnFileChangeSummaryEntry } from "../services/presentation/workspacePresentationService";

const FILE_KIND_LABEL: Record<TurnFileChangeSummaryEntry["kind"], string> = {
  add: "new",
  update: "mod",
  delete: "del",
};

const fileNameFromPath = (path: string) => {
  const normalizedPath = path.replace(/\\/g, "/");
  const segments = normalizedPath.split("/").filter(Boolean);

  return segments.at(-1) ?? path;
};

export function FileChangeSummary({
  entries,
  onOpenFile,
  title,
  variant = "turn",
}: {
  entries: TurnFileChangeSummaryEntry[];
  onOpenFile: (path: string) => void;
  title: string;
  variant?: "live" | "turn";
}) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) {
    return null;
  }

  const countLabel = `${entries.length}`;
  const canToggleLiveList = variant === "live" && entries.length > 10;

  return (
    <div className={clsx("file-change-summary", `file-change-summary-${variant}`)}>
      <div className="file-change-summary-head">
        <div className="file-change-summary-title">{title}</div>
        <div className="file-change-summary-head-actions">
          <div className="file-change-summary-count">{countLabel}</div>
          {canToggleLiveList ? (
            <button
              className="file-change-summary-toggle"
              onClick={() => setExpanded((value) => !value)}
              type="button"
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          ) : null}
        </div>
      </div>
      <div
        className={clsx(
          "file-change-summary-list",
          variant === "live" && "file-change-summary-list-live",
          canToggleLiveList && !expanded && "collapsed",
          canToggleLiveList && expanded && "expanded",
        )}
      >
        {entries.map((entry) => {
          const fileName = fileNameFromPath(entry.path);

          return (
            <button
              className={clsx(
                "file-change-summary-item",
                `file-change-kind-${entry.kind}`,
              )}
              key={`${entry.itemId}:${entry.path}`}
              onClick={() => onOpenFile(entry.path)}
              title={entry.path}
              type="button"
            >
              <span className="file-change-summary-kind">
                {FILE_KIND_LABEL[entry.kind]}
              </span>
              <span className="file-change-summary-path">{fileName}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
