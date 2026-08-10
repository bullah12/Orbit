import 'server-only';
import { asUser } from '@/lib/db';

/**
 * The numbers on the `/more` rows, in one round trip.
 *
 * A settings screen that says "Notes" and a settings screen that says "Notes
 * 62" are different screens: the second one answers "is there anything in
 * there" without being opened, which is most of what somebody is asking when
 * they look at a list like this.
 *
 * One query rather than four, because four page-level `Promise.all` entries for
 * four integers is four round trips to draw four labels. No `where` on the
 * caller anywhere below: the policies on each table already restrict these to
 * the spaces they are a member of, and adding a filter would hide the fact that
 * the policy is what protects them.
 *
 * **Only counts that are honest.** There is no `sync` count here even though
 * the design sketches one: conflicts live in the browser's outbox, not in
 * Postgres, so a server-rendered number would be a number about nobody's
 * device. Sync keeps a bare row rather than a figure that is wrong.
 */
export type MoreCounts = {
  places: number;
  notes: number;
  /** Rules switched on. A rule that exists but is off is not doing anything. */
  rulesOn: number;
  /** AI consents currently granted — per feature, per space (see queries/ai). */
  consents: number;
};

export async function moreCounts(userId: string): Promise<MoreCounts> {
  return asUser(userId, async (tx) => {
    const [row] = await tx<MoreCounts[]>`
      select
        (select count(*) from orbit.places where archived_at is null)::int as places,
        (select count(*) from orbit.notes  where archived_at is null)::int as notes,
        (select count(*) from orbit.rules  where is_enabled)::int          as "rulesOn",
        (select count(*) from orbit.ai_feature_consents
          where is_enabled and revoked_at is null)::int                    as consents
    `;
    return row ?? { places: 0, notes: 0, rulesOn: 0, consents: 0 };
  });
}
