'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { answerConflict, sendQueue } from '@/app/actions';
import { SpaceIndicator, type SpaceRef } from './SpaceIndicator';
import { Icon } from './Icon';
import {
  clearConflict,
  discard,
  outboxSummary,
  readOffline,
  readOutbox,
  settle,
  writeOffline,
  writeOutbox,
  type Outbox,
} from '@/lib/sync/outbox';
import {
  clockSkew,
  CONFLICT_LABEL,
  displayValue,
  fieldLabel,
  OUTCOME_LABEL,
  type Conflict,
} from '@/lib/sync/conflict';

/**
 * This device's queue: what is waiting to be sent, and what came back that a
 * person has to answer.
 *
 * The queue is the client's, so this is the one surface in Orbit that renders
 * from `localStorage` rather than from a query. That is not a visibility
 * decision — nothing here is a row somebody else could see — it is where the
 * edits genuinely are while they are unsent.
 *
 * Every pending row and every conflict row carries its space indicator, on the
 * same terms as a task row or a calendar block: the moment somebody is deciding
 * whether to overwrite somebody else's typing is exactly the moment they should
 * be able to see whose space it is in.
 */

const PATH: Record<string, (id: string) => string> = {
  task: (id) => `/tasks/item/${id}`,
  note: (id) => `/notes/${id}`,
  event: (id) => `/calendar/event/${id}`,
  person: (id) => `/people/${id}`,
  place: (id) => `/places/${id}`,
};

