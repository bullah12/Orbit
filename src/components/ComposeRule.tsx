'use client';

import { useState } from 'react';
import { createRuleAction } from '@/app/actions';
import { SpaceIndicator } from './SpaceIndicator';
import { Icon } from './Icon';
import type { SpaceSummary } from '@/lib/queries/spaces';
import { TRIGGER_KINDS, TRIGGER_LABEL } from '@/lib/rules';

/**
 * Adding a rule.
 *
 * The space is a visible row of chips, exactly as it is on every other compose
 * surface, because a rule's space is its blast radius — it is the single most
 * important thing on this form and it is not going in a dropdown.
 *
 * A new rule arrives with no conditions and no actions, switched off. You
 * build it on its own page, preview it, and only then can you switch it on.
 */
export function ComposeRule({ spaces }: { spaces: SpaceSummary[] }) {
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? '');
  const [kind, setKind] = useState<string>('task.created');

  if (spaces.length === 0) return null;

  return (
    <form
      action={createRuleAction}
      className="hairline flex flex-wrap items-center gap-2 border-b px-3 py-2"
      style={{ background: 'var(--bg-raised)' }}
      aria-label="Add a rule"
    >
      <Icon name="plus" size={14} className="faint" />
      <input
        name="name"
        placeholder="Add a rule…"
        aria-label="Rule name"
        autoComplete="off"
        required
        className="min-w-40 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--text-faint)]"
      />
      <input
        name="description"
        placeholder="What it is for"
        aria-label="Description"
        autoComplete="off"
        className="min-w-32 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[color:var(--text-faint)]"
      />

      <label className="flex items-center gap-1.5">
        <span className="sr-only">Trigger</span>
        <select
          name="triggerKind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="faint rounded bg-transparent text-[11px] outline-none"
        >
          {TRIGGER_KINDS.map((k) => (
            <option key={k} value={k}>
              {TRIGGER_LABEL[k]}
            </option>
          ))}
        </select>
      </label>

      {kind === 'schedule' && (
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Schedule, as cron</span>
          <input
            name="cron"
            defaultValue="0 7 * * *"
            aria-label="Schedule, as cron"
            size={10}
            className="faint w-24 bg-transparent font-mono text-[11px] outline-none"
          />
        </label>
      )}

      <fieldset className="flex items-center gap-1">
        <legend className="sr-only">Space</legend>
        {spaces.map((s) => (
          <label key={s.id} className="cursor-pointer">
            <input
              type="radio"
              name="spaceId"
              value={s.id}
              checked={s.id === spaceId}
              onChange={() => setSpaceId(s.id)}
              className="peer sr-only"
            />
            <span className="block rounded opacity-45 peer-checked:opacity-100 peer-focus-visible:outline peer-focus-visible:outline-2">
              <SpaceIndicator space={s} />
            </span>
          </label>
        ))}
      </fieldset>

      <button
        type="submit"
        className="rounded px-2 py-1 text-[12px] font-medium"
        style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
      >
        Add
      </button>
    </form>
  );
}
