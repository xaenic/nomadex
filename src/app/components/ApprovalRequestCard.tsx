import clsx from "clsx";

import type { ApprovalDecision, ApprovalRequest } from "../mockData";

const decisionLabel = (approval: ApprovalRequest, decision: ApprovalDecision) => {
  switch (decision) {
    case "accept":
      switch (approval.kind) {
        case "command":
          return "Run command";
        case "patch":
          return "Apply changes";
        case "permissions":
          return "Grant access";
        default:
          return "Approve";
      }
    case "acceptForSession":
      switch (approval.kind) {
        case "command":
          return "Allow for session";
        case "patch":
          return "Allow writes for session";
        case "permissions":
          return "Grant for session";
        default:
          return "Allow for session";
      }
    case "cancel":
      return "Cancel";
    case "decline":
    default:
      return "Decline";
  }
};

const decisionTone = (decision: ApprovalDecision) => {
  switch (decision) {
    case "accept":
    case "acceptForSession":
      return "approve";
    case "cancel":
      return "neutral";
    case "decline":
    default:
      return "danger";
  }
};

export function ApprovalRequestCard({
  approval,
  mcpContentText,
  onMcpContentChange,
  onResolve,
  onSubmitMcp,
}: {
  approval: ApprovalRequest;
  mcpContentText: string;
  onMcpContentChange: (value: string) => void;
  onResolve: (decision: ApprovalDecision) => void;
  onSubmitMcp: (
    action: "accept" | "decline" | "cancel",
    contentText: string,
  ) => void;
}) {
  const decisions =
    approval.availableDecisions && approval.availableDecisions.length > 0
      ? approval.availableDecisions
      : (["accept", "decline"] as Array<ApprovalDecision>);
  const pending = approval.state === "pending";

  return (
    <div className="approval-request-card">
      <div className="approval-request-head">
        <div className="approval-request-copy">
          <strong>{approval.title}</strong>
          <span>{approval.detail}</span>
        </div>
        <div className="approval-request-badges">
          <span className={clsx("approval-request-risk", approval.risk)}>
            {approval.risk}
          </span>
          <span className="approval-request-state">{approval.state}</span>
        </div>
      </div>

      {approval.kind !== "question" ? (
        <div className="approval-request-body">
          {approval.command ? (
            <div className="approval-request-block">
              <div className="approval-request-label">Command</div>
              <code className="approval-request-command">{approval.command}</code>
            </div>
          ) : null}

          {approval.cwd ? (
            <div className="approval-request-meta">
              <span className="approval-request-label">Working directory</span>
              <span className="approval-request-value">{approval.cwd}</span>
            </div>
          ) : null}

          {approval.files && approval.files.length > 0 ? (
            <div className="approval-request-block">
              <div className="approval-request-label">
                {approval.kind === "patch" ? "Paths" : "Files"}
              </div>
              <div className="approval-request-list">
                {approval.files.map((file) => (
                  <span className="approval-request-item" key={file}>
                    {file}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {approval.permissionsSummary && approval.permissionsSummary.length > 0 ? (
            <div className="approval-request-block">
              <div className="approval-request-label">Requested access</div>
              <div className="approval-request-list">
                {approval.permissionsSummary.map((entry) => (
                  <span className="approval-request-item" key={entry}>
                    {entry}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {approval.kind === "mcp" ? (
            <>
              {approval.serverName ? (
                <div className="approval-request-meta">
                  <span className="approval-request-label">Server</span>
                  <span className="approval-request-value">{approval.serverName}</span>
                </div>
              ) : null}

              {approval.form ? (
                <div className="approval-request-block">
                  <div className="approval-request-label">Prompt details</div>
                  <pre className="approval-request-pre">{approval.form}</pre>
                </div>
              ) : null}

              <div className="approval-request-block">
                <label className="approval-request-label" htmlFor={`approval-mcp-${approval.id}`}>
                  Response
                </label>
                <textarea
                  className="approval-request-textarea"
                  id={`approval-mcp-${approval.id}`}
                  onChange={(event) => onMcpContentChange(event.target.value)}
                  placeholder="Provide the response to send back to the MCP server."
                  rows={5}
                  value={mcpContentText}
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="approval-request-actions">
        {approval.kind === "mcp" ? (
          <>
            <button
              className="approval-request-button approve"
              disabled={!pending}
              onClick={() => onSubmitMcp("accept", mcpContentText)}
              type="button"
            >
              Send response
            </button>
            <button
              className="approval-request-button danger"
              disabled={!pending}
              onClick={() => onSubmitMcp("decline", mcpContentText)}
              type="button"
            >
              Decline
            </button>
            <button
              className="approval-request-button neutral"
              disabled={!pending}
              onClick={() => onSubmitMcp("cancel", mcpContentText)}
              type="button"
            >
              Cancel
            </button>
          </>
        ) : (
          decisions.map((decision) => (
            <button
              className={clsx(
                "approval-request-button",
                decisionTone(decision),
              )}
              disabled={!pending}
              key={`${approval.id}:${decision}`}
              onClick={() => onResolve(decision)}
              type="button"
            >
              {decisionLabel(approval, decision)}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
