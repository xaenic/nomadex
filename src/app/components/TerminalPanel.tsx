import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";

import type { TerminalSession } from "../mockData";

const MAX_RENDERED_LOG_LINES = 1200;
const TERMINAL_CURSOR_ROWS = 1;

const preferredTerminalId = (terminals: Array<TerminalSession>) =>
  terminals.find((terminal) => terminal.status === "running")?.id ??
  terminals[0]?.id ??
  null;

export function TerminalPanel({
  terminals,
  onClean,
}: {
  terminals: Array<TerminalSession>;
  onClean: () => void | Promise<void>;
}) {
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(() => preferredTerminalId(terminals));
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const activeTerminalRef = useRef<string | null>(activeTerminalId);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const nextActiveId = terminals.some((terminal) => terminal.id === activeTerminalId)
      ? activeTerminalId
      : preferredTerminalId(terminals);

    if (nextActiveId !== activeTerminalId) {
      setActiveTerminalId(nextActiveId);
    }
  }, [activeTerminalId, terminals]);

  const activeTerminal = useMemo(
    () =>
      terminals.find((terminal) => terminal.id === activeTerminalId) ??
      terminals.find((terminal) => terminal.status === "running") ??
      terminals[0] ??
      null,
    [activeTerminalId, terminals],
  );

  const visibleLogLines = useMemo(
    () => (activeTerminal ? activeTerminal.log.slice(-MAX_RENDERED_LOG_LINES) : []),
    [activeTerminal],
  );
  const omittedLogLines = activeTerminal ? Math.max(0, activeTerminal.log.length - visibleLogLines.length) : 0;
  const cursorRows = activeTerminal?.status === "running" ? TERMINAL_CURSOR_ROWS : 0;
  const totalRows = visibleLogLines.length + cursorRows;

  const rowVirtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => logScrollRef.current,
    estimateSize: () => 20,
    overscan: 14,
  });

  useEffect(() => {
    const activeId = activeTerminal?.id ?? null;
    const container = logScrollRef.current;
    if (!container || totalRows === 0) {
      activeTerminalRef.current = activeId;
      return;
    }

    const terminalChanged = activeTerminalRef.current !== activeId;
    activeTerminalRef.current = activeId;

    if (terminalChanged || stickToBottomRef.current) {
      rowVirtualizer.scrollToIndex(totalRows - 1, { align: "end" });
    }
  }, [activeTerminal?.id, rowVirtualizer, totalRows]);

  const handleLogScroll = () => {
    const node = logScrollRef.current;
    if (!node) {
      return;
    }

    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
  };

  return (
    <div className="terminal-panel">
      <div className="panel-head-row">
        <div className="panel-hint">Background terminals and PTY snapshots</div>
        <button className="mini-action" type="button" onClick={() => void onClean()}>
          Clean
        </button>
      </div>

      {terminals.length === 0 ? <div className="empty-panel">No terminal sessions yet.</div> : null}

      {terminals.length > 0 && activeTerminal ? (
        <div className="terminal-layout">
          <div className="terminal-session-list" role="tablist" aria-label="Terminal sessions">
            {terminals.map((terminal) => {
              const selected = terminal.id === activeTerminal.id;
              return (
                <button
                  aria-selected={selected}
                  className={clsx("terminal-session-button", selected && "active")}
                  key={terminal.id}
                  onClick={() => setActiveTerminalId(terminal.id)}
                  role="tab"
                  type="button"
                >
                  <div className="terminal-session-topline">
                    <div className="terminal-session-name">{terminal.title}</div>
                    <span className={clsx("status-chip", "terminal-status-chip", terminal.status)}>
                      {terminal.status}
                    </span>
                  </div>
                  <div className="terminal-session-command">{terminal.command}</div>
                  <div className="terminal-session-meta">
                    <span>{terminal.processId}</span>
                    <span>{terminal.lastEvent}</span>
                    <span>{terminal.background ? "background" : "active"}</span>
                    <span>{terminal.log.length} line{terminal.log.length === 1 ? "" : "s"}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="terminal-card terminal-card-focus">
            <div className="terminal-window-bar">
              <div className="terminal-traffic" aria-hidden="true">
                <span className="terminal-dot close" />
                <span className="terminal-dot minimize" />
                <span className="terminal-dot zoom" />
              </div>
              <div className="terminal-window-title">{activeTerminal.title}</div>
              <span className={clsx("status-chip", "terminal-status-chip", activeTerminal.status)}>{activeTerminal.status}</span>
            </div>
            <div className="terminal-title-row">
              <div className="terminal-command-strip">
                <span className="terminal-command-prefix">$</span>
                <span>{activeTerminal.command}</span>
              </div>
              <div className="terminal-meta-row">
                <span>{activeTerminal.cwd}</span>
                <span>{activeTerminal.processId}</span>
                <span>{activeTerminal.lastEvent}</span>
              </div>
            </div>
            {omittedLogLines > 0 ? (
              <div className="terminal-log-cap">
                Showing the latest {visibleLogLines.length} lines of {activeTerminal.log.length}
              </div>
            ) : null}
            <div className="term terminal-log-virtual" onScroll={handleLogScroll} ref={logScrollRef}>
              <div
                className="terminal-log-inner"
                role="presentation"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const isCursorRow = activeTerminal.status === "running" && virtualRow.index === visibleLogLines.length;
                  const line = isCursorRow ? "$ " : visibleLogLines[virtualRow.index] ?? "";

                  return (
                    <div
                      className={clsx("terminal-log-line", (virtualRow.index === 0 || isCursorRow) && "t-p")}
                      key={`${activeTerminal.id}:${virtualRow.index}`}
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {isCursorRow ? (
                        <>
                          $ <span className="cur" />
                        </>
                      ) : (
                        line || " "
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
