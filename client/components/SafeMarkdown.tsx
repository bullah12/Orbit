import type { ReactNode } from 'react';
import s from '../styles/ui.module.css';

function inline(value: string): ReactNode[] {
  const parts = value.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) { const href = link[2] ?? ''; const safe = /^(https?:|mailto:)/.test(href); return safe ? <a key={index} href={href} rel="noreferrer" target="_blank">{link[1]}</a> : <span key={index}>{link[1]}</span>; }
    return part;
  });
}

export function SafeMarkdown({ source }: { source: string }) {
  const rows = source.split('\n'); const nodes: ReactNode[] = []; let list: string[] = [];
  const flush = () => { if (list.length) { nodes.push(<ul key={`list-${nodes.length}`}>{list.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>); list = []; } };
  rows.forEach((row, index) => {
    if (row.startsWith('- ')) { list.push(row.slice(2)); return; }
    flush();
    if (row.startsWith('### ')) nodes.push(<h3 key={index}>{inline(row.slice(4))}</h3>);
    else if (row.startsWith('## ')) nodes.push(<h2 key={index}>{inline(row.slice(3))}</h2>);
    else if (row.startsWith('# ')) nodes.push(<h1 key={index}>{inline(row.slice(2))}</h1>);
    else if (row.startsWith('> ')) nodes.push(<blockquote key={index}>{inline(row.slice(2))}</blockquote>);
    else if (row.trim()) nodes.push(<p key={index}>{inline(row)}</p>);
  });
  flush();
  return <div className={s.markdown}>{nodes}</div>;
}
