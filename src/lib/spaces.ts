/**
 * What a new space looks like before anybody edits it.
 *
 * Pure, so the create form and the server action agree by construction rather
 * than by both remembering. The form posts a kind and nothing else about the
 * indicator: asking somebody to choose a colour and an icon before they have
 * created their first space is three decisions where there was one, and every
 * one of them is changeable afterwards.
 *
 * The four kinds are exactly `app.space_kind`. If that enum gains a member,
 * this list is what stops the interface quietly not offering it.
 */

export type SpaceKind = 'personal' | 'household' | 'work' | 'project';

export type SpaceKindPreset = {
  kind: SpaceKind;
  /** What it is called on the create form, in the words somebody would use. */
  label: string;
  colour: string;
  icon: string;
};

export const SPACE_KINDS: readonly SpaceKindPreset[] = [
  { kind: 'personal', label: 'Just me', colour: 'indigo', icon: 'user' },
  { kind: 'household', label: 'Household', colour: 'emerald', icon: 'house' },
  { kind: 'work', label: 'Work', colour: 'sky', icon: 'briefcase' },
  { kind: 'project', label: 'Project', colour: 'violet', icon: 'sprout' },
] as const;

export function isSpaceKind(value: string): value is SpaceKind {
  return SPACE_KINDS.some((k) => k.kind === value);
}

/** The preset for a kind, falling back to `personal` for anything unrecognised. */
export function spaceKindPreset(value: string): SpaceKindPreset {
  return SPACE_KINDS.find((k) => k.kind === value) ?? SPACE_KINDS[0];
}

/**
 * The chip label for a name.
 *
 * `spaces_short_label_len` is 1..12 and the indicator renders it on every row,
 * so this trims rather than refuses — but it trims at a word boundary where it
 * can, because "Weekend co" reads as a mistake and "Weekend" does not.
 */
export function shortLabelFrom(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 12) return trimmed;

  const cut = trimmed.slice(0, 12);
  const space = cut.lastIndexOf(' ');
  return space >= 4 ? cut.slice(0, space) : cut.trimEnd();
}
