import 'server-only';
import { cache } from 'react';
import { asUser } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import type { SpaceRef } from '@/components/SpaceIndicator';

export type SpaceSummary = SpaceRef & {
  kind: string;
  role: string;
  /** false for free_busy participants: they see the space, never its content. */
  canRead: boolean;
  canWrite: boolean;
  /**
   * Cannot be deleted, by anybody, through any path — the space that guarantees
   * there is always somewhere to write. Renaming it is ordinary. See
   * `0015_default_spaces.sql`.
   */
  isProtected: boolean;
};

/**
 * Every space the user can see. Note there is no `where user_id = ...` here —
 * the policy on `spaces` already restricts this to the caller's memberships.
 * Adding a filter would hide the fact that the policy is what protects it.
 */
export const listSpaces = cache(_listSpacesProvisioning);

/**
 * The list, and the one place that guarantees it is never empty.
 *
 * Signing up creates Personal and Work in the same transaction as the profile
 * (migration 0015), so this covers the two cases a trigger on `auth.users`
 * cannot reach: an account that predates the migration, and the dev provider,
 * which has no `auth.users` row to fire a trigger on.
 *
 * It lives here rather than in the layout because of `cache()`. The layout is
 * not the only thing that reads this list — every page and several server
 * actions do — and they share one memoised result per request. Provisioning in
 * the layout would leave that memo holding the empty array it read a moment
 * before the write, so the sidebar would show two spaces and the page beneath
 * it would still say there were none. Doing it inside the cached function means
 * every caller in the request sees the same, correct, list.
 *
 * The cost in the ordinary case is nothing: a non-empty list returns
 * immediately, and the extra round trip only happens for an account that has no
 * spaces at all, which is true at most once per account.
 */
async function _listSpacesProvisioning(userId: string): Promise<SpaceSummary[]> {
  const spaces = await _listSpaces(userId);
  if (spaces.length > 0) return spaces;

  const made = await ensureDefaultSpaces(userId);
  return made > 0 ? _listSpaces(userId) : spaces;
}

async function _listSpaces(userId: string): Promise<SpaceSummary[]> {
  return asUser(userId, async (tx) => {
    return tx<SpaceSummary[]>`
      select
        s.id,
        s.name,
        s.short_label as "shortLabel",
        s.colour,
        s.icon,
        s.kind::text,
        m.role::text                          as role,
        (m.role <> 'free_busy')                as "canRead",
        (m.role in ('owner','admin','member')) as "canWrite",
        s.protected                            as "isProtected"
      from orbit.spaces s
      join orbit.space_members m
        on m.space_id = s.id and m.user_id = ${userId}::uuid and m.status = 'active'
      where s.archived_at is null
      order by s.is_default desc, s.name
    `;
  });
}

/**
 * Make an account whole: a profile if it has none, then Personal and Work.
 *
 * A no-op for anybody already in a space, so it is safe to call on every render
 * where the list came back empty — which is the only time it is called. What an
 * account gets is decided in `0015_default_spaces.sql`; adopting one that has no
 * profile at all is `0016_adopt_existing_accounts.sql`.
 *
 * Three states reach this, and the sign-up trigger covers none of them: an
 * account created in Supabase Auth before Orbit's migrations were applied, an
 * account that predates 0015, and the dev provider, which has no `auth.users`
 * row for a trigger to fire on.
 *
 * Returns how many spaces were made.
 */
export async function ensureDefaultSpaces(userId: string): Promise<number> {
  try {
    // The account may have no profile either — Supabase Auth exists before
    // Orbit's migrations are applied to it, so people are already signed up
    // when the schema arrives and no trigger ever fired for them. The database
    // will not take an email as an argument (it would be a way to claim
    // somebody else's invitations), so the verified session's address is passed
    // as a JWT claim instead, which is where it would come from if the caller
    // were PostgREST. See supabase/migrations/0016.
    //
    // Asked for only on this path, which runs at most once per account: it can
    // cost a round trip to the auth provider, and every other reader of this
    // list needs nothing but the id.
    const session = await getCurrentUser().catch(() => null);
    const identity =
      session && session.id === userId
        ? { email: session.email, displayName: session.displayName }
        : undefined;

    const rows = await asUser(
      userId,
      async (tx) => tx<{ made: number }[]>`select app.ensure_default_spaces() as made`,
      identity,
    );
    return rows[0]?.made ?? 0;
  } catch {
    // Not fatal. The pages below render an account with no spaces perfectly
    // well, and "Orbit can't reach its database" would be a lie about a
    // database that just answered a query. The one case that lands here and
    // deserves words is a duplicate email address, which the space form
    // reports when somebody tries to make one by hand.
    return 0;
  }
}

/**
 * Rename a space.
 *
 * Allowed on every space including the protected one — "cannot be deleted" is
 * not "cannot be changed", and a space called Personal that somebody would
 * rather call by their own name is theirs to rename. `spaces_update` already
 * says who may: an admin of that space.
 *
 * Name and short label only. The colour and icon come from the kind and there
 * is nowhere yet that offers them; when there is, it belongs in this function
 * rather than in a second one.
 */
export async function renameSpace(
  userId: string,
  spaceId: string,
  name: string,
  shortLabel: string,
): Promise<{ ok: true } | { error: string }> {
  const trimmed = name.trim().slice(0, 80);
  const label = shortLabel.trim().slice(0, 12);
  if (!trimmed) return { error: 'A space needs a name.' };
  if (!label) return { error: 'A space needs a short label for its indicator.' };

  const rows = await asUser(userId, async (tx) => {
    return tx<{ id: string }[]>`
      update orbit.spaces
      set name = ${trimmed}, short_label = ${label}
      where id = ${spaceId}::uuid
      returning id
    `;
  });
  return rows[0]
    ? { ok: true }
    : { error: 'That space was not renamed. Only an admin of a space can rename it.' };
}

