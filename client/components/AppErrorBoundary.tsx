import { Component, type ErrorInfo, type ReactNode } from 'react';
import s from '../styles/ui.module.css';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Orbit render error', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="route-status"><section className={s.card}><h1>Orbit hit a problem</h1><p className={s.error}>{this.state.error.message}</p><button className={s.primaryButton} onClick={() => window.location.reload()}>Reload Orbit</button></section></main>;
  }
}
