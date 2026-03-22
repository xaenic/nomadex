import { memo, type CSSProperties } from "react";
import clsx from "clsx";

import type { UiLiveOverlay } from "./services/presentation/workspacePresentationService";

type LiveStatusTone = UiLiveOverlay["activityTone"] | "approval";

const AnimatedStatusText = memo(function AnimatedStatusText({
  className,
  text,
}: {
  className?: string;
  text: string;
}) {
  const characters = Array.from(text);
  const animatedCount =
    characters.reduce(
      (count, character) => count + (character.trim().length > 0 ? 1 : 0),
      0,
    ) || 1;
  const durationMs = Math.min(2200, Math.max(1100, 900 + animatedCount * 70));
  let animatedIndex = 0;

  return (
    <span aria-label={text} className={clsx(className, "live-status-signal")} role="text">
      {characters.map((character, index) => {
        const animated = character.trim().length > 0;
        const signalIndex = animated ? animatedIndex++ : -1;
        const offsetMs = animated
          ? (((animatedCount - 1 - signalIndex) * durationMs) / animatedCount)
          : 0;
        const style = animated
          ? ({
              animationDelay: `-${offsetMs}ms`,
              animationDuration: `${durationMs}ms`,
            } satisfies CSSProperties)
          : undefined;

        return (
          <span
            aria-hidden="true"
            className={clsx("live-status-signal-glyph", !animated && "gap")}
            key={`${character}-${index}`}
            style={style}
          >
            {character === " " ? "\u00A0" : character}
          </span>
        );
      })}
    </span>
  );
});

