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
  const canSubmit =
    questions.length > 0 &&
    questions.every((question) => (answers[question.id] ?? "").trim().length > 0);

  return (
    <div className="question-request-card">
      <div className="question-request-head">
        <div className="question-request-copy">
          <strong>{approval.title}</strong>
          <span>{approval.detail}</span>
        </div>
        <span className="question-request-state">{approval.state}</span>
      </div>

      <div className="question-request-body">
        {questions.map((question, index) => {
          const selectedValue = answers[question.id] ?? "";
          const showFreeform =
            question.isOther || (question.options?.length ?? 0) === 0;

          return (
            <div className="question-request-item" key={question.id}>
              <div className="question-request-item-head">
                <span className="question-request-index">{index + 1}.</span>
                <div className="question-request-item-copy">
                  <span className="question-request-header">{question.header}</span>
                  <div className="question-request-text">{question.question}</div>
                </div>
              </div>

              {question.options && question.options.length > 0 ? (
                <div className="question-request-options">
                  {question.options.map((option) => {
                    const active = selectedValue === option.label;

                    return (
                      <button
                        className={clsx("question-request-option", active && "active")}
                        key={`${question.id}:${option.label}`}
                        onClick={() => onAnswerChange(question.id, option.label)}
                        type="button"
                      >
                        <span className="question-request-option-label">
                          {option.label}
                        </span>
                        {option.description ? (
                          <span className="question-request-option-description">
                            {option.description}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {showFreeform ? (
                <input
                  className="question-request-input"
                  onChange={(event) =>
                    onAnswerChange(question.id, event.target.value)
                  }
                  placeholder={question.isSecret ? "Enter value" : "Type your answer"}
                  type={question.isSecret ? "password" : "text"}
                  value={selectedValue}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="question-request-actions">
        <button
          className="question-request-submit"
          disabled={!canSubmit || approval.state !== "pending"}
          onClick={onSubmit}
          type="button"
        >
          Submit answers
        </button>
      </div>
    </div>
  );
}
