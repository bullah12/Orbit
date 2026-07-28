import 'server-only';
import { asUser, type Tx } from '@/lib/db';
import { calendarProvider, type ExternalEvent } from '@/lib/integrations';
import { parseRrule } from '@/lib/recurrence';

/**
 * Pulling a calendar in from outside.
 *
 * One code path for both providers. The fixture-backed fake models the part
 * that matters — a first pull returns the window, a second returns only what
 * changed plus what was deleted, and a token carries the place between them —
 * so the machinery is exercised here even though the Google implementation
 * cannot be. What is *not* modelled is anything Google-specific; if a bug only
 * appears against the real API, this is where it will be, and nothing in this
 * file has ever run against it.
 *
 * Everything is written with the `space_id` and `owner_id` of the **calendar**,
 * never from a form. The policies would refuse a calendar the caller cannot
 * write to in any case — that is the check, this is belt and braces.
 */

export type PullResult = {
  added: number;
  updated: number;
  /** Cancelled locally, never hard-deleted: a tombstone is recoverable, a delete is not. */
  removed: number;
  rules: number;
  token: string | null;
  /** True when the provider had no token from us, so this pulled the whole window. */
  wasFullPull: boolean;
};

type CalendarRow = {
  id: string;
  spaceId: string;
  externalId: string | null;
  accountId: string | null;
};

/**
 * Write one external event into `events`, matched on the feed's own id.
 *
 * The unique constraint on (space_id, calendar_id, external_id) is what makes
 * a re-import safe. Note it is led by space_id, as every unique constraint in
 * Orbit is: two spaces subscribing to the same public feed are two separate
 * sets of events, not a collision.
 */
export async function upsertExternalEvent(
  tx: Tx,
  ctx: { userId: string; spaceId: string; calendarId: string },
  event: ExternalEvent,
): Promise<{ id: string | null; inserted: boolean; wroteRule: boolean }> {
  const existing = await tx<{ id: string; ruleId: string | null }[]>`
    select id, recurrence_rule_id as "ruleId" from public.events
    where space_id = ${ctx.spaceId}::uuid
      and calendar_id = ${ctx.calendarId}::uuid
      and external_id = ${event.externalId}
  `;
  const priorRuleId = existing[0]?.ruleId ?? null;

  let ruleId: string | null = null;
  if (event.rrule) {
    if (priorRuleId) {
      await tx`
        update public.recurrence_rules
        set rrule = ${event.rrule}, dtstart = ${event.startsAt}::timestamptz,
            until = ${untilOf(event.rrule)}, timezone = ${event.timezone},
            exdates = ${event.exdates}::timestamptz[]
        where id = ${priorRuleId}::uuid
      `;
      ruleId = priorRuleId;
    } else {
      const rows = await tx<{ id: string }[]>`
        insert into public.recurrence_rules
          (space_id, owner_id, rrule, dtstart, until, timezone, exdates)
        values (${ctx.spaceId}::uuid, ${ctx.userId}::uuid, ${event.rrule},
                ${event.startsAt}::timestamptz, ${untilOf(event.rrule)},
                ${event.timezone}, ${event.exdates}::timestamptz[])
        returning id
      `;
      ruleId = rows[0]?.id ?? null;
    }
  }

  const rows = await tx<{ id: string; inserted: boolean }[]>`
    insert into public.events
      (space_id, owner_id, calendar_id, title, body_md, location_text,
       starts_at, ends_at, all_day, timezone, status, external_id, external_etag,
       recurrence_rule_id)
    values (
      ${ctx.spaceId}::uuid, ${ctx.userId}::uuid, ${ctx.calendarId}::uuid,
      ${event.title}, ${event.description}, ${event.location},
      ${event.startsAt}::timestamptz, ${event.endsAt}::timestamptz,
      ${event.allDay}, ${event.timezone}, ${event.status},
      ${event.externalId}, ${event.etag}, ${ruleId}::uuid
    )
    on conflict (space_id, calendar_id, external_id) do update
      set title = excluded.title,
          body_md = excluded.body_md,
          location_text = excluded.location_text,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          all_day = excluded.all_day,
          status = excluded.status,
          external_etag = excluded.external_etag,
          recurrence_rule_id = excluded.recurrence_rule_id,
          -- The remote copy is now authoritative again.
          is_dirty = false
    returning id, (xmax = 0) as inserted
  `;

  const id = rows[0]?.id ?? null;

  // A rule that is no longer on the event would otherwise be left behind.
  if (priorRuleId && ruleId !== priorRuleId) {
    await tx`delete from public.recurrence_rules where id = ${priorRuleId}::uuid`;
  }

  if (id) {
    // Attendees are replaced wholesale: the feed is the source of truth for its
    // own events, and a diff would leave a removed guest behind.
    await tx`delete from public.event_attendees where event_id = ${id}::uuid`;
    for (const a of event.attendees) {
      if (!a.email && !a.displayName) continue;
      await tx`
        insert into public.event_attendees
          (space_id, owner_id, event_id, email, display_name, response, is_organiser)
        values (${ctx.spaceId}::uuid, ${ctx.userId}::uuid, ${id}::uuid,
                ${a.email}, ${a.displayName}, ${a.response}, ${a.isOrganiser})
      `;
    }
  }

  return { id, inserted: rows[0]?.inserted ?? false, wroteRule: ruleId !== null };
}

