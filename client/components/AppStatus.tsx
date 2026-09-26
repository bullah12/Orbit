import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Capture the event before authentication finishes mounting the application shell.
let pendingInstall: InstallPrompt | null = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); pendingInstall = event as InstallPrompt;
  window.dispatchEvent(new Event('orbit:install-ready'));
});

export function AppStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState(pendingInstall);
  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    const ready = () => setInstall(pendingInstall);
    const installed = () => { pendingInstall = null; setInstall(null); };
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    window.addEventListener('orbit:install-ready', ready); window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('online', connection); window.removeEventListener('offline', connection);
      window.removeEventListener('orbit:install-ready', ready); window.removeEventListener('appinstalled', installed);
    };
  }, []);
  return <>
    {!online && <p className={s.connectionNotice} role="status">You’re offline. Displayed plans may be out of date. Reconnect before saving changes.</p>}
    {install && <div className={s.installBar}><span>Keep Orbit on your home screen.</span><button className={s.secondaryButton} onClick={async () => {
      try { await install.prompt(); await install.userChoice; } catch { /* Browser menu installation remains available. */ } finally { pendingInstall = null; setInstall(null); }
    }}>Install Orbit</button></div>}
  </>;
}
