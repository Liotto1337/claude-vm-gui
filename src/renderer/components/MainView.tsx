import { useAppState } from '../state';
import { Logo } from './Logo';

/** Главное окно. Наполняется в Task 9 (список сессий, шапка, терминал) и Task 10 (поле ввода). */
export function MainView() {
  const { sessions } = useAppState();
  return (
    <div className="main-layout">
      <nav aria-label="Сессии" className="sidebar">
        <div className="brand">
          <Logo />
          <span>Claude VM</span>
        </div>
        <ul>
          {sessions.map((s) => (
            <li key={s.name}>{s.name}</li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