function untilOf(rrule: string): string | null {
  try {
    return parseRrule(rrule).until;
  } catch {
    return null;
  }
}

/**
 * Connect one of the provider's calendars to a space, if it is not already.
 *
 * Idempotent: calling it twice returns the same calendar. The account row
 * carries no credential — with the fake there is none, and with Google the
 * token lives outside the database entirely (`credential_ref` stays null until
 * there is somewhere real to point it).
 */
export async function connectProviderCalendar(
  userId: string,
  spaceId: string,
  external: { externalId: string; name: string; writable: boolean },
  providerName: 'google' | 'ics' | 'local',
): Promise<string | null> {
  return asUser(userId, async (tx) => {
    const accounts = await tx<{ id: string }[]>`
      insert into public.calendar_accounts
        (space_id, owner_id, provider, display_name, external_id, status)
      values (${spaceId}::uuid, ${userId}::uuid, ${providerName},
              ${`${external.name}`}, ${external.externalId}, 'connected')
      on conflict (space_id, provider, external_id)
        do update set status = 'connected', display_name = excluded.display_name
      returning id
    `;
    const accountId = accounts[0]?.id;
    // No row means the policy refused it, which is the right answer to
    // "connect a calendar into a space you cannot write".
    if (!accountId) return null;

    const calendars = await tx<{ id: string }[]>`
      insert into public.calendars
        (space_id, owner_id, account_id, name, external_id, is_writable, icon, colour)
      values (${spaceId}::uuid, ${userId}::uuid, ${accountId}::uuid, ${external.name},
              ${external.externalId}, ${external.writable}, 'calendar', 'slate')
      on conflict (space_id, account_id, external_id)
        do update set name = excluded.name, is_writable = excluded.is_writable
      returning id
    `;
    return calendars[0]?.id ?? null;
  });
}

/**
 * Pull a connected calendar.
 *
 * The window is deliberately wide and fixed rather than "whatever is on
 * screen": a sync that only fetches the visible month leaves holes you find
 * six weeks later. The token, the window and the outcome all go into
 * `calendar_sync_state`, so a failed run is resumable and a successful one
 * does not refetch what it already has.
 */
