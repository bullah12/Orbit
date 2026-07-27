# ADR 0001 — Orbit architecture

**Status:** proposed, awaiting confirmation
**Date:** 2026-07-27
**Context:** personal life OS for two users (Birmingham, UK), local-first, spaces-based sharing

---

## Decision summary

| Area | Decision | One-line reason |
|---|---|---|
| Client | TypeScript · Expo + React Native Web · NativeWind | One codebase, four targets, and the map/offline story is the only real risk — mitigated below |
| Backend | Supabase (Postgres 15+, Auth, Storage, Realtime) + PostGIS | RLS in Postgres is the only place the access-control requirement can honestly live |
| Local-first | PowerSync over SQLite | Only mature option with an **offline write** queue for RN; Electric's write path still goes through your API |
| Notes | body markdown + Yjs CRDT for shared long-form | Soft locking cannot work offline, and offline is a hard requirement |
| Structured data | Row-level last-write-wins, tables kept narrow | Field-level LWW's benefit is mostly achieved by narrow tables, at a fraction of the metadata cost |
| Maps | MapLibre GL + Protomaps (self-hosted `.pmtiles`) | Free, offline-capable tiles; geocoding via Nominatim, Mapbox only if quality forces it |
| AI | Claude via Supabase Edge Function | Key never on device; one auditable egress point |

I am accepting your stack with **two changes and one warning**, all below.

---

## (a) Offline sync

**Decision: PowerSync + SQLite, with the schema shaped for it from migration one.**

Why not "SQLite + a sync queue, swap later": the swap never happens cheaply, because the
things a sync engine needs — stable ids generated client-side, soft deletes with
tombstones, monotonic `updated_at`, no server-side autoincrement in the sync path — are
schema decisions, not library decisions. The migrations here already do all four:
`uuid` PKs with client-side generation, `deleted_at` everywhere, `updated_at` maintained
by trigger, and no `serial` on any synced table (`note_updates` is append-only and
deliberately server-ordered).

Why PowerSync over ElectricSQL: Electric 1.0 is a read-path replication engine — writes
go back through your own API, which means an offline write queue is *your* problem.
That is the exact problem I do not want to write twice. PowerSync ships a bidirectional
queue with upload retries and RN/Expo bindings, and its "sync rules" partition data into
buckets that map cleanly onto spaces.

**The warning, and it is the biggest risk in this document.** PowerSync sync rules are a
*second* place visibility logic lives. Your brief says "the client is never the arbiter of
visibility" — RLS guarantees that for the API, but the sync engine replicates rows into a
local SQLite file on the device, and it decides what to replicate using its own rule
language, not your RLS policies. If the two ever disagree, private rows land on your
partner's phone even though the API would have refused them.

Mitigations, all of which are in scope for Phase 0:

1. Sync rules are **generated** from one source of truth — buckets are defined solely as
   "space_id ∈ my active memberships", the same predicate as `app.readable_space_ids()`.
   No rule may reference any other column.
2. A CI test that, for a fixture dataset, diffs *rows in each user's PowerSync buckets*
   against *rows visible to that user's JWT through PostgREST*. Any asymmetry fails the
   build. This is the single most valuable test in the project.
3. Local SQLite is encrypted (SQLCipher key in Keychain/Keystore), so "we share an iPad"
   degrades to "we share a login", not "everything is readable".

Consequence to accept: **two people on one device is not a supported privacy boundary.**
Spaces protect you from each other's accounts, not from each other's hands on your
unlocked phone. Biometric lock on sensitive items is the only mitigation, and it is
UI-level.

---

## (b) Calendar sync auth

**Decision: OAuth entirely server-side; the device never holds a refresh token.**

- Authorisation code + PKCE initiated from the app via `expo-auth-session`, but the
  redirect lands on a **Supabase Edge Function**, not the app. The function performs the
  code exchange (it holds the client secret), writes the refresh token into **Supabase
  Vault**, and stores only `vault_secret_id` in `integration_credentials`.
- `integration_credentials` has RLS enabled and **zero policies**. `authenticated` has no
  grant on it. Only `service_role` — which bypasses RLS — can read it. A fully
  compromised client JWT yields no calendar access beyond what is already synced.
- Sync runs as a scheduled Edge Function per integration: Google via incremental
  `syncToken`, Microsoft Graph via delta queries, CalDAV via `tsdav` ETags, `.ics` via
  conditional GET on `ETag`/`Last-Modified`. All write into `calendars`/`events` under
  `service_role`, stamping the correct `space_id` from `integrations.space_id`.
