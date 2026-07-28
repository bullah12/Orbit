import 'server-only';
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
export async function listSpaces(userId: string): Promise<SpaceSummary[]> {
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
      from public.spaces s
      join public.space_members m
        on m.space_id = s.id and m.user_id = ${userId}::uuid and m.status = 'active'
      where s.archived_at is null
      order by s.is_default desc, s.name
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
