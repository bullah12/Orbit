import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getNote } from '@/lib/queries/notes';
import { updateNote } from '@/app/actions';
import { SpaceIndicator, CategoryChip } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const result = await getNote(user.id, id);

  // Not found and not permitted are the same response on purpose: a 403 would
  // confirm the note exists.
  if (!result) notFound();
  const { note, links } = result;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/notes" className="faint text-[12px]">
            Notes
          </Link>
          <span className="faint text-[12px]">/</span>
          <SpaceIndicator space={note.space} />
          <CategoryChip category={note.category} />
          {note.visibility === 'private' && (
            <span className="faint flex items-center gap-1 text-[11px]">
              <Icon name="eye_off" size={11} />
              Private to you
            </span>
          )}
          <span className="faint ml-auto text-[11px]">
            Edited {formatRelative(note.updatedAt)}
          </span>
        </div>
      </header>

      {note.isLocked ? (
        <div className="muted flex items-center gap-2 px-5 py-10 text-[13px]">
          <Icon name="lock" size={14} />
          This note is locked. It is end-to-end encrypted and can only be opened on a
          device holding the key — the server has never seen its contents.
        </div>
      ) : (
        <form action={updateNote} className="flex flex-1 flex-col gap-3 px-5 py-4">
          <input type="hidden" name="noteId" value={note.id} />
          <input
            name="title"
            defaultValue={note.title}
            className="bg-transparent text-[17px] font-semibold outline-none"
            aria-label="Note title"
          />
          <textarea
            name="bodyMd"
            defaultValue={note.bodyMd}
            rows={18}
            className="flex-1 resize-y bg-transparent font-mono text-[12.5px] leading-relaxed outline-none"
            aria-label="Note body, Markdown"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded px-3 py-1.5 text-[12px] font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
            >
              Save
            </button>
            <span className="faint text-[11px]">
              The previous version is kept every time you save.
            </span>
          </div>
        </form>
      )}

      {links.length > 0 && (
        <section className="hairline border-t px-5 py-3">
          <h2 className="faint mb-1.5 text-[10px] font-semibold uppercase tracking-wider">
            Linked to
          </h2>
          <ul className="flex flex-wrap gap-2">
            {links.map((l) => (
              <li
                key={`${l.entityKind}-${l.entityId}`}
                className="surface flex items-center gap-1.5 rounded px-2 py-1 text-[11px]"
              >
                <Icon
                  name={
                    l.entityKind === 'task'
                      ? 'check'
                      : l.entityKind === 'person'
                        ? 'users'
                        : l.entityKind === 'place'
                          ? 'house'
                          : 'calendar'
                  }
                  size={11}
                  className="faint"
                />
                {l.label}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
