import { CalendarDays, FileText, MapPin, Search, UserRound, X, ListTodo } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { globalSearch } from '../data/api';
import { queryKeys } from '../data/queryKeys';
import { useSpaces } from '../data/hooks';
import type { SearchResult } from '../data/types';
import s from '../styles/ui.module.css';

const icons = { task: ListTodo, note: FileText, person: UserRound, event: CalendarDays, place: MapPin };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const spaces = useSpaces();
  const results = useQuery({ queryKey: queryKeys.search(query), queryFn: () => globalSearch(query), enabled: open && query.trim().length >= 2, staleTime: 30_000 });

  useEffect(() => { if (open) { setSelected(0); requestAnimationFrame(() => input.current?.focus()); } }, [open]);
  if (!open) return null;
  const rows = results.data ?? [];
  const go = (row: SearchResult) => { navigate(row.path); onClose(); setQuery(''); };
  return (
    <div className={s.paletteBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={s.palette} role="dialog" aria-modal="true" aria-label="Search Orbit">
        <div style={{ position: 'relative' }}>
          <Search size={20} aria-hidden style={{ position: 'absolute', left: 18, top: 19 }} />
          <input ref={input} className={s.paletteInput} style={{ paddingLeft: 50 }} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} placeholder="Search tasks, notes, people, events and places" aria-label="Search query" onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, rows.length - 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)); }
            if (event.key === 'Enter' && rows[selected]) go(rows[selected]);
          }} />
          <button className={s.iconButton} onClick={onClose} aria-label="Close search" style={{ position: 'absolute', right: 8, top: 8 }}><X size={18} /></button>
        </div>
        {query.trim().length < 2 && <div className={s.empty}>Type at least two characters. Press ↑ or ↓ to move and Enter to open.</div>}
        {results.isFetching && <div className={s.empty} role="status">Searching…</div>}
        {results.error && <div className={s.error} role="alert">{results.error.message}</div>}
        {rows.map((row, index) => {
          const Icon = icons[row.type];
          const space = spaces.data?.find((item) => item.id === row.space_id);
          return <button key={`${row.type}-${row.id}`} className={`${s.paletteResult} ${index === selected ? s.paletteSelected : ''}`} onMouseEnter={() => setSelected(index)} onClick={() => go(row)}>
            <Icon size={19} aria-hidden />
            <span className={s.rowMain}><span className={s.rowTitle}>{row.title}</span><span className={s.rowMeta}><span>{row.type}</span><span>{row.subtitle}</span></span></span>
            {space && <span className={s.spaceChip}><span className={s.spaceDot} />{space.short_label}</span>}
          </button>;
        })}
        {query.trim().length >= 2 && !results.isFetching && rows.length === 0 && <div className={s.empty}>No matching records.</div>}
      </section>
    </div>
  );
}
