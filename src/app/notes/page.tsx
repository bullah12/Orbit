import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { listNotes } from '@/lib/queries/notes';
import { createNote } from '@/app/actions';
import { SpaceIndicator, CategoryChip } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { formatRelative, plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function NotesPage() {
  const user = await requireUser();
  const [spaces, notes] = await Promise.all([listSpaces(user.id), listNotes(user.id)]);
  const writable = spaces.filter((s) => s.canWrite);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[15px] font-semibold">Notes</h1>
          <span className="faint text-[12px]">{plural(notes.length, 'note')}</span>
        </div>
      </header>

      <form
        action={createNote}
        className="hairline flex flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ background: 'var(--bg-raised)' }}
      >
        <Icon name="plus" size={14} className="faint" />
        <input
          name="title"
          placeholder="New note…"
          autoComplete="off"
          required
          className="min-w-40 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--text-faint)]"
        />
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">Space</legend>
          {writable.map((s, i) => (
            <label key={s.id} className="cursor-pointer">
              <input
                type="radio"
                name="spaceId"
                value={s.id}
                defaultChecked={i === 0}
                className="peer sr-only"
              />
              <span className="block rounded opacity-45 peer-checked:opacity-100">
                <SpaceIndicator space={s} />
              </span>
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          className="rounded px-2 py-1 text-[12px] font-medium"
          style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
        >
          Add
        </button>
      </form>

      {notes.length === 0 ? (
        <p className="faint px-5 py-10 text-[13px]">No notes yet.</p>
      ) : (
        <ul>
          {notes.map((n) => (
            <li key={n.id} className="hairline row-hover border-b px-3 py-2">
              <Link href={`/notes/${n.id}` as never} className="block">
                <div className="flex items-baseline gap-2">
                  {n.pinnedAt && <Icon name="check" size={11} className="faint shrink-0" />}
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {n.isLocked ? <em className="muted">Locked note</em> : n.title}
                  </span>
                  <CategoryChip category={n.category} />
                  <span className="faint shrink-0 text-[11px]">{formatRelative(n.updatedAt)}</span>
                  <SpaceIndicator space={n.space} />
                </div>
                {!n.isLocked && n.bodyMd && (
                  <p className="faint mt-0.5 truncate pl-0 text-[11px]">
                    {n.bodyMd.replace(/[#*`\n]/g, ' ').slice(0, 140)}
                  </p>
                )}
                {n.linkCount > 0 && (
                  <p className="faint mt-0.5 flex items-center gap-1 text-[11px]">
                    <Icon name="arrow_right" size={10} />
                    {plural(n.linkCount, 'link')}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
