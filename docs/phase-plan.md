# Orbit — phase plan

Each phase ships to a state you would actually live with before the next starts.
"Out" means deliberately not built, not "forgotten".

---

## Phase 0 — Foundation

**Goal:** genuinely usable on its own as a private task + note app with sharing already
real. If Phase 0 is not something you'd use daily, nothing after it will save it.

**In**
- Auth: email magic link + passkeys; device list with remote sign-out.
- Full schema, `space_id` + `owner_id` on every table including junction tables.
- RLS via `app.apply_standard_rls()` on every table; the negative test suite
  (`supabase/tests/rls_isolation_test.sql`) green in CI.
- Spaces: personal auto-provisioned per user; create shared space; invite by email;
  accept; revoke; **leave-and-fork** (`app.leave_space`, `app.fork_space_to_personal`).
- The space indicator: persistent, unmissable, on every list row and every compose
  surface. Move-to-space with `app.space_move_preview()` naming exactly what becomes
  visible. Journal/locked/sensitive blocked from bulk moves.
- PowerSync engine + the **buckets-vs-RLS diff test**. Encrypted local SQLite.
- App shell: bottom nav (Today · Calendar · Tasks · People · Map) with the middle four
  stubbed, centre capture button.
- Universal quick capture (in-app + share sheet + desktop hotkey), parsing to Task or Note.
- Tags, `links` table, permission-filtered Connections panel, `@`/`[[ ]]`/`#` inline linking.
- Command palette (Cmd/Ctrl+K; mobile search bar) across all entity types + actions.
- **Tasks, complete**: all 11 smart lists, assignment with separate requester/assignee,
  reminders to assignee only, Waiting On, subtasks, both recurrence modes, chore rotation,
  contexts, saved filters, natural-language entry.
- **Notes**: markdown editor, backlinks, daily notes, templates.

**Out (deliberately):** per-item `shares` **UI** (table and policies exist), Yjs editing
(columns exist), activity digest, calendar, people, map, AI, import.

---

## Phase 1 — Calendar

**In:** Google + `.ics` read-only sync via Edge Functions; `calendars`/`events`/
`event_occurrences` populated with recurrence expanded server-side; categories with colour
**and** icon **and** label; the rules engine with visible/editable rules and manual
override that sticks; day/3-day/week/month/agenda views; merged household view
(avatar/edge-stripe, never colour); `free_busy` rendering as anonymous blocks from
`app.busy_blocks`; "when are we both free?" with one-tap joint event; conflict and
back-to-back detection; prep/travel buffers; Today dashboard (Now & Next, today's tasks,
quick capture); morning brief notification; time-blocking drag from Tasks.

**Out:** write-back, Outlook, CalDAV, travel-time API integration (buffers are per-category
constants until Phase 3 gives us real distances), post-event capture *prompts* — the
passive "N events yesterday, no notes" row on Today instead.

**Test focus:** the rules engine. Table-driven fixtures: rule priority, override
persistence across re-sync, and re-categorisation on rule edit.

---

## Phase 2 — People

**In:** profiles with all basics and structured fields; the shared-facts / private-notes
split working end to end (shared `people`, personal `person_state`); multiple geocoded
addresses with approximate toggle; interaction timeline (auto from events + notes, plus
manual); per-member cadence and last-contacted with `next_nudge_at`; talking points;
pre-meeting brief; person-to-person relations with a mini network tree; manual groups then
smart groups; contact import (Google, CardDAV, `.vcf`, CSV) with mapping preview;
duplicate detection and merge; explicit "same as" linking across members that promotes
shared facts and touches neither set of notes; biometric lock on sensitive items;
People nudges section on Today.

**Out:** message/email ingestion (permanently), household-level cadence figure (Phase 3,
once there is enough data for it to mean anything).

---

## Phase 3 — Places and map

**In:** places as entities with recommender and want-to-go; geocoding; MapLibre +
Protomaps with clustering and a synced list; pin filters and overdue-heat colouring;
Near Me with distance × overdueness ranking; **Travel Mode** personal and household,
triggered manually, from a calendar event, or by leaving the home radius; suggested plan
grouped geographically; one-tap message draft; shared want-to-go list; home base with
cached rail/car times.

**Out:** live location sharing between members — **permanently, by design**. No "who
viewed what" tracking, same reason.

---

## Phase 4 — Depth

Note imports (Markdown/Obsidian → Apple Notes → Keep → Notion → Evernote, in that order,
each with preview + mapping + full revert via `import_batches`); two-way calendar
write-back; Outlook + CalDAV; the AI layer (all switchable off, with a plain-English
statement of what leaves the device); graph view; widgets; weekly review; voice notes;
per-item sharing UI; Yjs collaborative editing + presence; shared-space activity digest
(batched, opt-in, off by default).

---

## Cross-cutting, from Phase 0 onward

- UK conventions: Europe/London with DST-correct recurrence, Monday week start,
  DD/MM/YYYY, 24h option, GBP, metric with miles for road distance.
- Accessibility: dynamic type, colour-blind-safe palette, icon + label beside every
  colour, full keyboard nav on web.
- Performance budgets enforced in CI: cold start < 2s, search < 200ms at 10k items,
  map 60fps at 500 pins.
- GDPR: `app.erase_person()`, `app.export_space()` → JSON + Markdown + `.ics` + `.vcf`,
  no third-party analytics touching personal content.
