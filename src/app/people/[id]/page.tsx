import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import {
  getPerson,
  listLinkCandidates,
  type LinkCandidate,
  type PersonContact,
  type PersonDate,
  type PersonLink,
  type PersonRow,
} from '@/lib/queries/people';
import { listCategories, type CategoryOption } from '@/lib/queries/tasks';
import { listSpaces, previewMove, type SpaceSummary } from '@/lib/queries/spaces';
import { listPlaces, type PlaceRow } from '@/lib/queries/places';
import {
  addPersonContact,
  addPersonDate,
  archivePerson,
  linkPeople,
  movePersonToSpace,
  removePersonContact,
  removePersonDate,
  unlinkPeople,
  updatePerson,
} from '@/app/actions';
import { SpaceIndicator, CategoryChip } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

const CONTACT_ICON: Record<string, string> = {
  phone: 'phone',
  mobile: 'phone',
  email: 'mail',
  address: 'house',
};

const CONTACT_KINDS = ['mobile', 'phone', 'email', 'address', 'other'] as const;
const DATE_KINDS = ['birthday', 'anniversary', 'other'] as const;

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ moveTo?: string }>;
}) {
  const { id } = await params;
  const { moveTo } = await searchParams;

  const user = await requireUser();
  const result = await getPerson(user.id, id);
  if (!result) notFound();
  const { person, contacts, dates, links, mentions } = result;

  const [categories, spaces, candidates, places] = await Promise.all([
    listCategories(user.id, person.space.id),
    listSpaces(user.id),
    person.isLocked ? Promise.resolve([]) : listLinkCandidates(user.id, person.id),
    // Only this person's own space: the home place has to live where they do,
    // and `updatePerson` re-checks that independently of what is offered here.
    listPlaces(user.id, { spaceId: person.space.id }),
  ]);

  const targets = spaces.filter((s) => s.canWrite && s.id !== person.space.id);
  const target = targets.find((s) => s.id === moveTo);
  const preview = target ? await previewMove(user.id, 'person', person.id, target.id) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Link href="/people" className="faint text-xs">
            People
          </Link>
          <span className="faint text-xs" aria-hidden="true">
            /
          </span>
          <SpaceIndicator space={person.space} />
          <CategoryChip category={person.category} />
        </div>
        <h1 className="text-xl font-semibold">
          {person.isLocked ? <em className="muted">Locked person</em> : person.displayName}
        </h1>
        {(person.nickname || person.pronouns) && (
          <p className="faint mt-0.5 text-xs">
            {[person.nickname && `“${person.nickname}”`, person.pronouns]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </header>

      {/*
        The linked-record panel comes first because it is the thing most easily
        misread: these are two records that both exist, not one record shown
        twice, and nothing here will ever collapse them.
      */}
      <LinkSection person={person} links={links} candidates={candidates} />

      {person.isLocked ? (
        <div className="muted flex items-center gap-2 px-5 py-10 text-sm">
          <Icon name="lock" size={14} />
          This record is locked. It is end-to-end encrypted and can only be opened on a
          device holding the key — the server has never seen its contents.
        </div>
      ) : (
        <>
          <EditForm person={person} categories={categories} places={places} />
          <ContactsSection person={person} contacts={contacts} />
          <DatesSection person={person} dates={dates} />
        </>
      )}

      {!person.isLocked && person.notesMd.trim() !== '' && (
        <section className="hairline border-b px-5 py-4">
          <h2 className="faint mb-2 text-2xs font-semibold uppercase tracking-wider">
            Notes, rendered
          </h2>
          <Markdown source={person.notesMd} />
        </section>
      )}

      <section className="hairline border-b px-5 py-4">
        <h2 className="faint mb-2 text-2xs font-semibold uppercase tracking-wider">
          Mentioned in
        </h2>
        {mentions.length === 0 ? (
          <p className="faint text-xs">Nothing links to this person yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {mentions.map((m) => (
              <li key={`${m.kind}-${m.id}`} className="flex items-baseline gap-2 text-sm">
                <Icon
                  name={m.kind === 'note' ? 'note' : 'calendar'}
                  size={11}
                  className="faint shrink-0"
                />
                {m.kind === 'note' ? (
                  <Link href={`/notes/${m.id}` as never} className="underline underline-offset-2">
                    {m.label}
                  </Link>
                ) : (
                  <span>{m.label}</span>
                )}
                {m.at && (
                  <span className="faint ml-auto shrink-0 text-2xs">
                    {m.kind === 'event' ? formatDateTime(m.at) : formatRelative(m.at)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <MoveSection person={person} targets={targets} target={target} preview={preview ?? []} />

      <section className="hairline border-t px-5 py-4">
        <form action={archivePerson} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="personId" value={person.id} />
          <button
            type="submit"
            className="hairline rounded border px-3 py-1.5 text-xs font-medium"
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon name="archive" size={12} />
              Archive this person
            </span>
          </button>
          <span className="faint text-xs">
            They stop appearing in lists. Their links, notes and events are left alone.
          </span>
        </form>
      </section>
    </div>
  );
}

function LinkSection({
  person,
  links,
  candidates,
}: {
  person: PersonRow;
  links: PersonLink[];
  candidates: LinkCandidate[];
}) {
  // A same-name candidate in another space is almost always the intended one.
  const sameName = candidates.filter(
    (c) => c.displayName === person.displayName && c.space.id !== person.space.id,
  );

  return (
    <section className="hairline border-b px-5 py-4">
      <h2 className="faint mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider">
        <Icon name="link" size={11} />
        Also recorded elsewhere
      </h2>

      {links.length === 0 ? (
        <p className="faint mb-3 text-xs">Not linked to another record.</p>
      ) : (
        <>
          <ul className="mb-2 flex flex-col gap-2">
            {links.map((l) => (
              <li
                key={l.id}
                className="surface flex flex-wrap items-center gap-2 rounded p-2.5 text-xs"
              >
                {l.otherId && l.otherSpace ? (
                  <>
                    <SpaceIndicator space={l.otherSpace} />
                    <Link
                      href={`/people/${l.otherId}` as never}
                      className="underline underline-offset-2"
                    >
                      {l.otherName}
                    </Link>
                  </>
                ) : (
                  <span className="muted">A linked record in a space you cannot see.</span>
                )}
                <span className="faint ml-auto text-2xs">
                  linked {formatRelative(l.linkedAt)}
                  {l.confidence !== 'confirmed' && ` · ${l.confidence}`}
                </span>
                <form action={unlinkPeople}>
                  <input type="hidden" name="linkId" value={l.id} />
                  <button
                    type="submit"
                    className="faint rounded"
                    aria-label={`Unlink ${l.otherName ?? 'this record'}`}
                    title="Unlink — both records stay exactly as they are"
                  >
                    <Icon name="x" size={12} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="faint mb-3 text-2xs">
            Two records, kept separate on purpose. Each belongs to its own space and
            follows that space’s rules; nothing merges them, and unlinking is the only way
            to undo this.
          </p>
        </>
      )}

      {candidates.length > 0 && (
        <form action={linkPeople} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="personId" value={person.id} />
          <div className="flex min-w-64 flex-col gap-1">
            <label htmlFor="link-other" className="faint text-2xs font-medium">
              Link to another record of the same person
            </label>
            <select id="link-other" name="otherId" className="input" defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {sameName.length > 0 && (
                <optgroup label="Same name, another space">
                  {sameName.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName} — {c.space.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Everyone else you can write to">
                {candidates
                  .filter((c) => !sameName.includes(c))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName} — {c.space.name}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
          <button
            type="submit"
            className="hairline rounded border px-3 py-1.5 text-xs font-medium"
          >
            Link
          </button>
          <p className="faint w-full text-2xs">
            Only people in spaces you can write to are offered — linking needs write
            access on both sides, and the database enforces that independently.
          </p>
        </form>
      )}
    </section>
  );
}

function EditForm({
  person,
  categories,
  places,
}: {
  person: PersonRow;
  categories: CategoryOption[];
  /** Places in this person's own space — the only ones the action will accept. */
  places: PlaceRow[];
}) {
  return (
    <form action={updatePerson} className="flex flex-col gap-4 px-5 py-4">
      <input type="hidden" name="personId" value={person.id} />

      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        <Field label="Name" id="person-name">
          <input
            id="person-name"
            name="displayName"
            defaultValue={person.displayName}
            required
            autoComplete="off"
            className="input"
          />
        </Field>
        <Field label="Known as" id="person-nickname">
          <input
            id="person-nickname"
            name="nickname"
            defaultValue={person.nickname ?? ''}
            autoComplete="off"
            className="input"
          />
        </Field>
        <Field label="Pronouns" id="person-pronouns">
          <input
            id="person-pronouns"
            name="pronouns"
            defaultValue={person.pronouns ?? ''}
            autoComplete="off"
            className="input"
          />
        </Field>
        <Field label="Category" id="person-category">
          <select
            id="person-category"
            name="categoryId"
            defaultValue={person.category ? findCategoryId(categories, person.category.name) : ''}
            className="input"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/*
        Where they live. Until migration 0017 there was nowhere to put this, so
        People could not be drawn on a map from anything better than attendance
        history — which is where somebody has *been*, not where they live.

        A select of existing places rather than a free-text address: an address
        typed here would be a second, unstructured copy of a place record, with
        no coordinates, no geocoding and nothing linking the two. It offers only
        this person's own space, which is also the only thing `updatePerson`
        will accept.
      */}
      <Field
        label="Home"
        id="person-home-place"
        hint={places.length === 0 ? 'no places in this space yet' : 'a place in this space'}
      >
        <select
          id="person-home-place"
          name="homePlaceId"
          defaultValue={person.homePlaceId ?? ''}
          className="input"
          disabled={places.length === 0}
        >
          <option value="">No place recorded</option>
          {places.map((pl) => (
            <option key={pl.id} value={pl.id}>
              {pl.name}
              {pl.city ? ` — ${pl.city}` : ''}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Notes" id="person-notes" hint="Markdown">
        <textarea
          id="person-notes"
          name="notesMd"
          defaultValue={person.notesMd}
          rows={5}
          className="input resize-y font-mono text-xs"
        />
      </Field>

      <div>
        <button
          type="submit"
          className="rounded px-3 py-1.5 text-xs font-medium btn-primary"
        >
          Save changes
        </button>
      </div>
    </form>
  );
}

/**
 * The person query returns the category by name, not id, because that is what
 * the chip renders. Names are unique per space, so this resolves back safely —
 * and if it ever did not, the action re-checks the id against the space anyway.
 */
function findCategoryId(categories: CategoryOption[], name: string): string {
  return categories.find((c) => c.name === name)?.id ?? '';
}

function ContactsSection({
  person,
  contacts,
}: {
  person: PersonRow;
  contacts: PersonContact[];
}) {
  return (
    <section className="hairline border-t px-5 py-4">
      <h2 className="faint mb-2 text-2xs font-semibold uppercase tracking-wider">
        Contact
      </h2>

      {contacts.length === 0 ? (
        <p className="faint mb-3 text-xs">No contact details.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1.5 text-sm">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-2">
              <span className="faint flex w-24 shrink-0 items-center gap-1.5 text-2xs">
                <Icon name={CONTACT_ICON[c.kind] ?? 'circle'} size={11} />
                {c.label}
              </span>
              <span>
                {c.kind === 'email' ? (
                  <a
                    href={`mailto:${c.value}`}
                    className="underline underline-offset-2"
                    style={{ color: 'var(--accent)' }}
                  >
                    {c.value}
                  </a>
                ) : c.kind === 'phone' || c.kind === 'mobile' ? (
                  <a
                    href={`tel:${c.value.replace(/\s+/g, '')}`}
                    className="underline underline-offset-2"
                    style={{ color: 'var(--accent)' }}
                  >
                    {c.value}
                  </a>
                ) : (
                  c.value
                )}
                {c.isPrimary && <span className="faint ml-2 text-2xs">primary</span>}
              </span>
              <form action={removePersonContact} className="ml-auto">
                <input type="hidden" name="contactId" value={c.id} />
                <button
                  type="submit"
                  className="faint rounded"
                  aria-label={`Remove ${c.label} ${c.value}`}
                >
                  <Icon name="x" size={11} />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={addPersonContact} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="personId" value={person.id} />
        <Field label="Kind" id="contact-kind">
          <select id="contact-kind" name="kind" defaultValue="mobile" className="input">
            {CONTACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k[0]!.toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label" id="contact-label" hint="optional">
          <input id="contact-label" name="label" autoComplete="off" className="input" />
        </Field>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="contact-value" className="faint text-2xs font-medium">
            Value
          </label>
          <input id="contact-value" name="value" required autoComplete="off" className="input" />
        </div>
        <button
          type="submit"
          className="hairline rounded border px-3 py-1.5 text-xs font-medium"
        >
          Add
        </button>
      </form>
    </section>
  );
}

function DatesSection({ person, dates }: { person: PersonRow; dates: PersonDate[] }) {
  return (
    <section className="hairline border-t px-5 py-4">
      <h2 className="faint mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider">
        <Icon name="cake" size={11} />
        Important dates
      </h2>

      {dates.length === 0 ? (
        <p className="faint mb-3 text-xs">No dates recorded.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {dates.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-2">
              <span className="faint w-24 shrink-0 text-2xs capitalize">
                {d.label ?? d.kind}
              </span>
              <span>
                {/* With no year, showing one would invent a fact. */}
                {d.yearKnown ? formatDate(d.onDate) : formatDate(d.onDate).slice(0, 5)}
                {!d.yearKnown && <span className="faint ml-2 text-2xs">year unknown</span>}
              </span>
              <form action={removePersonDate} className="ml-auto">
                <input type="hidden" name="dateId" value={d.id} />
                <button
                  type="submit"
                  className="faint rounded"
                  aria-label={`Remove ${d.label ?? d.kind}`}
                >
                  <Icon name="x" size={11} />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={addPersonDate} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="personId" value={person.id} />
        <Field label="Kind" id="date-kind">
          <select id="date-kind" name="kind" defaultValue="birthday" className="input">
            {DATE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k[0]!.toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label" id="date-label" hint="optional">
          <input id="date-label" name="label" autoComplete="off" className="input" />
        </Field>
        <Field label="Date" id="date-on">
          <input id="date-on" type="date" name="onDate" required className="input" />
        </Field>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs">
          <input type="checkbox" name="yearKnown" defaultChecked />
          Year is known
        </label>
        <button
          type="submit"
          className="hairline rounded border px-3 py-1.5 text-xs font-medium"
        >
          Add
        </button>
      </form>
    </section>
  );
}

function MoveSection({
  person,
  targets,
  target,
  preview,
}: {
  person: PersonRow;
  targets: SpaceSummary[];
  target: SpaceSummary | undefined;
  preview: { change: string; displayName: string; reason: string }[];
}) {
  const gains = preview.filter((p) => p.change === 'gains');
  const loses = preview.filter((p) => p.change === 'loses');
  const keeps = preview.filter((p) => p.change === 'keeps');

  return (
    <section className="hairline border-b px-5 py-4">
      <h2 className="faint mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider">
        <Icon name="move" size={11} />
        Move to another space
      </h2>

      {targets.length === 0 ? (
        <p className="faint text-xs">There is nowhere else to move this.</p>
      ) : !target ? (
        <>
          <p className="muted mb-2 text-xs">
            Pick a destination. You will see exactly who gains and loses access before
            anything changes.
          </p>
          <ul className="flex flex-wrap gap-2">
            {targets.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/people/${person.id}?moveTo=${s.id}` as never}
                  className="surface row-hover flex items-center gap-2 rounded px-2 py-1.5"
                  aria-label={`Preview moving this person to ${s.name}`}
                >
                  <SpaceIndicator space={s} />
                  <Icon name="arrow_right" size={11} className="faint" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="surface rounded-md p-4">
          <div className="mb-3 flex items-center gap-2 text-sm">
            <SpaceIndicator space={person.space} size="md" />
            <Icon name="arrow_right" size={13} className="faint" />
            <SpaceIndicator space={target} size="md" />
          </div>

          <div className="flex flex-col gap-2 text-xs">
            {loses.length > 0 && (
              <Group
                tone="var(--danger)"
                heading={`${loses.length === 1 ? 'This person loses' : 'These people lose'} access`}
                people={loses}
              />
            )}
            {gains.length > 0 && (
              <Group
                tone="var(--accent)"
                heading={`${gains.length === 1 ? 'This person gains' : 'These people gain'} access`}
                people={gains}
              />
            )}
            {keeps.length > 0 && (
              <Group tone="var(--text-muted)" heading="Unchanged" people={keeps} />
            )}
            {preview.length === 0 && <p className="faint">Nobody’s access changes.</p>}
          </div>

          <p className="muted mt-3 flex items-start gap-1.5 text-xs">
            <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
            <span>
              Contact details and dates move with them.
              {person.category && (
                <>
                  {' '}
                  The category{' '}
                  <strong className="font-medium">{person.category.name}</strong> belongs to{' '}
                  {person.space.name} and will be cleared.
                </>
              )}{' '}
              Any link to another record stays, but the other side may stop being able to
              see this one.
            </span>
          </p>

          <div className="mt-4 flex items-center gap-3">
            <form action={movePersonToSpace}>
              <input type="hidden" name="personId" value={person.id} />
              <input type="hidden" name="targetSpaceId" value={target.id} />
              <button
                type="submit"
                className="rounded px-3 py-1.5 text-xs font-medium btn-primary"
              >
                Move to {target.name}
              </button>
            </form>
            <Link href={`/people/${person.id}` as never} className="muted text-xs">
              Cancel
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

function Group({
  tone,
  heading,
  people,
}: {
  tone: string;
  heading: string;
  people: { displayName: string; reason: string }[];
}) {
  return (
    <div>
      <h3 className="font-medium" style={{ color: tone }}>
        {heading}
      </h3>
      <ul className="muted mt-0.5 flex flex-col gap-0.5">
        {people.map((p) => (
          <li key={p.displayName}>
            {p.displayName} <span className="faint">— {p.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="faint text-2xs font-medium">
        {label}
        {hint && <span className="ml-1 font-normal opacity-70">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
