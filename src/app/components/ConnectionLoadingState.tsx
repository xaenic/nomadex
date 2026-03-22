import { useEffect, useState } from "react";
import clsx from "clsx";

import { BrandMark } from "./BrandMark";

const DEFAULT_MESSAGES = [
  "Opening workspace",
  "Setting environment",
  "Initializing modules",
  "Starting services",
];

const SWITCH_INTERVAL_MS = 1600;
const TRANSITION_MS = 380;

export function ConnectionLoadingState({
  messages = DEFAULT_MESSAGES,
  metaText = "Connecting to workspace backend",
  variant = "screen",
}: {
  messages?: string[];
  metaText?: string;
  variant?: "screen" | "inline";
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (messages.length <= 1) {
      return;
    }

    const interval = window.setInterval(() => {
      setActiveIndex((current) => {
        setPreviousIndex(current);
        setAnimating(false);
        return (current + 1) % messages.length;
      });
    }, SWITCH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [messages]);

  useEffect(() => {
    if (previousIndex === null) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setAnimating(true);
    });
    const timer = window.setTimeout(() => {
      setPreviousIndex(null);
      setAnimating(false);
    }, TRANSITION_MS);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [activeIndex, previousIndex]);

  const activeMessage = messages[activeIndex] ?? DEFAULT_MESSAGES[0];
  const previousMessage =
    previousIndex !== null ? messages[previousIndex] ?? null : null;

  return (
    <div
      aria-live="polite"
      className={clsx(
        "connection-loading-screen",
        variant === "inline" && "inline",
      )}
      role="status"
    >
      <BrandMark alt="" className="connection-loading-mark" />
      <div className="connection-loading-row">
        <span aria-hidden="true" className="connection-loading-spinner" />
        <div className="connection-loading-slot">
          {previousMessage ? (
            <span
              className={clsx(
                "connection-loading-message",
                "leaving",
                animating && "animate",
              )}
            >
              {previousMessage}
            </span>
          ) : null}
          <span
            className={clsx(
              "connection-loading-message",
              previousMessage ? "entering" : "resting",
              animating && "animate",
            )}
          >
            {activeMessage}
          </span>
        </div>
        <span aria-hidden="true" className="connection-loading-dots">
          <span />
          <span />
          <span />
        </span>
      </div>
      <div className="connection-loading-meta">{metaText}</div>
    </div>
  );
}
