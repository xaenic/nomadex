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
  visibleRangeStart = 0,
  visibleRangeEnd,
}: {
  messages?: string[];
  metaText?: string;
  variant?: "screen" | "inline";
  visibleRangeStart?: number;
  visibleRangeEnd?: number;
}) {
  const safeMessages = messages.length > 0 ? messages : DEFAULT_MESSAGES;
  const lastIndex = safeMessages.length - 1;
  const rangeStart = Math.max(0, Math.min(visibleRangeStart, lastIndex));
  const rangeEnd = Math.max(
    rangeStart,
    Math.min(visibleRangeEnd ?? lastIndex, lastIndex),
  );
  const [activeIndex, setActiveIndex] = useState(rangeStart);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (rangeEnd - rangeStart < 1) {
      return;
    }

    const interval = window.setInterval(() => {
      setActiveIndex((current) => {
        const safeCurrent =
          current < rangeStart || current > rangeEnd ? rangeStart : current;
        setPreviousIndex(safeCurrent);
        setAnimating(false);
        return safeCurrent >= rangeEnd ? rangeStart : safeCurrent + 1;
      });
    }, SWITCH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [rangeEnd, rangeStart]);

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

  const resolvedActiveIndex =
    activeIndex < rangeStart || activeIndex > rangeEnd ? rangeStart : activeIndex;
  const resolvedPreviousIndex =
    previousIndex !== null &&
    previousIndex >= rangeStart &&
    previousIndex <= rangeEnd
      ? previousIndex
      : null;
  const activeMessage =
    safeMessages[resolvedActiveIndex] ?? safeMessages[rangeStart];
  const previousMessage =
    resolvedPreviousIndex !== null
      ? safeMessages[resolvedPreviousIndex] ?? null
      : null;

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
