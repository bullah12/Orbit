import { FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AsyncState } from '../components/AsyncState';
import { PageHeader } from '../components/AppShell';
import { listNotes } from '../data/api';
import { queryKeys } from '../data/queryKeys';
import { formatShortDate } from '../lib/date';
import s from '../styles/ui.module.css';

export default function NotesPage() {
  const [search, setSearch] = useState(''); const notes = useQuery({ queryKey: queryKeys.notes(search), queryFn: () => listNotes(search), placeholderData: (previous) => previous });
  return <><PageHeader title="Notes" subtitle="Useful context, kept close to the things it describes." /><div className={s.quickAdd}><input className={s.input} aria-label="Search notes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" type="search" /></div><section className={s.workspace}><div className={s.workspaceList}><AsyncState loading={notes.isLoading} error={notes.error} empty={notes.data?.length === 0}><ul className={s.list}>{notes.data?.map((note) => <li key={note.id}><Link className={s.row} to={`/notes/${note.id}`}><FileText size={18} /><span className={s.rowMain}><span className={s.rowTitle}>{note.is_locked ? 'Locked note' : note.title || 'Untitled note'}</span><span className={s.rowMeta}>{formatShortDate(note.updated_at)}{note.pinned_at && <span>Pinned</span>}</span></span></Link></li>)}</ul></AsyncState></div><div className={s.workspaceDetail}><div className={s.empty}><div><h2>Select a note</h2><p>Choose a note to edit and preview it.</p></div></div></div></section></>;
}