- **Read-only in v1** is the right call and I would keep it through Phase 3. Two-way
  write-back means owning conflict resolution against a system you do not control, and
  the failure mode (deleting someone else's meeting) is unpleasant.

Scopes requested are the minimum: `calendar.readonly`, `contacts.readonly`. Not `gmail.*`
— your instinct to leave email out is correct and I would not revisit it.

---

## (c) Space isolation and RLS

**Decision: visibility is a pure function of `space_id` and space membership. Nothing else.**

Four `STABLE SECURITY DEFINER` helpers return `uuid[]` of the caller's spaces at a given
role (`readable_space_ids()`, `writable_space_ids()`, `owned_space_ids()`,
`member_space_ids()`). Every policy is the same shape:

```sql
space_id = any(app.readable_space_ids()) or app.has_share('note', id, 'view')
```

Three deliberate choices inside that:

1. **`= any(array)` not `is_member(space_id)`.** A no-argument STABLE function is hoisted
   into an InitPlan and evaluated *once per statement*; a function taking the row's
   `space_id` is evaluated *once per row*. At 10,000 rows that is the difference between
   your 200ms search target and missing it by an order of magnitude.
2. **`SECURITY DEFINER` breaks the recursion** that a policy on `space_members` querying
   `space_members` would otherwise cause. `search_path` is pinned on all of them.
3. **`owner_id` appears in no read policy.** If it did, you could still read rows after
   leaving a space, because you created them. Leaving must revoke; revocation is a
   membership fact, not an ownership fact.

Policies are applied by one function, `app.apply_standard_rls()`, so every table gets a
byte-identical policy. There is exactly one place this can be wrong.

**The link-leak problem, which is the requirement you said you care about most.**
A link joins two entities that may live in different spaces. Checking the far endpoint
with a function per link row is both slow and easy to get wrong. Instead, `links`
denormalises `source_space_id` and `target_space_id`, maintained exclusively by a
`SECURITY DEFINER` trigger that **overwrites whatever the client sent**. Visibility is
then a pure column predicate:

```sql
source_space_id = any(readable) and target_space_id = any(readable)
```

The row does not exist for anyone who cannot see both ends — which makes counts,
aggregates, joins and `EXISTS` probes safe for free, rather than each needing its own
defence. `taggings`, `group_members` and `event_attendees` use the same trick, because a
tag list or a group roster leaks existence exactly as readily as a link does.

Insert-time probing is closed too: linking to an invisible entity and linking to a
non-existent one raise the **same error**, so the error text is not an existence oracle.
There is a test for precisely that.

**`free_busy` deserves a note**, because it is the one requirement RLS cannot express.
RLS is row-level; it cannot hide the `title` column. So `free_busy` members are excluded
from `events` **entirely** and read `app.busy_blocks`, a `security_invoker = off` view
that selects only `space_id`, `start_at`, `end_at`. There is no column in it that could
carry content. A test asserts the view has no `title` column.

**The shared-facts / private-notes split is structural, not a flag.** `people` and
`person_fields` live in whatever space the record is in; `person_state`, `interactions`
and `talking_points` are forced by trigger into the member's *personal* space. So the
ordinary policy already hides them — no special case, no second rule to get wrong. Each
member gets their own `person_state` row, hence their own cadence and last-contacted,
which is what you asked for. Moving a person to shared moves their facts and pointedly
does *not* move `person_state`.

---

## (d) Concurrent editing of shared notes

**Decision: Yjs. Not presence + soft locking.**

The argument is short and I think decisive: **soft locking cannot work offline.** You
required the app to be fully usable on a train with no signal. A lock is a claim on a
shared resource; you cannot acquire one without a coordinator. So a locking design must
either block editing offline (violating the core requirement) or allow offline edits and
then reconcile them anyway (in which case you have built a merge system, badly, on top of
a lock).

Yjs also degrades better in the actual two-person case. The realistic conflict is not
simultaneous typing; it is you editing a shared trip note on a train while your partner
edits it at home, and both syncing at 18:40. Locking resolves that by discarding
someone's work or forcing a manual merge. Yjs resolves it correctly with no UI at all.

Implementation:
- `notes.yjs_state` holds the compacted document; `note_updates` is an append-only log of
  binary Yjs updates. Offline clients append on reconnect; a compaction job folds the log
  back into `yjs_state`.
- `notes.body_md` is a **derived** materialisation, written by the same job. Search,
  export, backlink extraction and every read path use `body_md` and never touch the CRDT.
- Presence (who else is in this note) rides on Supabase Realtime and is cosmetic.

Scope honesty: this is Phase 4 work per your own plan. What Phase 0 must ship is the
*schema* — `yjs_state`, `note_updates` — so that turning it on later is not a migration
of every note body. Until then, notes are row-level LWW like everything else.

**Structured data stays row-level LWW, not field-level.** Field-level LWW needs a
timestamp per column, which is real storage and real complexity. Most of its benefit
comes from tables being narrow enough that a whole-row overwrite rarely destroys
unrelated work — so I have kept them narrow (`person_state` split out from `people`,
`task_contexts` split out from `tasks`, `person_fields` as rows not columns). Where that
is not enough, the fix is another table, not another timestamp. The two exceptions that
genuinely need better merging are note bodies (Yjs, above) and `tasks.completed_at`,
where the rule is "completion wins over un-completion", implemented as a trigger rather
than as LWW.

---

## Stack: my two changes to your proposal

**1. Protomaps instead of raw OSM tile servers, and MapLibre stays.**
Your 500-pins-at-60fps target and your offline requirement are the same requirement: you
cannot hit either against a remote raster tile service. Self-hosted `.pmtiles` on Supabase
Storage gives you a single static file per region, cacheable on device, no per-request
cost, and MapLibre renders it natively. Geocoding via Nominatim (rate-limited, fine for a
two-user app, must be self-hosted or politely used); switch to Mapbox geocoding only if UK
address quality disappoints — that is a settings change, not an architecture change.

**2. `chrono-node` is not enough for `!high @phone` and I would not extend it.**
Use `chrono-node` for the *date* substring only, and hand-write the ~40 lines that strip
`@context`, `!priority`, `#tag`, `@Person` and `[[note]]` tokens first. Natural-language
capture that silently mis-parses is worse than one that asks — every parse produces an
editable confirmation, always.

**Not changing:** Expo/RNW, Supabase, NativeWind, `tsdav`, `ical.js`, FTS5/tsvector,
Edge-Function-only AI, Expo Notifications. All correct choices for this.

---

## What I would cut

Three things in the brief will cost more than they return, and one is a trap.

1. **Semantic search (`pgvector`) in v1 — cut.** Locked and sensitive notes are excluded
   from server-side indexing by design, so semantic search covers a *subset* of your
   notes, and a search that silently omits results is worse than no search. FTS5 + trigram
   gets you a long way. Keep the `note_embeddings` table; leave it empty until Phase 4.
2. **The global graph view — cut to Phase 4, and expect to cut it entirely.** You called
   it "a browsing surface, not a gimmick". In two-user datasets under ~5k entities it is
   almost always a gimmick; the Connections panel is the feature that earns its keep. Keep
   it cheap and see whether you ever open it.
3. **Voice notes with transcription — Phase 4, and treat as optional.** On-device
   transcription quality on Android is poor enough that you will end up sending audio to a
   server, which contradicts "state plainly what data leaves the device" in a way that
   makes the setting long and the feature uncomfortable.

**The trap: post-event capture prompts.** "When an event ends, prompt for notes" fires
~6 times a day. You explicitly asked for no guilt and no nagging, and this is the feature
most likely to become both. I would build it as a *passive* affordance — the Today screen
shows "3 events yesterday, no notes" as a quiet row you can act on — rather than a push
notification. Same for cadence nudges: one place, once, never a badge count.

---

## Consequences

- Adding an entity type means: a value in the `entity_type` enum, a branch in
  `app.entity_space()`, a `propagate_space_change` trigger, and a row in
  `app_cloneable_tables`. A test asserts all four exist for every enum value.
- Any new table must be added to `20260101000800_rls.sql`. A test asserts no table in
  `public` has RLS disabled — this is how the uniform policy stays uniform.
- **Every unique constraint must lead with `space_id`.** Found the hard way: forking a
  space clones rows before their foreign keys are rewritten, so any uniqueness not scoped
  to the space collides the copy with the original. It is also the correct semantics
  independently — two spaces may legitimately hold the same tag name or the same imported
  calendar event.
- **Graph edges are cloned only when both endpoints are inside the space being forked.**
  A link from a shared event to the *other* member's private note lives in the shared
  space, and copying it would hand the leaver an edge pointing at a row they must never
  see. Nullable references that escape the fork are severed, not left dangling.
- Sync rules and RLS must be diffed in CI on every change to either.
