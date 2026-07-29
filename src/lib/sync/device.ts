import 'server-only';
import { cookies } from 'next/headers';

/**
 * Which device this browser is.
 *
 * Rough edge since Phase 6: the outbox lives in `localStorage`, which is scoped
 * to a browser profile, while every cursor on `/sync` belongs to a row in
 * `devices`. The two halves of that page described two different things and the
 * page did not say so — "this device's queue" above "how far Priya — laptop has
 * caught up", with nothing connecting them and no reason to believe they were the
 * same device.
 *
 * The connection is a **cookie**, deliberately, not a value in `localStorage`:
 * `/sync` is a server component, and a label the server cannot read cannot be
 * used to pick the right device row. A cookie has exactly the scope the queue has
 * — one browser profile, surviving a reload — so the two now agree by
 * construction rather than by hope.
 *
 * It holds a *label*, not an id, because `devices` is keyed
 * `(space_id, owner_id, label)`: one physical browser is one row per space, which
 * is what a space-scoped cursor requires. The label is therefore the only thing
 * that identifies a browser across its rows.
 *
 * Unsigned, like `orbit_user`. It names a device, not a permission — every write
 * still goes through `asUser` and the policies decide, so the worst a forged
 * value can do is claim a device row in a space its owner can already write to.
 */

import { normaliseDeviceLabel } from './outbox';

const DEVICE_COOKIE = 'orbit_device';

export async function thisDeviceLabel(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(DEVICE_COOKIE)?.value;
  if (!raw) return null;
  const label = normaliseDeviceLabel(raw);
  return label === '' ? null : label;
}

export async function setThisDeviceLabel(label: string): Promise<void> {
  const jar = await cookies();
  jar.set(DEVICE_COOKIE, label, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
}

export const DEVICE_COOKIE_NAME = DEVICE_COOKIE;
