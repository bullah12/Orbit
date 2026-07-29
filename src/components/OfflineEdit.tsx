'use client';

import { useCallback, useEffect, useState } from 'react';
import { sendQueue } from '@/app/actions';
import { SpaceIndicator, type SpaceRef } from './SpaceIndicator';
import { Icon } from './Icon';
import {
  enqueue,
  optimisticValue,
  pendingFor,
  readOffline,
  readOutbox,
  settle,
  writeOffline,
  writeOutbox,
  type Outbox,
} from '@/lib/sync/outbox';
import { fieldLabel, type FieldValue, type SyncEntityKind } from '@/lib/sync/conflict';

/**
 * An edit that applies immediately, shows as pending, and either lands or
 * surfaces the conflict by name.
 *
 * Two things make this different from an ordinary form. First, the field shows
 * what was typed the instant it is typed, marked as **not yet sent** — never a
 * spinner that resolves into a lie. Second, the edit carries the version it was
 * made against and what the field held then, so when it does go the server can
 * tell "nothing moved" from "somebody else changed the same thing".
 *
 * "Offline" is a switch, not a network the browser noticed going away. Orbit
 * has no service worker — it cannot install one here without a build pipeline
 * it does not have — so the honest version is a control that says *Work
 * offline* and means it. Edits made with it on go into the queue, survive a
 * reload, and are sent when it goes back off.
 */
export function OfflineEdit({
  entityKind,
  entityId,
  space,
  updatedAt,
  fields,
  label,
}: {
  entityKind: SyncEntityKind;
  entityId: string;
  space: SpaceRef;
  /** The row's server `updated_at`, which is the version this edit is made against. */
  updatedAt: string;
  /** field → { label, value, kind } for every field this surface may edit. */
  fields: { name: string; value: string; options?: readonly (readonly [string, string])[] }[];
  label: string;
}) {
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    setOutbox(readOutbox());
    setOffline(readOffline());
  }, []);

  const update = useCallback((next: Outbox) => {
    writeOutbox(next);
    setOutbox(next);
  }, []);

  // Not rendered until the queue has been read, because a field that shows the
  // server's value for one frame and the queued value for the next reads as the
  // edit having been lost and then found.
  if (!outbox) {
    return (
      <p className="faint px-5 py-3 text-[12px]" aria-live="polite">
        Reading this device’s queue…
      </p>
    );
  }

  const queued = pendingFor(outbox, entityKind, entityId);

  async function queueEdit(field: string, value: string, serverValue: string) {
    if (!outbox) return;
    const base: Record<string, FieldValue> = { [field]: serverValue };
    const next = enqueue(outbox, {
      entityKind,
      entityId,
      spaceId: space.id,
      label,
      baseUpdatedAt: updatedAt,
      changes: { [field]: value },
      base,
    });
    update(next);
    setSaid(
      offline
        ? `${fieldLabel(field)} changed here. It is waiting to be sent.`
        : `${fieldLabel(field)} changed. Sending…`,
    );
    if (!offline) await send(next);
  }

  async function send(from: Outbox) {
    setBusy(true);
    try {
      const result = await sendQueue(from.writes);
      const after = settle(from, result.outcomes, result.dropped);
      update(after);
      const conflicts = result.outcomes.filter((o) => o.outcome === 'conflict').length;
      setSaid(
        conflicts > 0
          ? `${conflicts} of ${result.outcomes.length} could not be applied. Open Sync to answer them.`
          : `Sent. ${result.outcomes.map((o) => o.note).filter(Boolean)[0] ?? 'Applied.'}`,
      );
    } catch {
      // A failed send leaves the queue exactly as it was. That is the point of
      // a queue: nothing is lost because a request did not arrive.
      setSaid('That did not send. The edits are still queued on this device.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hairline border-t px-5 py-4" aria-labelledby="offline-edit-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="offline-edit-heading" className="text-[13px] font-semibold">
          Edit, offline or not
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
                  ? 'Working offline. Edits are queued on this device until you send them.'
                  : 'Back online. Edits are sent as you make them.',
              );
            }}
            aria-describedby="offline-explainer"
          />
          Work offline
        </label>
      </div>

      <p id="offline-explainer" className="muted mt-1 text-[12px]">
        A switch, not a network: Orbit has no service worker here, so this is a
        control you flick rather than a connection dropping. With it on, edits
        apply on this screen straight away and wait in this device’s queue.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const shown = optimisticValue(outbox, entityKind, entityId, f.name, f.value);
          const value = shown.value === null ? '' : String(shown.value);
          return (
            <label key={f.name} className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-[11px] font-medium">
                {fieldLabel(f.name)}
                {shown.isPending && (
                  <span
                    className="hairline inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]"
                    style={{ color: 'var(--c-amber)', borderColor: 'var(--c-amber)' }}
                  >
                    <Icon name="clock" size={10} /> not sent yet
                  </span>
                )}
              </span>
              {f.options ? (
                <select
                  className="hairline rounded border bg-transparent px-2 py-1 text-[13px]"
                  value={value}
                  disabled={busy}
                  onChange={(e) => void queueEdit(f.name, e.currentTarget.value, f.value)}
                >
                  {f.options.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="hairline rounded border bg-transparent px-2 py-1 text-[13px]"
                  defaultValue={value}
                  disabled={busy}
                  onBlur={(e) => {
                    if (e.currentTarget.value !== value) {
                      void queueEdit(f.name, e.currentTarget.value, f.value);
                    }
                  }}
                />
              )}
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SpaceIndicator space={space} />
        <span className="faint text-[11px]">
          {queued.length === 0
            ? 'Nothing queued for this item.'
            : `${queued.length} edit${queued.length === 1 ? '' : 's'} queued for this item.`}
        </span>
        {queued.length > 0 && (
          <button
            type="button"
            className="hairline rounded border px-2 py-1 text-[12px]"
            disabled={busy}
            onClick={() => void send(outbox)}
          >
            {busy ? 'Sending…' : `Send ${queued.length}`}
          </button>
        )}
      </div>

      <p className="muted mt-2 text-[12px]" role="status" aria-live="polite">
        {said ?? 'Nothing has been changed on this screen yet.'}
      </p>
    </section>
  );
}
