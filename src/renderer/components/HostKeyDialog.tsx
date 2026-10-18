import type { HostKeyPrompt } from '@shared/ipc';
import { answerHostKey } from '../state';

export function HostKeyDialog({ prompt }: { prompt: HostKeyPrompt }) {
  const target = prompt.port === 22 ? prompt.host : `${prompt.host}:${prompt.port}`;
  return (
    <div className="overlay">
      <div role="dialog" aria-modal="true" aria-labelledby="hk-title" className="dialog">
        <h2 id="hk-title">Новый сервер</h2>
        <p>
          Приложение ещё не подключалось к <span className="mono">{target}</span>. Сверьте отпечаток ключа сервера с тем, что
          показывает <span className="mono">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</span> на ВМ.
        </p>
        <p className="fingerprint mono">{prompt.fingerprint}</p>
        <p className="hint">Если доверяете, ключ запишется в known_hosts и больше спрашивать не будем.</p>
        <div className="row end gap-8">
          <button type="button" className="btn" onClick={() => answerHostKey(false)}>Отмена</button>
          <button type="button" className="btn btn-dark" autoFocus onClick={() => answerHostKey(true)}>Доверять</button>
        </div>
      </div>
    </div>
  );
}
