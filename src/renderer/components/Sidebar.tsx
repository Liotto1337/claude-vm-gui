import { displayHost, openSettings, setServerOpen, useAppState } from '../state';
import { IconGear, IconPlus, IconPulse } from './icons';
import { Logo } from './Logo';
import { SessionList } from './SessionList';

export function Sidebar({ onNewSession }: { onNewSession: () => void }) {
  const { config, connection, serverOpen } = useAppState();
  const online = connection.state === 'connected';
  return (
    <nav aria-label="Сессии" className="sidebar">
      <div className="brand">
        <Logo />
        <span>Claude VM</span>
      </div>
      <div className="conn-chip" title={online ? 'Подключено' : 'Нет связи'}>
        <span className={online ? 'dot dot-ok' : 'dot dot-warn'} aria-hidden="true" />
        <span className="grow ellipsis">{config ? `${config.username}@${displayHost(config.host)}` : ''}</span>
        {online && connection.pingMs != null ? <span className="caption">{connection.pingMs} мс</span> : null}
      </div>
      <button type="button" className="btn new-session" onClick={onNewSession}>
        <IconPlus />
        Новая сессия
      </button>
      <SessionList />
      <div className="sidebar-foot">
        <button type="button" className="btn-ghost server-btn" aria-pressed={serverOpen} onClick={() => setServerOpen(!serverOpen)}>
          <IconPulse />
          Сервер
        </button>
        <button type="button" className="btn-ghost settings-btn" onClick={openSettings}>
          <IconGear />
          Настройки подключения
        </button>
      </div>
    </nav>
  );
}
