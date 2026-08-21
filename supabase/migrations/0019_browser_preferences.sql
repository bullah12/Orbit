-- 0019_browser_preferences.sql — small cross-device browser preferences.
-- Existing locale and week_starts_on remain unchanged.

alter table orbit.profiles
  add column theme text not null default 'system'
    check (theme in ('system', 'light', 'dark')),
  add column default_space_id uuid null
    references orbit.spaces(id) on delete set null;

comment on column orbit.profiles.theme is
  'Preferred colour scheme across devices: system, light, or dark.';

comment on column orbit.profiles.default_space_id is
  'Preferred compose space. Null falls back to the first readable default space.';
