import 'server-only';
import { cache } from 'react';
import { asUser } from '@/lib/db';
import type { SpaceRef } from '@/components/SpaceIndicator';

export type SpaceSummary = SpaceRef & {
  kind: string;
  role: string;
  /** false for free_busy participants: they see the space, never its content. */
  canRead: boolean;
  canWrite: boolean;
};

/**
 * Every space the user can see. Note there is no `where user_id = ...` here —
 * the policy on `spaces` already restricts this to the caller's memberships.
 * Adding a filter would hide the fact that the policy is what protects it.
 */
export const listSpaces = cache(_listSpaces);

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
        (m.role in ('owner','admin','member')) as "canWrite"
      from orbit.spaces s
      join orbit.space_members m
        on m.space_id = s.id and m.user_id = ${userId}::uuid and m.status = 'active'
      where s.archived_at is null
      order by s.is_default desc, s.name
    `;
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
