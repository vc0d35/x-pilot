import { useState, type RefObject } from 'react';
import type { UserInputAnswers, UserInputQuestion, UserInputRequest } from '../../shared/agent';

function Field({ question, value, onChange }: { question: UserInputQuestion; value: string; onChange: (v: string) => void }) {
  return (
    <label className="input-question">
      <span className="input-prompt">{question.prompt}</span>
      {question.options && question.options.length > 0 ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {question.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input type={question.secret ? 'password' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

/**
 * Clarifying questions from the agent. Skip is always available: an unanswerable question must
 * not be able to hold the turn open, and it is answered as "no answer" rather than as silence.
 */
export function UserInputCard({
  request,
  resolved,
  onResolve,
  cardRef,
}: {
  request: UserInputRequest;
  resolved?: { answers: UserInputAnswers };
  onResolve: (id: string, answers: UserInputAnswers) => void;
  cardRef?: RefObject<HTMLDivElement | null>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(request.questions.map((q) => [q.id, q.options?.[0] ?? ''])),
  );
  return (
    <div className="approval approval-input" ref={cardRef}>
      <div className="approval-title">The agent has a question</div>
      {request.questions.map((q) =>
        resolved ? (
          <div key={q.id} className="input-question">
            <span className="input-prompt">{q.prompt}</span>
          </div>
        ) : (
          <Field key={q.id} question={q} value={values[q.id] ?? ''} onChange={(v) => setValues((prev) => ({ ...prev, [q.id]: v }))} />
        ),
      )}
      {resolved ? (
        <div className="approval-decision">{resolved.answers ? 'Answered' : 'Skipped'}</div>
      ) : (
        <div className="approval-actions">
          <button onClick={() => onResolve(request.id, values)}>Submit</button>
          <button onClick={() => onResolve(request.id, null)}>Skip</button>
        </div>
      )}
    </div>
  );
}
