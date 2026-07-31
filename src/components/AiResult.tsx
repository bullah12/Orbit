import { Icon } from './Icon';

/**
 * What was sent, next to what came back — or the refusal, and nothing else.
 *
 * The same panel on all three AI surfaces, so a person reads one shape
 * wherever they run something. A refusal shows no prompt because there was
 * none: nothing was assembled and nothing was sent, and showing an empty box
 * labelled "what was sent" would suggest otherwise.
 *
 * It carries the rough edge the AI page already had, knowingly: the result is
 * a query parameter, so a refresh re-displays it and a long subject makes a
 * long URL. Nothing is persisted beyond the `ai_runs` row, which is
 * deliberate — the URL is not.
 */
export function AiResult({
  sent,
  answer,
  refused,
}: {
  sent?: string;
  answer?: string;
  refused?: string;
}) {
  if (!sent && !answer && !refused) return null;

  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      {refused && (
        <p
          role="alert"
          className="hairline rounded border px-3 py-2 text-xs"
          style={{ background: 'var(--c-amber-bg)', color: 'var(--c-amber)' }}
          id="ai-refusal"
        >
          <Icon name="slash" size={12} className="mr-1 inline" />
          {refused}
        </p>
      )}
      {sent && (
        <div className="hairline rounded border px-3 py-2">
          <p className="faint text-2xs font-semibold uppercase tracking-wider">What was sent</p>
          <pre id="ai-sent" className="mt-1 whitespace-pre-wrap text-xs">
            {sent}
          </pre>
        </div>
      )}
      {answer && (
        <div className="hairline rounded border px-3 py-2">
          <p className="faint text-2xs font-semibold uppercase tracking-wider">What came back</p>
          <p id="ai-answer" className="mt-1 text-xs">
            {answer}
          </p>
        </div>
      )}
    </div>
  );
}