export async function pullCalendar(
  userId: string,
  calendarId: string,
  now: Date = new Date(),
): Promise<PullResult> {
  const provider = calendarProvider();

  const calendars = await asUser(userId, async (tx) => {
    return tx<CalendarRow[]>`
      select id, space_id as "spaceId", external_id as "externalId",
             account_id as "accountId"
      from public.calendars where id = ${calendarId}::uuid
    `;
  });
  const calendar = calendars[0];
  if (!calendar?.externalId) {
    return { added: 0, updated: 0, removed: 0, rules: 0, token: null, wasFullPull: false };
  }

  const state = await asUser(userId, async (tx) => {
    return tx<{ syncToken: string | null }[]>`
      select sync_token as "syncToken" from public.calendar_sync_state
      where calendar_id = ${calendarId}::uuid and direction = 'pull'
    `;
  });
  const syncToken = state[0]?.syncToken ?? null;

  const from = new Date(now.getTime() - 180 * 86_400_000);
  const to = new Date(now.getTime() + 365 * 86_400_000);

  await recordState(userId, calendar, from, to, { status: 'running' });

  let page;
  try {
    page = await provider.listEvents(calendar.externalId, {
      from: from.toISOString(),
      to: to.toISOString(),
      syncToken,
    });
  } catch (err) {
    // A failed pull is recorded rather than thrown away: the next run needs to
    // know whether the token is still good.
    await recordState(userId, calendar, from, to, { status: 'error', error: String(err) });
    throw err;
  }

  const counts = await asUser(userId, async (tx) => {
    let added = 0;
    let updated = 0;
    let rules = 0;
    for (const event of page!.events) {
      const res = await upsertExternalEvent(
        tx,
        { userId, spaceId: calendar.spaceId, calendarId: calendar.id },
        event,
      );
      if (res.inserted) added += 1;
      else if (res.id) updated += 1;
      if (res.wroteRule) rules += 1;
    }

    let removed = 0;
    if (page!.deletedIds.length > 0) {
      const rows = await tx<{ id: string }[]>`
        update public.events
        set status = 'cancelled'
        where calendar_id = ${calendar.id}::uuid
          and external_id = any(${page!.deletedIds}::text[])
          and status <> 'cancelled'
        returning id
      `;
      removed = rows.length;
    }
    return { added, updated, removed, rules };
  });

  await recordState(userId, calendar, from, to, {
    status: 'ok',
    token: page.nextSyncToken,
  });

  return { ...counts, token: page.nextSyncToken, wasFullPull: syncToken === null };
}

async function recordState(
  userId: string,
  calendar: CalendarRow,
  from: Date,
  to: Date,
  outcome: { status: 'running' | 'ok' | 'error'; token?: string | null; error?: string },
): Promise<void> {
  await asUser(userId, async (tx) => {
    await tx`
      insert into public.calendar_sync_state
        (space_id, owner_id, calendar_id, direction, sync_token,
         window_start, window_end, last_run_at, last_status, last_error)
      values (${calendar.spaceId}::uuid, ${userId}::uuid, ${calendar.id}::uuid, 'pull',
              ${outcome.token ?? null}, ${from}, ${to}, now(), ${outcome.status},
              ${outcome.error ?? null})
      on conflict (space_id, calendar_id, direction) do update
        set -- A running/error update must not wipe the token we still hold.
            sync_token = coalesce(excluded.sync_token, public.calendar_sync_state.sync_token),
            window_start = excluded.window_start,
            window_end = excluded.window_end,
            last_run_at = excluded.last_run_at,
            last_status = excluded.last_status,
            last_error = excluded.last_error
    `;
    if (calendar.accountId && outcome.status === 'ok') {
      await tx`
        update public.calendar_accounts set last_synced_at = now()
        where id = ${calendar.accountId}::uuid
      `;
    }
  });
}

export type ConnectedCalendar = {
  id: string;
  name: string;
  spaceId: string;
  spaceLabel: string;
  provider: string;
  externalId: string | null;
  lastStatus: string | null;
  lastRunAt: string | null;
  hasToken: boolean;
  eventCount: number;
};

/** What the sources page lists. Policy-scoped like everything else. */
export async function listConnectedCalendars(userId: string): Promise<ConnectedCalendar[]> {
  return asUser(userId, async (tx) => {
    return tx<ConnectedCalendar[]>`
      select
        c.id, c.name, c.space_id as "spaceId", s.short_label as "spaceLabel",
        coalesce(a.provider, 'local') as provider,
        c.external_id as "externalId",
        st.last_status as "lastStatus",
        st.last_run_at as "lastRunAt",
        (st.sync_token is not null) as "hasToken",
        coalesce(ev.n, 0) as "eventCount"
      from public.calendars c
      join public.spaces s on s.id = c.space_id
      left join public.calendar_accounts a on a.id = c.account_id
      left join public.calendar_sync_state st
        on st.calendar_id = c.id and st.direction = 'pull'
      left join lateral (
        select count(*)::int as n from public.events e where e.calendar_id = c.id
      ) ev on true
      order by s.name, c.sort_order, c.name
    `;
  });
}
