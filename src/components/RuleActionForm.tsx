'use client';

import { useState } from 'react';
import { addRuleActionAction, editRuleActionAction } from '@/app/actions';
import {
  ACTION_KINDS,
  ACTION_LABEL,
  ACTION_PARAMS,
  actionParamValue,
  type Action,
  type ActionKind,
} from '@/lib/rules';

/**
 * One action, composed or edited.
 *
 * The rough edge this closes is not "an action cannot be edited" — the query and
 * the server action for that were written a session ago and wired to nothing. It
 * is that the form was one select plus one free-text box that meant a different
 * thing per kind, captioned with all six meanings at once. Repeating *that* per
 * row would have been four differently-meaning boxes with the same label
 * stacked up the page, so the form had to be rebuilt before it could be reused.
 *
 * Now the box knows which parameter it is setting: `ACTION_PARAMS` says whether
 * the kind takes a choice, a number of days or a message, and changing the kind
 * changes the control in front of you. That is why this is a client component —
 * the same reason ComposeEvent is one. The submitted field is still one string
 * called `value`, so both server actions keep the shape they already had, and
 * `rawActionFrom` is the single place that turns it back into an action.
 *
 * `mode` decides which server action it posts to and how it reads: composing
 * carries visible labels, a row carries the same words as accessible names
 * because a row that spells out "To which priority" three times is a row nobody
 * can scan. Editing one is structural like every other rule edit — it switches
 * the rule off and clears its preview, which the page says out loud.
 */
export function RuleActionForm(
  props:
    | { mode: 'add'; ruleId: string }
    | { mode: 'edit'; ruleId: string; index: number; action: Action },
) {
  const isEdit = props.mode === 'edit';
  const [kind, setKind] = useState<ActionKind>(isEdit ? props.action.kind : 'task.set_priority');
  const spec = ACTION_PARAMS[kind];

  // The stored parameter only pre-fills the control while the kind is the one it
  // was stored under. Switch an "assign it" row to "defer it" and `normal` is
  // not a number of days, so the box starts empty rather than carrying a value
  // from the wrong vocabulary. Keying on the kind is what resets it.
  const stored = isEdit && kind === props.action.kind ? actionParamValue(props.action) : '';

  const ordinal = isEdit ? `Action ${props.index + 1}` : 'New action';
  const control = `${ordinal}: ${spec.label.toLowerCase()}`;
  const box = isEdit ? 'text-2xs' : 'text-xs';

  return (
    <form
      action={isEdit ? editRuleActionAction : addRuleActionAction}
      className={isEdit ? 'flex flex-wrap items-end gap-1.5' : 'flex flex-wrap items-end gap-2'}
      aria-label={isEdit ? `Change action ${props.index + 1}` : 'Add an action'}
    >
      <input type="hidden" name="ruleId" value={props.ruleId} />
      {isEdit && <input type="hidden" name="index" value={props.index} />}

      <Field label="Do this" visible={!isEdit} name={`${ordinal}: what it does`}>
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as ActionKind)}
          className={`input ${box}`}
        >
          {ACTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {ACTION_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>

      <Field label={spec.label} visible={!isEdit} name={control}>
        {spec.control === 'choice' ? (
          <select
            name="value"
            key={`v-${kind}`}
            defaultValue={stored}
            required
            className={`input ${box}`}
          >
            {!stored && <option value="">Choose one…</option>}
            {Object.entries(spec.options ?? {}).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : spec.control === 'days' ? (
          <input
            type="number"
            name="value"
            key={`v-${kind}`}
            defaultValue={stored}
            min={0}
            max={3650}
            step={1}
            required={spec.required}
            className={`input w-20 ${box}`}
          />
        ) : (
          <input
            type="text"
            name="value"
            key={`v-${kind}`}
            defaultValue={stored}
            autoComplete="off"
            placeholder="Optional"
            className={`input ${box}`}
          />
        )}
      </Field>

      <button
        type="submit"
        className={`hairline rounded border px-2 ${isEdit ? 'py-0.5 text-2xs' : 'py-1 text-xs'}`}
      >
        {isEdit ? 'Save this action' : 'Add action'}
      </button>
    </form>
  );
}

/**
 * A label either way. Composing shows it; a row hides the words and keeps them
 * as the control's accessible name, so the label audit and a screen reader both
 * get a real one and the row stays scannable.
 */
function Field({
  label,
  visible,
  name,
  children,
}: {
  label: string;
  visible: boolean;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={visible ? 'faint text-2xs' : 'sr-only'}>{visible ? label : name}</span>
      {children}
    </label>
  );
}
