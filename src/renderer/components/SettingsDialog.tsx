import { useState, type FormEvent } from 'react';
import type { VmConfig } from '@shared/ipc';
import { passwordToSave, type PasswordMode } from '../settings-password';
import { connect, getState, previewTheme, saveConfig, setState, useAppState } from '../state';

const DEFAULTS: VmConfig = { host: '', port: 22, username: 'root', keyPath: '~/.ssh/id_ed25519', theme: 'system' };

export function SettingsDialog({ onClose }: { onClose?: () => void }) {
  const { config } = useAppState();
  const [form, setForm] = useState<VmConfig>(config ?? DEFAULTS);
  const [portText, setPortText] = useState(String((config ?? DEFAULTS).port));
  const [error, setError] = useState<string | null>(null);
  const [pwdMode, setPwdMode] = useState<PasswordMode>(config?.hasPassword ? 'saved' : 'edit');
  const [password, setPassword] = useState('');
  const set = (patch: Partial<VmConfig>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = { ...form, port: Number(portText) };
    const pwd = passwordToSave(pwdMode, password, config?.passwordUnreadable === true);
    const err = await saveConfig(next, pwd);
    setError(err);
    if (!err) void connect();
  };

  const cancel = () => {
    previewTheme(getState().config?.theme ?? 'system');
    if (onClose) onClose();
    else if (getState().config) setState({ view: 'connect' });
  };

  return (
    <div className="overlay">
      <form role="dialog" aria-modal="true" aria-labelledby="settings-title" className="dialog" onSubmit={(e) => void submit(e)}>
        <h2 id="settings-title">Настройки подключения</h2>
        <div className="field">
          <label htmlFor="set-host">Адрес ВМ</label>
          <input id="set-host" value={form.host} autoFocus placeholder="203.0.113.10" onChange={(e) => set({ host: e.target.value })} />
        </div>
        <div className="row gap-12">
          <div className="field grow">
            <label htmlFor="set-user">Пользователь</label>
            <input id="set-user" value={form.username} onChange={(e) => set({ username: e.target.value })} />
          </div>
          <div className="field port">
            <label htmlFor="set-port">Порт</label>
            <input id="set-port" inputMode="numeric" value={portText} onChange={(e) => setPortText(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="set-key">Путь к SSH-ключу</label>
          <input id="set-key" className="mono" value={form.keyPath} onChange={(e) => set({ keyPath: e.target.value })} />
          <span className="hint">Не нужен, если задан пароль. Если ключ защищён паролем, приложение возьмёт его из ssh-agent Windows</span>
        </div>
        {pwdMode === 'saved' ? (
          <div className="field">
            <span className="label-like">Пароль</span>
            <div className="row gap-8">
              <span className="grow">Пароль сохранён</span>
              <button type="button" className="btn" onClick={() => setPwdMode('edit')}>Изменить пароль</button>
              <button type="button" className="btn" onClick={() => setPwdMode('deleted')}>Удалить пароль</button>
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="set-password">Пароль (необязательно)</label>
            <input
              id="set-password"
              type="password"
              autoComplete="off"
              value={password}
              placeholder={pwdMode === 'deleted' ? 'Сохранённый пароль будет удалён' : ''}
              onChange={(e) => setPassword(e.target.value)}
            />
            {config?.passwordUnreadable && pwdMode === 'edit' ? (
              <span className="hint hint-error">
                Сохранённый пароль не удалось расшифровать — например, приложение запущено под другой учётной записью Windows. Введите пароль заново или оставьте поле пустым, чтобы удалить его
              </span>
            ) : (
              <span className="hint">Хранится зашифрованным средствами Windows. Пусто — вход по ключу</span>
            )}
          </div>
        )}
        <div className="field">
          <label htmlFor="set-theme">Тема</label>
          <select
            id="set-theme"
            value={form.theme}
            onChange={(e) => {
              const theme = e.target.value as VmConfig['theme'];
              set({ theme });
              previewTheme(theme);
            }}
          >
            <option value="system">Как в Windows</option>
            <option value="light">Светлая</option>
            <option value="dark">Тёмная</option>
          </select>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="row end gap-8">
          {config ? <button type="button" className="btn" onClick={cancel}>Отмена</button> : null}
          <button type="submit" className="btn btn-dark">Сохранить и подключиться</button>
        </div>
      </form>
    </div>
  );
}
