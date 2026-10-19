import { useState } from 'react';
import { useAppState } from '../state';
import { viewMode } from '../view-mode';
import { Banner } from './Banner';
import { ChatView } from './ChatView';
import { Composer } from './Composer';
import { NewSessionDialog } from './NewSessionDialog';
import { SessionHeader } from './SessionHeader';
import { ServerPanel } from './ServerPanel';
import { Sidebar } from './Sidebar';
import { TerminalView } from './TerminalView';

export function MainView() {
  const { sessions, current, chat, viewOverride, serverOpen } = useAppState();
  const [newSession, setNewSession] = useState(false);
  const session = sessions.find((s) => s.name === current) ?? null;
  const c = session ? chat[session.name] : undefined;
  // Пока claude работает — лента; терминал — без claude, на незнакомом экране или по выбору
  const mode = session
    ? viewMode({ claudeRunning: session.claudeRunning, screen: c?.screen ?? null, unavailable: !!c?.unavailable, override: viewOverride })
    : 'terminal';
  const menu = mode === 'chat' && c?.screen?.kind === 'menu' ? c.screen.menu : null;

  return (
    <div className="main-layout">
      <Sidebar onNewSession={() => setNewSession(true)} />
      <main className="main-column">
        <Banner />
        {session ? (
          <>
            <SessionHeader session={session} mode={mode} />
            {session.claudeRunning && c?.unavailable ? (
              <div className="banner" role="status">Не удалось прочитать переписку — показан терминал</div>
            ) : null}
            <div className="view-stack">
              <TerminalView key={session.name} name={session.name} hidden={mode === 'chat'} />
              {mode === 'chat' ? <ChatView session={session.name} /> : null}
            </div>
            <Composer key={`c-${session.name}`} session={session} menu={menu} working={!!c?.busy} chatMode={mode === 'chat'} />
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
      {serverOpen ? <ServerPanel /> : null}
      {newSession ? <NewSessionDialog onClose={() => setNewSession(false)} /> : null}
    </div>
  );
}
