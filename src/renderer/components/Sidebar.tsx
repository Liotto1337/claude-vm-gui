import { openSession, openSettings, shortPath, useAppState } from '../state';
import { IconGear, IconPlus } from './icons';
import { Logo } from './Logo';

export function Sidebar({ onNewSession }: { onNewSession: () => void }) {
  const { config, connection, sessions, current } = useAppState();
  const online = connection.state === 'connected';
  return (
    <nav aria-label="Сессии" className="sidebar">
      <div className="brand">
        <Logo />
        <span>Claude VM</span>
      </div>
      <div className="conn-chip" title={online ? 'Подключено' : 'Нет связи'}>
        <span className={online ? 'dot dot-ok' : 'dot dot-warn'} aria-hidden="true" />
        <span className="grow ellipsis">{config ? `${config.username}@${config.host}` : ''}</span>
        {online && connection.pingMs != null ? <span className="caption">{connection.pingMs} мс</span> : null}
      </div>
      <button type="button" className="btn new-session" onClick={onNewSession}>
        <IconPlus />
        Новая сессия
      </button>
      <div className="caption section-label">Сессии tmux</div>
      <ul className="session-list">
        {sessions.map((s) => {
          // Своё подключение не считаем: метка — только если сессия открыта где-то ещё
          const others = s.attachedClients - (current === s.name ? 1 : 0);
          return (
            <li key={s.name}>
              <button
                type="button"
                className="session-item"
                aria-current={current === s.name ? 'page' : undefined}
                onClick={() => openSession(s.name)}
              >
                <span className="session-line">
                  <span className={s.claudeRunning ? 'dot dot-claude' : 'dot dot-idle'} aria-hidden="true" />
                  <span className="session-name ellipsis">{s.name}</span>
                  {others > 0 ? <span className="tag">открыта в cmd</span> : !s.claudeRunning ? <span className="caption">{s.command}</span> : null}
                </span>
                <span className="session-cwd ellipsis">{shortPath(s.cwd)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn-ghost settings-btn" onClick={openSettings}>
        <IconGear />
        Настройки подключения
      </button>
    </nav>
  );
}
