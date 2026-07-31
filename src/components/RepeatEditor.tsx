'use client';

import { useState } from 'react';
import { setEventRepeat } from '@/app/actions';
import { WEEKDAYS, type RepeatForm, type Weekday } from '@/lib/recurrence';

const WEEKDAY_NAME: Record<Weekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

const UNIT: Record<RepeatForm['freq'], string> = {
  DAILY: 'days',
  WEEKLY: 'weeks',
  MONTHLY: 'months',
  YEARLY: 'years',
};

/**
 * An event's repeat, added, changed or removed.
 *
 * Until this existed a repeat could be built once, at compose time, and never
 * touched: `rruleFromForm` had no inverse, so a rule already stored could not be
 * read back into the form. `repeatFormFromRrule` is that inverse, and this is the
 * form it fills. Client-side for the same reason ComposeEvent is — which days a
 * weekly repeat lands on is only a question when the frequency is weekly, and
 * "every N" wants a different noun per frequency.
 *
 * Still one row plus an RRULE. This never writes expanded copies, and it never
 * moves the event's own start: the series' DTSTART *is* the event, so moving the
 * whole series means editing the date above, which is a different form saying a
 * different thing.
 *
 * `current` is null both when the event does not repeat and when it repeats in a
 * way this form cannot express — an ordinal BYDAY, a COUNT, a BYMONTHDAY. The
 * caller distinguishes those two and says which it is; this component only ever
 * shows controls it can honestly round-trip.
 */
export function RepeatEditor({
  eventId,
  current,
  startOn,
}: {
  eventId: string;
  current: RepeatForm | null;
  startOn: string;
}) {
  const [freq, setFreq] = useState<'' | RepeatForm['freq']>(current?.freq ?? '');

  return (
    <form action={setEventRepeat} className="flex flex-wrap items-end gap-3" aria-label="Repeat">
      <input type="hidden" name="eventId" value={eventId} />

      <label className="flex flex-col gap-1">
        <span className="faint text-2xs font-medium">Repeats</span>
        <select
          name="repeatFreq"
          value={freq}
          onChange={(e) => setFreq(e.target.value as '' | RepeatForm['freq'])}
          className="input"
        >
          <option value="">Does not repeat</option>
          <option value="DAILY">Every day</option>
          <option value="WEEKLY">Every week</option>
          <option value="MONTHLY">Every month</option>
          <option value="YEARLY">Every year</option>
        </select>
      </label>

      {freq !== '' && (
        <>
          <label className="flex flex-col gap-1">
            <span className="faint text-2xs font-medium">Every</span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                name="repeatInterval"
                // Keyed on the frequency so switching from "every 3 weeks" to
                // monthly does not silently carry the 3 into a different noun.
                key={`interval-${freq}`}
                defaultValue={current?.freq === freq ? current.interval : 1}
                min={1}
                max={99}
                className="input w-16"
              />
              <span className="faint text-2xs">{UNIT[freq]}</span>
            </span>
          </label>

          {freq === 'WEEKLY' && (
            <fieldset className="flex flex-col gap-1">
              <legend className="faint text-2xs font-medium">On these days</legend>
              <span className="flex items-center gap-1">
                {WEEKDAYS.map((code) => (
                  <label key={code} className="cursor-pointer">
                    <input
                      type="checkbox"
                      name="repeatByDay"
                      value={code}
                      defaultChecked={current?.byDay.includes(code) ?? false}
                      className="peer sr-only"
                    />
                    <span className="sr-only">{WEEKDAY_NAME[code]}</span>
                    <span
                      aria-hidden="true"
                      className="hairline flex rounded border px-1.5 py-1 text-2xs opacity-45 peer-checked:opacity-100 peer-focus-visible:outline peer-focus-visible:outline-2"
                    >
                      {code}
                    </span>
                  </label>
                ))}
              </span>
              <span className="faint text-2xs">
                None chosen uses the day the event starts on.
              </span>
            </fieldset>
          )}

          <label className="flex flex-col gap-1">
            <span className="faint text-2xs font-medium">Until</span>
            <input
              type="date"
              name="repeatUntil"
              defaultValue={current?.endOn ?? ''}
              min={startOn}
              className="input"
            />
          </label>
        </>
      )}

      <button type="submit" className="hairline rounded border px-3 py-1.5 text-xs font-medium">
        {freq === '' ? 'Stop repeating' : current ? 'Change the repeat' : 'Make it repeat'}
      </button>
    </form>
  );
}
