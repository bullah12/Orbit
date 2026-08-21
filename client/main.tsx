import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, ProtectedRoute } from './auth/AuthProvider';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AppShell } from './components/AppShell';
import TodayPage from './pages/TodayPage';
import './styles/global.css';

const SignInPage = lazy(() => import('./pages/SignInPage'));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const PeoplePage = lazy(() => import('./pages/PeoplePage'));
const PersonDetailPage = lazy(() => import('./pages/PersonDetailPage'));
const PlacesPage = lazy(() => import('./pages/PlacesPage'));
const PlaceDetailPage = lazy(() => import('./pages/PlaceDetailPage'));
const NotesPage = lazy(() => import('./pages/NotesPage'));
const NoteDetailPage = lazy(() => import('./pages/NoteDetailPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SpacePage = lazy(() => import('./pages/SpacePage'));
const MorePage = lazy(() => import('./pages/MorePage'));
const InvitePage = lazy(() => import('./pages/InvitePage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: 1, refetchOnWindowFocus: false }, mutations: { retry: 0 } } });

function App() {
  return <BrowserRouter><AuthProvider><Suspense fallback={<div className="route-status" role="status">Opening Orbit…</div>}><Routes>
    <Route path="/sign-in" element={<SignInPage />} />
    <Route path="/auth/callback" element={<AuthCallbackPage />} />
    <Route path="/invite/:token" element={<ProtectedRoute><InvitePage /></ProtectedRoute>} />
    <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
      <Route index element={<TodayPage />} />
      <Route path="tasks/:list" element={<TasksPage />} />
      <Route path="tasks/item/:id" element={<TaskDetailPage />} />
      <Route path="calendar" element={<CalendarPage />} />
      <Route path="people" element={<PeoplePage />} />
      <Route path="people/:id" element={<PersonDetailPage />} />
      <Route path="places" element={<PlacesPage />} />
      <Route path="places/:id" element={<PlaceDetailPage />} />
      <Route path="notes" element={<NotesPage />} />
      <Route path="notes/:id" element={<NoteDetailPage />} />
      <Route path="search" element={<SearchPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="spaces" element={<SpacePage />} />
      <Route path="spaces/:id" element={<SpacePage />} />
      <Route path="more" element={<MorePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes></Suspense></AuthProvider></BrowserRouter>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><QueryClientProvider client={queryClient}><App /></QueryClientProvider></AppErrorBoundary></StrictMode>);
