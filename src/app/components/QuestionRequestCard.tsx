import { useMemo, useState } from "react";
import clsx from "clsx";

import type { ApprovalRequest } from "../mockData";

export function QuestionRequestCard({
  approval,
  answers,
  onAnswerChange,
  onSubmit,
}: {
  approval: ApprovalRequest;
  answers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  onSubmit: () => void;
}) {
  const questions = approval.questions ?? [];
  const [currentIndex, setCurrentIndex] = useState(0);

  const safeIndex = Math.min(Math.max(currentIndex, 0), Math.max(questions.length - 1, 0));
  const currentQuestion = questions[safeIndex] ?? null;
  const selectedValue = currentQuestion ? answers[currentQuestion.id] ?? "" : "";
  const showFreeform =
    currentQuestion
      ? currentQuestion.isOther || (currentQuestion.options?.length ?? 0) === 0
      : false;
  const isLastQuestion = safeIndex >= questions.length - 1;
  const canAdvance = selectedValue.trim().length > 0;
  const canSubmit =
    questions.length > 0 &&
    questions.every((question) => (answers[question.id] ?? "").trim().length > 0);

  const indexedOptions = useMemo(
    () =>
      (currentQuestion?.options ?? []).map((option, index) => ({
        ...option,
        index,
      })),
    [currentQuestion],
  );

  const handleContinue = () => {
    if (!currentQuestion || approval.state !== "pending") {
      return;
    }

    if (!isLastQuestion) {
      if (!canAdvance) {
        return;
      }

      setCurrentIndex((value) => Math.min(value + 1, questions.length - 1));
      return;
    }

    if (canSubmit) {
      onSubmit();
    }
  };

  return (
    <div className="question-request-card">
      <div className="question-request-head">
        {currentQuestion ? (
          <>
            <div className="question-request-title-wrap">
              <div className="question-request-title">{currentQuestion.question}</div>
              {approval.detail ? (
                <div className="question-request-meta">{approval.detail}</div>
              ) : null}
            </div>
            <div className="question-request-pager">
              <button
                className="question-request-pager-button"
                disabled={safeIndex === 0}
                onClick={() => setCurrentIndex((value) => Math.max(value - 1, 0))}
                type="button"
              >
                ‹
              </button>
              <span className="question-request-pager-value">
                {safeIndex + 1} of {questions.length}
              </span>
              <button
                className="question-request-pager-button"
                disabled={safeIndex >= questions.length - 1}
                onClick={() =>
                  setCurrentIndex((value) => Math.min(value + 1, questions.length - 1))
                }
                type="button"
              >
                ›
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="question-request-body">
        {currentQuestion ? (
          <div className="question-request-item" key={currentQuestion.id}>
            {currentQuestion.header ? (
              <div className="question-request-header">{currentQuestion.header}</div>
            ) : null}

            {indexedOptions.length > 0 ? (
              <div className="question-request-options">
                {indexedOptions.map((option) => {
                  const active = selectedValue === option.label;

                  return (
                    <button
                      className={clsx("question-request-option", active && "active")}
                      key={`${currentQuestion.id}:${option.label}`}
                      onClick={() => onAnswerChange(currentQuestion.id, option.label)}
                      type="button"
                    >
                      <span className="question-request-option-index" aria-hidden="true">
                        {option.index + 1}.
                      </span>
                      <span className="question-request-option-copy">
                        <span className="question-request-option-label">
                          {option.label}
                        </span>
                        {option.description ? (
                          <span className="question-request-option-description">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {showFreeform ? (
              <input
                className="question-request-input"
                onChange={(event) =>
                  onAnswerChange(currentQuestion.id, event.target.value)
                }
                placeholder={currentQuestion.isSecret ? "Enter value" : "Type your answer"}
                type={currentQuestion.isSecret ? "password" : "text"}
                value={selectedValue}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="question-request-actions">
        <div className="question-request-dismiss">
          Dismiss
          <span>ESC</span>
        </div>
        <button
          className="question-request-submit"
          disabled={
            approval.state !== "pending" ||
            (!isLastQuestion ? !canAdvance : !canSubmit)
          }
          onClick={handleContinue}
          type="button"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