const LiveStatusIcon = memo(function LiveStatusIcon({
  tone,
}: {
  tone: LiveStatusTone;
}) {
  if (tone === "command") {
    return (
      <svg
        aria-hidden="true"
        className={clsx("live-status-icon", tone)}
        viewBox="0 0 20 20"
      >
        <rect
          className="live-status-icon-frame"
          x="2.5"
          y="4"
          rx="4"
          ry="4"
          width="15"
          height="12"
        />
        <path className="live-status-icon-mark" d="m7 8-2 2 2 2" />
        <path className="live-status-icon-line" d="M10.5 12.5h4" />
      </svg>
    );
  }

  if (tone === "editing") {
    return (
      <svg
        aria-hidden="true"
        className={clsx("live-status-icon", tone)}
        viewBox="0 0 20 20"
      >
        <path
          className="live-status-icon-mark"
          d="m6 14 1.1-3.6 5.8-5.8 2.5 2.5-5.8 5.8L6 14Z"
        />
        <path className="live-status-icon-line" d="M11.8 5.8 14.2 8.2" />
      </svg>
    );
  }

  if (tone === "tool") {
    return (
      <svg
        aria-hidden="true"
        className={clsx("live-status-icon", tone)}
        viewBox="0 0 20 20"
      >
        <path
          className="live-status-icon-frame"
          d="M10 3.8 11.8 7l3.6 1.4-3.6 1.5-1.8 3.3-1.8-3.3-3.6-1.5L8.2 7 10 3.8Z"
        />
        <circle className="live-status-icon-dot tool-core" cx="10" cy="8.4" r="1" />
      </svg>
    );
  }

  if (tone === "agent") {
    return (
      <svg
        aria-hidden="true"
        className={clsx("live-status-icon", tone)}
        viewBox="0 0 20 20"
      >
        <circle className="live-status-icon-frame node-a" cx="6" cy="10" r="2.2" />
        <circle className="live-status-icon-frame node-b" cx="13.8" cy="6.3" r="2" />
        <circle className="live-status-icon-frame node-c" cx="13.8" cy="13.7" r="2" />
        <path className="live-status-icon-line" d="M8 9 11.8 7.2m-3.8 3 3.8 2.1" />
      </svg>
    );
  }

  if (tone === "search") {
    return (
      <svg
        aria-hidden="true"
        className={clsx("live-status-icon", tone)}
        viewBox="0 0 20 20"
      >
        <circle className="live-status-icon-frame" cx="8.6" cy="8.6" r="4.8" />
        <path className="live-status-icon-mark" d="m12.1 12.1 3.2 3.2" />
        <circle className="live-status-icon-dot search-dot" cx="8.6" cy="8.6" r="0.95" />
      </svg>
    );
  }

  if (tone === "image") {
    return (
      <svg
        aria-hidden="true"
        className={clsx("live-status-icon", tone)}
        viewBox="0 0 20 20"
      >
        <rect
          className="live-status-icon-frame"
          x="3.1"
          y="4.1"
          rx="3"
          ry="3"
          width="13.8"
          height="11.8"
        />
        <circle className="live-status-icon-dot image-dot" cx="7" cy="7.5" r="1" />
        <path
          className="live-status-icon-line"
          d="M5.4 13.1 8.1 10.4l1.9 1.8 2.5-2.5 2.1 2.2"
        />
      </svg>
    );
  }

  if (tone === "approval") {
    return (
      <svg
        aria-hidden="true"
        className={clsx("live-status-icon", tone)}
        viewBox="0 0 20 20"
      >
        <path
          className="live-status-icon-frame"
          d="M10 2.8 15.5 5v4.6c0 3.2-2.2 5.8-5.5 7.5-3.3-1.7-5.5-4.3-5.5-7.5V5l5.5-2.2Z"
        />
        <path className="live-status-icon-mark" d="m7.4 10.1 1.7 1.8 3.6-3.8" />
      </svg>
    );
  }

  if (tone === "error") {
    return (
      <svg
        aria-hidden="true"
        className={clsx("live-status-icon", tone)}
        viewBox="0 0 20 20"
      >
        <circle className="live-status-icon-frame" cx="10" cy="10" r="6.2" />
        <path
          className="live-status-icon-mark"
          d="m7.2 7.2 5.6 5.6m0-5.6-5.6 5.6"
        />
      </svg>
    );
  }

  if (tone === "writing") {
    return (
      <svg
        aria-hidden="true"
        className={clsx("live-status-icon", tone)}
        viewBox="0 0 20 20"
      >
        <path
          className="live-status-icon-frame"
          d="M4.2 6.8c0-1.4 1.1-2.6 2.6-2.6h6.4c1.4 0 2.6 1.2 2.6 2.6v4.3c0 1.5-1.2 2.7-2.7 2.7H10l-2.9 2.2v-2.2H6.8c-1.5 0-2.6-1.2-2.6-2.7V6.8Z"
        />
        <path
          className="live-status-icon-line wave-a"
          d="M6.2 9.8c.8-.8 1.7-.8 2.5 0s1.7.8 2.5 0 1.7-.8 2.5 0"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className={clsx("live-status-icon", tone)}
      viewBox="0 0 20 20"
    >
      <circle className="live-status-icon-frame" cx="10" cy="10" r="5.8" />
      <circle className="live-status-icon-dot dot-a" cx="10" cy="5" r="1" />
      <circle className="live-status-icon-dot dot-b" cx="14.2" cy="12.4" r="1" />
      <circle className="live-status-icon-dot dot-c" cx="5.8" cy="12.4" r="1" />
    </svg>
  );
});

export const LiveStatusInline = memo(function LiveStatusInline({
  overlay,
  pendingApprovalsCount,
  queuedCount,
}: {
  overlay: UiLiveOverlay | null;
  pendingApprovalsCount: number;
  queuedCount: number;
}) {
  if (!overlay && pendingApprovalsCount === 0) {
    return null;
  }

  const tone: LiveStatusTone = overlay?.errorText
    ? "error"
    : pendingApprovalsCount > 0
      ? "approval"
      : overlay?.activityTone ?? "thinking";
  const label =
    pendingApprovalsCount > 0
      ? "Waiting approval"
      : tone === "error"
        ? "Error"
        : overlay?.activityLabel ?? "Thinking";
  const detail =
    pendingApprovalsCount > 0
      ? null
      : overlay?.errorText ?? overlay?.activityDetails[0] ?? null;

  return (
    <div
      aria-live="polite"
      className={clsx("live-status-inline", tone)}
      role="status"
      title={detail ?? label}
    >
      <div className="live-status-inline-main">
        <LiveStatusIcon tone={tone} />
        <AnimatedStatusText
          className="live-status-inline-label"
          text={label}
        />
        {detail ? (
          <AnimatedStatusText
            className="live-status-inline-detail"
            text={detail}
          />
        ) : null}
      </div>
      {pendingApprovalsCount > 0 || queuedCount > 0 ? (
        <div className="live-status-inline-meta">
          {pendingApprovalsCount > 0 ? (
            <span className="live-status-inline-count">
              {pendingApprovalsCount} pending
            </span>
          ) : null}
          {queuedCount > 0 ? (
            <span className="live-status-inline-count">
              {queuedCount} queued
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
