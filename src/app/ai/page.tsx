import { requireUser } from '@/lib/auth';
import { listAiRuns, listConsents, listNoteSubjects } from '@/lib/queries/ai';
import { AI_FEATURE_LABEL, describeAiRun, isAiFeature } from '@/lib/ai';
import { providerSummary } from '@/lib/integrations';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { formatRelative } from '@/lib/format';
import { setAiConsent, runAiOnNote } from '@/app/actions';

export const dynamic = 'force-dynamic';

/**
 * AI settings, and the one place an AI feature can actually be run.
 *
 * Everything is off until somebody switches it on, each row says in plain
 * language what would leave the device, and the provider that would answer is
 * named — so "AI is on" is never a claim you have to take on trust.
 *
 * The try-it panel lists locked notes **and refuses them**, rather than hiding
 * them. A locked note that vanishes from the picker looks like a note that does
 * not exist; one that is listed and refused is the promise being kept in front
 * of you.
 */
export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; answer?: string; refused?: string }>;
}) {
  const { error, sent, answer, refused } = await searchParams;
  const user = await requireUser();
  const [consents, notes, runs] = await Promise.all([
    listConsents(user.id),
    listNoteSubjects(user.id, 30),
    listAiRuns(user.id, 10),
  ]);

  const ai = providerSummary().find((p) => p.variable === 'AI_PROVIDER');
  const enabled = consents.filter((c) => c.isEnabled).length;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-lg font-semibold">AI</h1>
          <span className="faint text-xs">
            {enabled} of {consents.length} on
          </span>
        </div>
        <p className="muted mt-0.5 text-xs">
          Every AI feature is off until you switch it on, one feature at a time,
          in one space at a time. Each row says exactly what would leave this
          device. Locked items never reach any of them — they have no plaintext
          on the server, so there is nothing to send.
        </p>
        <p className="faint mt-1 text-2xs">
          Natural-language capture is <strong>not</strong> on this page, on
          purpose: it is parsed locally and never sends anything anywhere,
          whatever is switched on here.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="hairline border-b px-5 py-2 text-xs"
          style={{ background: 'var(--c-amber-bg)', color: 'var(--c-amber)' }}
        >
          {error}
        </p>
      )}

      <section className="px-5 py-4">
        <h2 className="text-sm font-semibold">Which provider would answer</h2>
        <p className="mt-1 inline-flex flex-wrap items-center gap-2 text-xs">
          <span
            className="hairline inline-flex items-center gap-1 rounded border px-2 py-1"
            id="ai-provider"
          >
            <Icon name={ai?.isFake ? 'lock' : 'sparkle'} size={12} className="muted" />
            {ai?.name ?? 'unknown'}
          </span>
          <span className="muted">
            {ai?.isFake
              ? 'A fake. Entirely local, deterministic, and offline — nothing leaves this machine whatever you switch on below.'
              : 'A real provider. Text you send it leaves this machine.'}
          </span>
        </p>
      </section>

      <section className="px-5 pb-4" aria-labelledby="consent-heading">
        <h2 id="consent-heading" className="text-sm font-semibold">
          What you have agreed to
        </h2>
        <p className="muted mt-0.5 text-xs">
          These are yours alone. Being in somebody&rsquo;s space does not show
          you what they agreed to send, and does not let you agree for them —
          the policy on the table says so, not this page.
        </p>
        <p className="faint mt-1 text-2xs" id="ai-where">
          Each is run from where the thing it acts on lives: a note here, a
          task from its own page, and the week from Today, once per space.
        </p>
        <ul id="ai-consents" className="mt-2 flex flex-col gap-2">
          {consents.map((c) => (
            <li key={c.id} className="hairline flex flex-col gap-1 rounded border px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <SpaceIndicator space={c.space} />
                <span className="text-sm font-medium">
                  {isAiFeature(c.feature) ? AI_FEATURE_LABEL[c.feature] : c.feature}
                </span>
                <span
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs"
                  style={
                    c.isEnabled
                      ? { background: 'var(--bg-sunken)', color: 'var(--text)', border: '1px solid var(--line-strong)' }
                      : { background: 'var(--bg-sunken)', color: 'var(--text-faint)' }
                  }
                >
                  <Icon name={c.isEnabled ? 'check' : 'pause'} size={11} />
                  {c.isEnabled ? 'On' : 'Off'}
                </span>
              </div>
              <p className="muted text-xs">{c.dataLeavesDevice}</p>
              <div className="flex flex-wrap items-center gap-3">
                <form action={setAiConsent}>
                  <input type="hidden" name="consentId" value={c.id} />
                  <input type="hidden" name="enabled" value={c.isEnabled ? '0' : '1'} />
                  <button
                    type="submit"
                    className="hairline rounded border px-2 py-1 text-xs"
                  >
                    {c.isEnabled ? 'Switch off' : 'Switch on, and send this'}
                  </button>
                </form>
                <span className="faint text-2xs">
                  {c.consentedAt ? `Consented ${formatRelative(c.consentedAt)}` : 'Never consented'}
                  {c.revokedAt ? ` · revoked ${formatRelative(c.revokedAt)}` : ''}
                </span>
              </div>
            </li>
          ))}
          {consents.length === 0 && (
            <li className="muted text-xs">
              There are no AI features in your spaces to consent to.
            </li>
          )}
        </ul>
      </section>

      <section className="px-5 pb-4" aria-labelledby="try-heading">
        <h2 id="try-heading" className="text-sm font-semibold">
          Summarise a note
        </h2>
        <p className="muted mt-0.5 text-xs">
          Locked notes are listed here and refused when you pick one. They are
          not hidden, because a note that vanishes looks like a note that is not
          there.
        </p>
        <form
          action={runAiOnNote}
          aria-label="Summarise a note"
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="feature" value="note_summary" />
          <label htmlFor="ai-note" className="sr-only">
            Which note
          </label>
          <select id="ai-note" name="noteId" className="input" style={{ width: '22rem' }}>
            {notes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.isLocked ? '🔒 (locked — never sent)' : n.title || '(untitled)'} —{' '}
                {n.space.shortLabel}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
          >
            <Icon name="sparkle" size={13} />
            Summarise it
          </button>
        </form>

        <div aria-live="polite" className="mt-3 flex flex-col gap-2">
          {refused && (
            <p
              role="alert"
              className="hairline rounded border px-3 py-2 text-xs"
              style={{ background: 'var(--c-amber-bg)', color: 'var(--c-amber)' }}
              id="ai-refusal"
            >
              {refused}
            </p>
          )}
          {sent && (
            <div className="hairline rounded border px-3 py-2">
              <p className="faint text-2xs font-semibold uppercase tracking-wider">
                What was sent
              </p>
              <pre id="ai-sent" className="mt-1 whitespace-pre-wrap text-xs">
                {sent}
              </pre>
            </div>
          )}
          {answer && (
            <div className="hairline rounded border px-3 py-2">
              <p className="faint text-2xs font-semibold uppercase tracking-wider">
                What came back
              </p>
              <p id="ai-answer" className="mt-1 text-xs">
                {answer}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="px-5 pb-6">
        <h2 className="text-sm font-semibold">Every attempt</h2>
        <p className="muted mt-0.5 text-xs">
          Recorded whether or not anything was sent, and never with the content.
          A refusal is a row, so “nothing was sent” is a fact you can check
          rather than an absence you have to trust.
        </p>
        <ul id="ai-runs" className="mt-2 flex flex-col gap-1">
          {runs.map((r) => (
            <li
              key={r.id}
              className="hairline flex flex-wrap items-center gap-2 rounded border px-2 py-1.5"
            >
              <SpaceIndicator space={r.space} />
              <span className="text-xs">{describeAiRun(r)}</span>
              <span className="faint text-2xs">{formatRelative(r.ranAt)}</span>
            </li>
          ))}
          {runs.length === 0 && <li className="faint text-xs">Nothing has run yet.</li>}
        </ul>
      </section>
    </div>
  );
}
