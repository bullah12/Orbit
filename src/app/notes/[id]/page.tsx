import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getNote, listLinkTargets, type LinkTarget } from '@/lib/queries/notes';
import {
  addNoteLink,
  archiveNote,
  deleteNote,
  removeNoteLink,
  restoreNote,
  updateNote,
} from '@/app/actions';
import { SpaceIndicator, CategoryChip } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

const KIND_ICON: Record<string, string> = {
  task: 'check',
  person: 'users',
  place: 'house',
  event: 'calendar',
};

const KIND_LABEL: Record<LinkTarget['kind'], string> = {
  task: 'Tasks',
  person: 'People',
  place: 'Places',
  event: 'Events',
};

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const result = await getNote(user.id, id);

  // Not found and not permitted are the same response on purpose: a 403 would
  // confirm the note exists.
  if (!result) notFound();
  const { note, links } = result;

  // Only offered for an unlocked note — a locked one has no readable body to
  // attach a link to, and the picker's labels would be the only plaintext on
  // the screen.
  const targets = note.isLocked ? [] : await listLinkTargets(user.id, note.space.id);
  const linked = new Set(links.map((l) => `${l.entityKind}:${l.entityId}`));
  const available = targets.filter((t) => !linked.has(`${t.kind}:${t.id}`));

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="hairline border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/notes" className="faint text-[12px]">
            Notes
          </Link>
          <span className="faint text-[12px]" aria-hidden="true">
            /
          </span>
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
        {note.archivedAt && (
          <p className="muted mt-2 flex flex-wrap items-center gap-2 text-[12px]">
            <Icon name="archive" size={12} />
            Archived {formatRelative(note.archivedAt)}.
            <form action={restoreNote} className="inline">
              <input type="hidden" name="noteId" value={note.id} />
              <button type="submit" className="underline underline-offset-2">
                Restore it
              </button>
            </form>
          </p>
        )}
      </header>

      {note.isLocked ? (
        <div className="muted flex items-center gap-2 px-5 py-10 text-[13px]">
          <Icon name="lock" size={14} />
          This note is locked. It is end-to-end encrypted and can only be opened on a
          device holding the key — the server has never seen its contents.
        </div>
      ) : (
        <>
          <form action={updateNote} className="flex flex-col gap-3 px-5 py-4">
            <input type="hidden" name="noteId" value={note.id} />
            <label htmlFor="note-title" className="sr-only">
              Note title
            </label>
            <input
              id="note-title"
              name="title"
              defaultValue={note.title}
              className="bg-transparent text-[17px] font-semibold outline-none"
            />
            <label htmlFor="note-body" className="faint text-[11px] font-medium">
              Body (Markdown)
            </label>
            <textarea
              id="note-body"
              name="bodyMd"
              defaultValue={note.bodyMd}
              rows={16}
              className="resize-y bg-transparent font-mono text-[12.5px] leading-relaxed outline-none"
            />
            <div className="flex flex-wrap items-center gap-3">
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

          {note.bodyMd.trim() !== '' && (
            <section className="hairline border-t px-5 py-4">
              <h2 className="faint mb-2 text-[10px] font-semibold uppercase tracking-wider">
                Rendered
              </h2>
              <Markdown source={note.bodyMd} />
            </section>
          )}
        </>
      )}

      <section className="hairline border-t px-5 py-4">
        <h2 className="faint mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
          <Icon name="link" size={11} />
          Linked to
        </h2>

        {links.length === 0 ? (
          <p className="faint mb-3 text-[12px]">Not linked to anything yet.</p>
        ) : (
          <ul className="mb-3 flex flex-wrap gap-2">
            {links.map((l) => (
              <li
                key={`${l.entityKind}-${l.entityId}`}
                className="surface flex items-center gap-1.5 rounded px-2 py-1 text-[11px]"
              >
                <Icon name={KIND_ICON[l.entityKind] ?? 'circle'} size={11} className="faint" />
                {l.entityKind === 'task' ? (
                  <Link href={`/tasks/item/${l.entityId}` as never} className="underline underline-offset-2">
                    {l.label}
                  </Link>
                ) : (
                  l.label
                )}
                <form action={removeNoteLink} className="inline-flex">
                  <input type="hidden" name="noteId" value={note.id} />
                  <input type="hidden" name="entityKind" value={l.entityKind} />
                  <input type="hidden" name="entityId" value={l.entityId} />
                  <button
                    type="submit"
                    className="faint ml-0.5 rounded"
                    aria-label={`Remove the link to ${l.label}`}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {available.length > 0 && (
          <form action={addNoteLink} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="noteId" value={note.id} />
            <div className="flex min-w-56 flex-col gap-1">
              <label htmlFor="link-target" className="faint text-[11px] font-medium">
                Link to something in {note.space.name}
              </label>
              <select id="link-target" name="target" className="input" defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {(['task', 'person', 'place', 'event'] as const).map((kind) => {
                  const group = available.filter((t) => t.kind === kind);
                  if (group.length === 0) return null;
                  return (
                    <optgroup key={kind} label={KIND_LABEL[kind]}>
                      {group.map((t) => (
                        <option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>
                          {t.label}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>
            <button
              type="submit"
              className="hairline rounded border px-3 py-1.5 text-[12px] font-medium"
            >
              Link
            </button>
          </form>
        )}
      </section>

      <section className="hairline border-t px-5 py-4">
        {note.archivedAt ? (
          <form action={deleteNote} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="noteId" value={note.id} />
            <button
              type="submit"
              className="hairline rounded border px-3 py-1.5 text-[12px] font-medium"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon name="trash" size={12} />
                Delete permanently
              </span>
            </button>
            <span className="faint text-[12px]">
              This also removes every saved version. There is no undo.
            </span>
          </form>
        ) : (
          <form action={archiveNote} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="noteId" value={note.id} />
            <button
              type="submit"
              className="hairline rounded border px-3 py-1.5 text-[12px] font-medium"
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon name="archive" size={12} />
                Archive
              </span>
            </button>
            <span className="faint text-[12px]">
              Archiving is reversible. Deleting is offered from the archive.
            </span>
          </form>
        )}
      </section>
    </div>
  );
}
