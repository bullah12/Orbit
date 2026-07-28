import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getPerson } from '@/lib/queries/people';
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

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const result = await getPerson(user.id, id);
  if (!result) notFound();
  const { person, contacts, dates, links, mentions } = result;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Link href="/people" className="faint text-[12px]">
            People
          </Link>
          <span className="faint text-[12px]" aria-hidden="true">
            /
          </span>
          <SpaceIndicator space={person.space} />
          <CategoryChip category={person.category} />
        </div>
        <h1 className="text-[17px] font-semibold">
          {person.isLocked ? <em className="muted">Locked person</em> : person.displayName}
        </h1>
        <p className="faint mt-0.5 text-[12px]">
          {[person.nickname && `“${person.nickname}”`, person.pronouns]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      {/*
        The linked-not-merged panel. It comes first because it is the thing a
        person is most likely to misread: these are two records that both exist,
        not one record shown twice, and nothing here will ever collapse them.
      */}
      {links.length > 0 && (
        <section className="hairline border-b px-5 py-4">
          <h2 className="faint mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            <Icon name="link" size={11} />
            Also recorded elsewhere
          </h2>
          <ul className="flex flex-col gap-2">
            {links.map((l, i) => (
              <li key={l.otherId ?? i} className="surface flex flex-wrap items-center gap-2 rounded p-2.5 text-[12px]">
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
                  <span className="muted">
                    A linked record in a space you cannot see.
                  </span>
                )}
                <span className="faint ml-auto text-[11px]">
                  linked {formatRelative(l.linkedAt)}
                  {l.confidence !== 'confirmed' && ` · ${l.confidence}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="faint mt-2 text-[11px]">
            Two records, kept separate on purpose. Each belongs to its own space and
            follows that space’s rules; nothing merges them, and unlinking is the only
            way to undo this.
          </p>
        </section>
      )}

      {contacts.length > 0 && (
        <section className="hairline border-b px-5 py-4">
          <h2 className="faint mb-2 text-[10px] font-semibold uppercase tracking-wider">
            Contact
          </h2>
          <dl className="flex flex-col gap-1.5 text-[13px]">
            {contacts.map((c, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-2">
                <dt className="faint flex w-24 shrink-0 items-center gap-1.5 text-[11px]">
                  <Icon name={CONTACT_ICON[c.kind] ?? 'circle'} size={11} />
                  {c.label}
                </dt>
                <dd>
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
                  {c.isPrimary && <span className="faint ml-2 text-[11px]">primary</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {dates.length > 0 && (
        <section className="hairline border-b px-5 py-4">
          <h2 className="faint mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            <Icon name="cake" size={11} />
            Important dates
          </h2>
          <ul className="flex flex-col gap-1 text-[13px]">
            {dates.map((d, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className="faint w-24 shrink-0 text-[11px] capitalize">
                  {d.label ?? d.kind}
                </span>
                <span>
                  {d.yearKnown
                    ? formatDate(d.onDate)
                    : formatDate(d.onDate).slice(0, 5) /* DD/MM, year unknown */}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!person.isLocked && person.notesMd.trim() !== '' && (
        <section className="hairline border-b px-5 py-4">
          <h2 className="faint mb-2 text-[10px] font-semibold uppercase tracking-wider">
            Notes
          </h2>
          <Markdown source={person.notesMd} />
        </section>
      )}

      <section className="px-5 py-4">
        <h2 className="faint mb-2 text-[10px] font-semibold uppercase tracking-wider">
          Mentioned in
        </h2>
        {mentions.length === 0 ? (
          <p className="faint text-[12px]">Nothing links to this person yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {mentions.map((m) => (
              <li key={`${m.kind}-${m.id}`} className="flex items-baseline gap-2 text-[13px]">
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
                  <span className="faint ml-auto shrink-0 text-[11px]">
                    {m.kind === 'event' ? formatDateTime(m.at) : formatRelative(m.at)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
