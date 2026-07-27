# Open questions before Phase 0

Ordered by how much the answer changes the work. Each has my recommendation; if you
don't answer, I'll build the recommendation and flag it.

---

## 1. What does "encryption at rest" actually mean to you? (biggest one)

You asked for encryption at rest on people notes and journal entries. There are two very
different things that phrase can mean and they produce different apps:

- **(a) End-to-end**: key derived on device, never leaves it. Supabase stores ciphertext
  and genuinely cannot read your journal. **Cost:** no server-side search on those items,
  no AI features on them, no server-generated brief that quotes them, and losing all your
  devices means losing the data permanently.
- **(b) Server-side at rest**: Postgres disk and backups are encrypted, plus column
  encryption on `notes.body_cipher` with a key in Supabase Vault. Protects against a
  stolen backup or a subpoena'd disk; does **not** protect against Supabase, or against
  someone with your service-role key.

The schema currently supports (a) for anything flagged locked/sensitive — those rows are
structurally excluded from the search index — and (b) for everything else.

**My recommendation:** (a) for `is_locked` items only, (b) for the rest. Nearly all the
protection you actually want, without a journal you can't search.

## 2. Is your partner going to use this?

Genuinely asked, not rhetorical. Assignment, chore rotation, merged calendar, mutual-free-
time and the activity digest all assume two engaged users. If they are realistically a
light participant, the shared space should be designed for **one power user and one
occasional viewer** — which means the shared surface is a small number of high-value
things (want-to-go list, joint events, a shared shopping-ish task list) and the rest stays
personal.

**My recommendation:** tell me honestly, because it changes what Phase 0's sharing UI
optimises for. If unsure, assume light participant — it's the cheaper mistake.

## 3. `free_busy` — is it real, or is it there for symmetry?

It costs a whole parallel read path (a separate view, its own tests, its own rendering
mode in every calendar view) and in a two-person household you either see each other's
calendars or you don't.

**My recommendation:** keep the role in the enum and the policies, don't build the UI
until a third space exists (siblings caring for a parent — your own example, and the case
where it genuinely earns its place).

## 4. Same-person linking across members — two records or one?

You said never auto-merge my partner's contacts into mine. I've modelled the explicit link
as `people.same_as_person_id`: **two records stay, permanently**, with shared facts
promoted to the shared space and both sets of notes untouched.

The alternative — collapsing to one record on link — is tidier but irreversible, and
"undo the merge" is a support nightmare you'd be building for yourself.

**Confirm:** two records, linked. This is what the schema does today.

## 5. Travel Mode auto-detection — background location?

"The app detects it from your location leaving the Birmingham home radius" needs
always-on background location. That's a hostile permission prompt, a real battery cost,
and it sits oddly beside "no live location sharing between members".

**My recommendation:** Phase 3 ships manual entry + calendar-derived detection (a flight,
train or hotel booking in your calendar). Add geofencing later only if you find yourself
wanting it. Significant-location-change API rather than continuous tracking if so.

## 6. Desktop — browser tab, or a real app?

React Native Web gives you a web app for free. A **global hotkey** and a proper share
target need a native shell (Tauri, most likely). That's a whole extra build target.

**My recommendation:** web app in Phase 0, Tauri wrapper in Phase 4 only if you find
yourself missing the hotkey. Mobile share sheet covers most capture in practice.

## 7. Email-in capture address — Phase 0 or later?

Needs an inbound mail provider (Postmark/SES), an address-per-user scheme, and spam
handling. It's maybe half a week for something the share sheet mostly covers.

**My recommendation:** defer to Phase 4. Say if you'd actually use it and I'll reconsider.

## 8. AI: off by default?

You said switchable off. I'd like to go further: **off by default, with an explicit
per-feature opt-in** and the settings page stating exactly which fields go to Anthropic
for each feature. Natural-language capture parsing is the one I'd argue should be
local-only regardless (the 40 lines of tokenising + `chrono-node`, no network).

## 9. iCloud calendar via CalDAV

Requires an Apple app-specific password, stored server-side. It's a long-lived credential
with broad account access and no granular scoping — meaningfully worse than Google's
OAuth. Phase 4 in the plan; flagging it now so the decision is yours rather than
discovered later.

## 10. Two things in the brief I think will hurt you

- **Post-event "add notes?" prompts.** ~6 a day. You asked for no guilt and no nagging;
  this is the feature most likely to become both. Building it passively (a quiet row on
  Today) instead — say if you want the push version.
- **`pgvector` semantic search in v1.** Locked/sensitive notes are excluded from
  server-side indexing by design, so semantic search would cover a silent subset of your
  notes. A search that quietly omits results is worse than no semantic search. Deferred;
  table kept.
