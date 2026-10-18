import { useState } from 'react';
import { useAppState } from '../state';
import { Banner } from './Banner';
import { NewSessionDialog } from './NewSessionDialog';
import { SessionHeader } from './SessionHeader';
import { Sidebar } from './Sidebar';
import { TerminalView } from './TerminalView';

export function MainView() {
  const { sessions, current } = useAppState();
  const [newSession, setNewSession] = useState(false);
  const session = sessions.find((s) => s.name === current) ?? null;

  return (
    <div className="main-layout">
      <Sidebar onNewSession={() => setNewSession(true)} />
      <main className="main-column">
        <Banner />
        {session ? (
          <>
            <SessionHeader session={session} />
            <TerminalView key={session.name} name={session.name} />
          </>
        ) : current ? (
          <>
            <div className="session-header" />
            <TerminalView key={current} name={current} />
          </>
        ) : (
          <div className="empty-state">Выберите сессию слева или создайте новую</div>
        )}
      </main>
      {newSession ? <NewSessionDialog onClose={() => setNewSession(false)} /> : null}
    </div>
  );
}
