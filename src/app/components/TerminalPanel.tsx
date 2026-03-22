import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import type { TerminalSession } from "../mockData";

const MAX_RENDERED_LOG_LINES = 1200;

const preferredTerminalId = (terminals: Array<TerminalSession>) =>
  terminals.find((terminal) => terminal.status === "running")?.id ??
  terminals[0]?.id ??
  null;

export function TerminalPanel({
  cwd,
  terminals,
  onStartShell,
  onSendInput,
  onTerminate,
}: {
  cwd: string;
  terminals: Array<TerminalSession>;
  onStartShell: () => Promise<string>;
  onSendInput: (terminalId: string, input: string) => Promise<void>;
  onTerminate: (terminalId: string) => Promise<void>;
}) {
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(() =>
    preferredTerminalId(terminals),
  );
  const [commandValue, setCommandValue] = useState("");
  const [panelError, setPanelError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"start" | "send" | "stop" | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const inlineInputRef = useRef<HTMLInputElement | null>(null);
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
  const omittedLogLines = activeTerminal
    ? Math.max(0, activeTerminal.log.length - visibleLogLines.length)
    : 0;
  const hiddenShellCount = Math.max(terminals.length - 1, 0);
  const canWriteToActiveTerminal = Boolean(
    activeTerminal?.writable && activeTerminal.status === "running",
  );

  const focusInlineInput = useCallback(() => {
    const node = inlineInputRef.current;
    if (!node) {
      return;
    }

    node.focus();
    const nextPosition = node.value.length;
    try {
      node.setSelectionRange(nextPosition, nextPosition);
    } catch {
      // Mobile browsers can reject selection updates during certain IME states.
    }
  }, []);

  useEffect(() => {
    const container = logScrollRef.current;
    const activeId = activeTerminal?.id ?? null;
    if (!container) {
      activeTerminalRef.current = activeId;
      return;
    }

    const terminalChanged = activeTerminalRef.current !== activeId;
    activeTerminalRef.current = activeId;

    if (!terminalChanged && !stickToBottomRef.current) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeTerminal?.id, visibleLogLines.length]);

  useEffect(() => {
    if (!canWriteToActiveTerminal) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      focusInlineInput();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeTerminal?.id, canWriteToActiveTerminal, focusInlineInput]);

  const handleLogScroll = () => {
    const node = logScrollRef.current;
    if (!node) {
      return;
    }

    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
  };

  const handleStartShell = async () => {
    setPanelError(null);
    setPendingAction("start");

    try {
      const terminalId = await onStartShell();
      setActiveTerminalId(terminalId);
      setCommandValue("");
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Unable to start the project shell.",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const handleSubmit = async () => {
    if (!activeTerminal || !canWriteToActiveTerminal || !commandValue.trim()) {
      return;
    }

    const submittedValue = commandValue;
    setPanelError(null);
    setPendingAction("send");

    try {
      setCommandValue("");
      await onSendInput(activeTerminal.id, `${submittedValue}\n`);
    } catch (error) {
      setCommandValue(submittedValue);
      setPanelError(
        error instanceof Error ? error.message : "Unable to send terminal input.",
      );
    } finally {
      setPendingAction(null);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          focusInlineInput();
        });
      }
    }
  };

  const handleInterrupt = async () => {
    if (!activeTerminal || !canWriteToActiveTerminal) {
      return;
    }

    setPanelError(null);
    setPendingAction("send");

    try {
      await onSendInput(activeTerminal.id, "\u0003");
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Unable to send interrupt.",
      );
    } finally {
      setPendingAction(null);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          focusInlineInput();
        });
      }
    }
  };

  const handleTerminate = async () => {
    if (!activeTerminal || activeTerminal.status !== "running") {
      return;
    }

    setPanelError(null);
    setPendingAction("stop");

    try {
      await onTerminate(activeTerminal.id);
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Unable to stop the terminal.",
      );
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-plain-bar">
        <div className="terminal-plain-meta">
          <span className="terminal-plain-title">Terminal</span>
          {activeTerminal ? (
            <span className={clsx("status-chip", "terminal-status-chip", activeTerminal.status)}>
              {activeTerminal.status}
            </span>
          ) : null}
          {hiddenShellCount > 0 ? (
            <span className="terminal-plain-count">{terminals.length} shells</span>
          ) : null}
        </div>
        <div className="terminal-toolbar-actions">
          <button className="mini-action" type="button" onClick={() => void handleStartShell()}>
            {pendingAction === "start" ? "Starting…" : "New shell"}
          </button>
          {activeTerminal ? (
            <button
              className="mini-action"
              disabled={!canWriteToActiveTerminal || pendingAction === "send"}
              onClick={() => void handleInterrupt()}
              type="button"
            >
              Ctrl+C
            </button>
          ) : null}
          {activeTerminal ? (
            <button
              className="mini-action danger"
              disabled={activeTerminal.status !== "running" || pendingAction === "stop"}
              onClick={() => void handleTerminate()}
              type="button"
            >
              {pendingAction === "stop" ? "Stopping…" : "Stop"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="terminal-project-path">{cwd}</div>

      {panelError ? <div className="terminal-inline-error">{panelError}</div> : null}

      {terminals.length === 0 ? (
        <div className="terminal-empty-state">
          <div className="empty-panel">No project shell yet.</div>
          <button className="mini-action" type="button" onClick={() => void handleStartShell()}>
            Open project shell
          </button>
        </div>
      ) : null}

      {terminals.length > 0 && activeTerminal ? (
        <>
          {omittedLogLines > 0 ? (
            <div className="terminal-log-cap">
              Showing the latest {visibleLogLines.length} lines of {activeTerminal.log.length}
            </div>
          ) : null}
          <div
            className={clsx(
              "term",
              "terminal-log-plain",
              canWriteToActiveTerminal && "terminal-log-plain-interactive",
            )}
            onClick={() => {
              if (canWriteToActiveTerminal) {
                focusInlineInput();
              }
            }}
            onScroll={handleLogScroll}
            ref={logScrollRef}
          >
            {visibleLogLines.map((line, index) => (
              <div
                className={clsx("terminal-log-row", index === 0 && "t-p")}
                key={`${activeTerminal.id}:log:${omittedLogLines + index}`}
              >
                {line || " "}
              </div>
            ))}
            {canWriteToActiveTerminal ? (
              <form
                className="terminal-log-prompt t-p"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleSubmit();
                }}
              >
                <span className="terminal-inline-editor-shell">$</span>
                <input
                  aria-label="Terminal input"
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                  className="terminal-inline-editor"
                  enterKeyHint="send"
                  onChange={(event) => setCommandValue(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();

                    if (
                      (event.ctrlKey || event.metaKey) &&
                      event.key.toLowerCase() === "c" &&
                      commandValue.length === 0
                    ) {
                      event.preventDefault();
                      void handleInterrupt();
                    }
                  }}
                  ref={inlineInputRef}
                  spellCheck={false}
                  type="text"
                  value={commandValue}
                />
                <button aria-hidden="true" className="terminal-submit-proxy" tabIndex={-1} type="submit" />
              </form>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