export function OutboxPanel({ spaces, serverNow }: { spaces: SpaceRef[]; serverNow: string }) {
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [results, setResults] = useState<{ opId: string; outcome: string; note: string | null }[]>([]);
  const [deviceNow, setDeviceNow] = useState<string | null>(null);

  useEffect(() => {
    setOutbox(readOutbox());
    setOffline(readOffline());
    setDeviceNow(new Date().toISOString());
  }, []);

  const update = useCallback((next: Outbox) => {
    writeOutbox(next);
    setOutbox(next);
  }, []);

  const spaceOf = useCallback(
    (id: string): SpaceRef | null => spaces.find((s) => s.id === id) ?? null,
    [spaces],
  );

  if (!outbox) {
    return (
      <p className="faint px-5 py-3 text-[12px]" aria-live="polite">
        Reading this device’s queue…
      </p>
    );
  }

  const summary = outboxSummary(outbox);
  const skew = deviceNow ? clockSkew(deviceNow, serverNow) : null;

  async function send() {
    if (!outbox) return;
    setBusy(true);
    try {
      const result = await sendQueue(outbox.writes);
      update(settle(outbox, result.outcomes, result.dropped));
      setResults(result.outcomes.map((o) => ({ opId: o.opId, outcome: o.outcome, note: o.note })));
      const conflicts = result.outcomes.filter((o) => o.outcome === 'conflict').length;
      setSaid(
        result.outcomes.length === 0
          ? 'There was nothing to send.'
          : conflicts === 0
            ? `Sent ${result.outcomes.length}. Nothing clashed.`
            : `Sent ${result.outcomes.length}. ${conflicts} could not be applied and ${conflicts === 1 ? 'is' : 'are'} below.`,
      );
    } catch {
      setSaid('That did not send. Nothing has left this device and the queue is unchanged.');
    } finally {
      setBusy(false);
    }
  }

  async function answer(conflict: Conflict, choice: 'mine' | 'theirs') {
    if (!outbox) return;
    setBusy(true);
    try {
      const result = await answerConflict(conflict, choice);
      if (result.ok) {
        update(clearConflict(outbox, conflict.opId));
        setSaid(result.note);
      } else if (result.conflict) {
        update({
          ...clearConflict(outbox, conflict.opId),
          conflicts: [...clearConflict(outbox, conflict.opId).conflicts, result.conflict],
        });
        setSaid(result.note);
      } else {
        setSaid(result.note);
      }
    } catch {
      setSaid('That answer did not go through. The conflict is still here.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="hairline border-b px-5 py-4" aria-labelledby="outbox-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="outbox-heading" className="text-[13px] font-semibold">
            This device’s queue
          </h2>
          <label className="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={offline}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setOffline(v);
                writeOffline(v);
                setSaid(
                  v
                    ? 'Working offline. Edits queue on this device until you send them.'
                    : 'Back online. Edits are sent as they are made.',
                );
              }}
            />
            Work offline
          </label>
        </div>

        <p className="muted mt-1 text-[12px]" role="status" aria-live="polite" id="outbox-summary">
          {summary.sentence}
        </p>

        {skew?.isSuspicious && (
          <p className="mt-1 text-[12px]" style={{ color: 'var(--c-amber)' }}>
            <Icon name="alert" size={12} /> {skew.sentence}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="hairline rounded border px-2.5 py-1 text-[12px]"
            onClick={() => void send()}
            disabled={busy || summary.queued === 0}
          >
            {busy ? 'Sending…' : `Send ${summary.queued} queued edit${summary.queued === 1 ? '' : 's'}`}
          </button>
          <span className="faint text-[11px]">
            A queued write is an ordinary write: it goes through the same policies as
            every other one, and one made into a space you have since left is refused.
          </span>
        </div>

        {said && (
          <p className="mt-2 text-[12px]" role="status" aria-live="polite">
            {said}
          </p>
        )}
      </section>

      <section className="hairline border-b px-5 py-4" aria-labelledby="queued-heading">
        <h2 id="queued-heading" className="text-[13px] font-semibold">
          Waiting to be sent
        </h2>
        {outbox.writes.length === 0 ? (
          <p className="muted mt-1 text-[12px]">
            Nothing is waiting. Edits made while <em>Work offline</em> is on appear here.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5" id="outbox-queued">
            {outbox.writes.map((w) => {
              const space = spaceOf(w.spaceId);
              return (
                <li
                  key={w.opId}
                  className="hairline flex flex-wrap items-center gap-2 rounded border px-2.5 py-1.5 text-[12px]"
                >
                  {space ? (
                    <SpaceIndicator space={space} />
                  ) : (
                    <span className="faint text-[11px]">a space this account can no longer see</span>
                  )}
                  <span className="hairline rounded border px-1.5 py-0.5 text-[11px]">{w.entityKind}</span>
                  <Link href={(PATH[w.entityKind]?.(w.entityId) ?? '/sync') as never} className="font-medium">
                    {w.label}
                  </Link>
                  <span className="muted">
                    {Object.keys(w.changes)
                      .map((f) => `${fieldLabel(f)} → ${displayValue(w.changes[f] ?? null)}`)
                      .join(', ')}
                  </span>
                  <span className="faint ml-auto text-[11px]">#{w.seq}</span>
                  <button
                    type="button"
                    className="hairline rounded border px-1.5 py-0.5 text-[11px]"
                    disabled={busy}
                    onClick={() => {
                      update(discard(outbox, w.opId));
                      setSaid('That edit was discarded. It was never sent.');
                    }}
                  >
                    Discard
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="hairline border-b px-5 py-4" aria-labelledby="conflicts-heading">
        <h2 id="conflicts-heading" className="text-[13px] font-semibold">
          Conflicts to answer
        </h2>
        {outbox.conflicts.length === 0 ? (
          <p className="muted mt-1 text-[12px]">
            None. A conflict appears here when the same thing was changed in two
            places — nothing is ever overwritten to avoid one.
          </p>
        ) : (
          <ul className="mt-2 space-y-2" id="outbox-conflicts">
            {outbox.conflicts.map((c) => {
              const space = spaceOf(c.spaceId);
              return (
                <li key={c.opId} className="hairline rounded border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    {space ? (
                      <SpaceIndicator space={space} />
                    ) : (
                      <span className="faint text-[11px]">a space this account can no longer see</span>
                    )}
                    <span
                      className="hairline inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
                      style={{ color: 'var(--c-amber)', borderColor: 'var(--c-amber)' }}
                    >
                      <Icon name="alert" size={11} /> {CONFLICT_LABEL[c.kind]}
                    </span>
                    <Link href={(PATH[c.entityKind]?.(c.entityId) ?? '/sync') as never} className="font-medium">
                      {c.entityKind}
                    </Link>
                  </div>
                  <p className="muted mt-1 text-[12px]">{c.reason}</p>

                  {c.clashes.length > 0 && (
                    <table className="mt-2 w-full text-[12px]">
                      <caption className="sr-only">What each side says</caption>
                      <thead>
                        <tr className="faint text-left text-[11px]">
                          <th scope="col" className="py-0.5 pr-3 font-medium">Field</th>
                          <th scope="col" className="py-0.5 pr-3 font-medium">Yours, not sent</th>
                          <th scope="col" className="py-0.5 pr-3 font-medium">Theirs, on the server</th>
                          <th scope="col" className="py-0.5 font-medium">Both started from</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.clashes.map((f) => (
                          <tr key={f.field}>
                            <th scope="row" className="py-0.5 pr-3 text-left font-medium">
                              {fieldLabel(f.field)}
                            </th>
                            <td className="py-0.5 pr-3">{displayValue(f.mine)}</td>
                            <td className="py-0.5 pr-3">{displayValue(f.theirs)}</td>
                            <td className="faint py-0.5">{displayValue(f.base)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {Object.keys(c.mergeable).length > 0 && (
                    <p className="faint mt-1 text-[11px]">
                      {Object.keys(c.mergeable).map(fieldLabel).join(', ')} merged cleanly and
                      will be written either way — nobody disagreed about {Object.keys(c.mergeable).length === 1 ? 'it' : 'them'}.
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.kind === 'field_conflict' ? (
                      <>
                        <button
                          type="button"
                          className="hairline rounded border px-2 py-1 text-[12px]"
                          disabled={busy}
                          onClick={() => void answer(c, 'mine')}
                        >
                          Keep mine
                        </button>
                        <button
                          type="button"
                          className="hairline rounded border px-2 py-1 text-[12px]"
                          disabled={busy}
                          onClick={() => void answer(c, 'theirs')}
                        >
                          Keep theirs
                        </button>
                      </>
                    ) : (
                      <span className="faint text-[11px]">
                        There is no answer this queue can carry out. Making it again is a
                        new edit, against what is there now.
                      </span>
                    )}
                    <button
                      type="button"
                      className="hairline rounded border px-2 py-1 text-[12px]"
                      disabled={busy}
                      onClick={() => {
                        update(clearConflict(outbox, c.opId));
                        setSaid('That conflict was dismissed. Nothing was written.');
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {results.length > 0 && (
        <section className="hairline border-b px-5 py-4" aria-labelledby="results-heading">
          <h2 id="results-heading" className="text-[13px] font-semibold">
            What happened to the last send
          </h2>
          <ul className="mt-2 space-y-1" id="outbox-results">
            {results.map((r) => (
              <li key={r.opId} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                <span className="hairline rounded border px-1.5 py-0.5 text-[11px]">
                  {OUTCOME_LABEL[r.outcome as keyof typeof OUTCOME_LABEL] ?? r.outcome}
                </span>
                <span className="muted">{r.note ?? '—'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