/**
 * Delete a space and everything in it.
 *
 * Every `space_id` in the schema is `on delete cascade`, so this is not a
 * tidying-up operation: the tasks, notes, events, people and places in it go
 * with it, which is why the screen counts them first and makes you type the
 * name. The protected space refuses — by policy, so this matches no row, and by
 * trigger underneath, so it would refuse even if the policy were wrong.
 */
export async function deleteSpace(
  userId: string,
  spaceId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const rows = await asUser(userId, async (tx) => {
      return tx<{ id: string }[]>`
        delete from orbit.spaces where id = ${spaceId}::uuid returning id
      `;
    });
    return rows[0]
      ? { ok: true }
      : {
          error:
            'That space was not deleted. Either it cannot be — the one that guarantees ' +
            'you have somewhere to write never can — or you are not its owner.',
        };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'That space was not deleted.' };
  }
}

/**
 * What deleting a space would take with it.
 *
 * The same argument as `previewMove`: the confirmation has to say what is
 * actually at stake, and "everything in it" is not a number somebody can weigh.
 * Counted through `asUser`, so it counts what the caller can see.
 */
export type SpaceContents = {
  tasks: number;
  notes: number;
  events: number;
  people: number;
  places: number;
  members: number;
};

export async function spaceContents(
  userId: string,
  spaceId: string,
): Promise<SpaceContents> {
  return asUser(userId, async (tx) => {
    const [row] = await tx<SpaceContents[]>`
      select
        (select count(*) from orbit.tasks  t where t.space_id = ${spaceId}::uuid)::int as tasks,
        (select count(*) from orbit.notes  n where n.space_id = ${spaceId}::uuid)::int as notes,
        (select count(*) from orbit.events e where e.space_id = ${spaceId}::uuid)::int as events,
        (select count(*) from orbit.people p where p.space_id = ${spaceId}::uuid)::int as people,
        (select count(*) from orbit.places l where l.space_id = ${spaceId}::uuid)::int as places,
        (select count(*) from orbit.space_members m
          where m.space_id = ${spaceId}::uuid and m.status = 'active')::int as members
    `;
    return row ?? { tasks: 0, notes: 0, events: 0, people: 0, places: 0, members: 0 };
  });
}

/** What a new space is called and how its indicator looks. */
export type NewSpace = {
  name: string;
  shortLabel?: string;
  kind?: string;
  colour?: string;
  icon?: string;
};

/**
 * Create a space, with the caller as its owner.
 *
 * Through `app.create_space()` rather than two inserts, because the second of
 * those two inserts is refused: `space_members_insert` asks whether you are an
 * admin of the space, and a space one statement old has no members to be an
 * admin of. Migration 0014 has the whole argument. It still runs under
 * `asUser`, so the function sees the caller's `auth.uid()` and can create a
 * space for nobody else.
 */
export async function createSpace(
  userId: string,
  space: NewSpace,
): Promise<{ id: string } | { error: string }> {
  try {
    const rows = await asUser(userId, async (tx) => {
      return tx<{ id: string }[]>`
        select app.create_space(
          ${space.name},
          ${space.shortLabel ?? null},
          ${space.kind ?? 'personal'},
          ${space.colour ?? 'slate'},
          ${space.icon ?? 'circle'}
        ) as id
      `;
    });
    return rows[0] ?? { error: 'That space was not created.' };
  } catch (err) {
    // The function raises with a sentence meant for a person — "A space needs a
    // name.", "Unknown space kind blue." — so it is carried through rather than
    // replaced with a generic failure.
    return { error: err instanceof Error ? err.message : 'That space was not created.' };
  }
}

export type SpaceMember = {
  id: string;
  displayName: string;
  role: string;
};

/**
 * Members of a space who can hold an assignment. free_busy participants are
 * excluded: they cannot see the item, so assigning one a task would create a
 * task nobody can act on.
 */
export const listSpaceMembers = cache(_listSpaceMembers);

async function _listSpaceMembers(userId: string, spaceId: string): Promise<SpaceMember[]> {
  return asUser(userId, async (tx) => {
    return tx<SpaceMember[]>`
      select p.id, p.display_name as "displayName", m.role::text as role
      from orbit.space_members m
      join orbit.profiles p on p.id = m.user_id
      where m.space_id = ${spaceId}::uuid
        and m.status = 'active'
        and m.role in ('owner','admin','member')
      order by p.display_name
    `;
  });
}

export type MovePreviewRow = {
  change: 'gains' | 'loses' | 'keeps';
  profileId: string;
  displayName: string;
  role: string;
  reason: string;
};

/**
 * Who gains and who loses access if this item moves. Every move confirmation
 * calls this first — it is not an optional nicety, it is the thing that makes a
 * move safe to agree to.
 */
export async function previewMove(
  userId: string,
  entityKind: 'task' | 'note' | 'person' | 'event' | 'place',
  entityId: string,
  targetSpaceId: string,
): Promise<MovePreviewRow[]> {
  return asUser(userId, async (tx) => {
    return tx<MovePreviewRow[]>`
      select
        change,
        profile_id   as "profileId",
        display_name as "displayName",
        role::text   as role,
        reason
      from app.space_move_preview(
        ${entityKind}::app.entity_kind, ${entityId}::uuid, ${targetSpaceId}::uuid
      )
    `;
  });
}
