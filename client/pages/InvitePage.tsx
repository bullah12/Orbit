import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { inviteAction } from '../data/api';
import s from '../styles/ui.module.css';

export default function InvitePage() {
  const { token = '' } = useParams(); const navigate = useNavigate(); const client = useQueryClient(); const preview = useQuery({ queryKey: ['invite', token], queryFn: () => inviteAction(token, 'preview'), enabled: Boolean(token), retry: false }); const action = useMutation({ mutationFn: (kind: 'accept' | 'decline') => inviteAction(token, kind), onSuccess: (data, kind) => { if (kind === 'accept' && data.status === 'accepted') { void client.invalidateQueries({ queryKey: ['spaces'] }); navigate('/'); } } });
  const data = action.data ?? preview.data; const status = String(data?.status ?? '');
  return <main className="route-status"><section className={s.card} style={{ width: 'min(520px, calc(100vw - 2rem))' }}><div className={s.brand}><span className={s.brandMark}>O</span><span>Orbit invitation</span></div>{preview.isLoading ? <p>Checking invitation…</p> : preview.error ? <p className={s.error}>{preview.error.message}</p> : <><h1>{String(data?.space_name ?? 'Shared space')}</h1><p>You have been invited as <strong>{String(data?.invite_role ?? 'member')}</strong>.</p>{['ok', 'declined'].includes(status) ? <div className={s.toolbar}><button className={s.primaryButton} onClick={() => action.mutate('accept')} disabled={action.isPending}>Accept invitation</button><button className={s.secondaryButton} onClick={() => action.mutate('decline')} disabled={action.isPending}>Decline</button></div> : <p className={status === 'accepted' || status === 'already_member' ? s.success : s.error}>Status: {status.replaceAll('_', ' ')}</p>}</>}</section></main>;
}
