import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { MusicPlayerProvider } from './lib/music-player';
import { AppShell } from './components/AppShell';
import { MiniPlayer } from './components/MiniPlayer';
import { LoginPage } from './pages/LoginPage';
import { MessagesPage } from './pages/MessagesPage';
import { MomentsPage } from './pages/MomentsPage';
import { MusicPage } from './pages/MusicPage';
import { SettingsPage } from './pages/SettingsPage';
import { CharactersPage } from './pages/CharactersPage';
import { ChatRoomPage } from './pages/ChatRoomPage';
import { CharacterProfilePage } from './pages/CharacterProfilePage';
import { WorldBooksPage } from './pages/WorldBooksPage';

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--page)]">
      <div className="flex flex-col items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-[22px] bg-[var(--seal-bg)] text-[var(--seal-fg)] shadow-lg">
          <span className="font-display text-3xl">墨</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)] [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)] [animation-delay:240ms]" />
        </div>
      </div>
    </div>
  );
}

function ProtectedLayout() {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <MusicPlayerProvider>
      <Outlet />
      <MiniPlayer />
    </MusicPlayerProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedLayout />}>
          <Route element={<AppShell />}>
            <Route index element={<MessagesPage />} />
            <Route path="/characters" element={<CharactersPage />} />
            <Route path="/world-books" element={<WorldBooksPage />} />
            <Route path="/moments" element={<MomentsPage />} />
            <Route path="/music" element={<MusicPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="/chats/:id" element={<ChatRoomPage />} />
          <Route path="/characters/:id" element={<CharacterProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
