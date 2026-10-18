import { connect, useAppState } from '../state';

/** Плашка при обрыве связи. Пропадает сама, когда соединение восстановлено. */
export function Banner() {
  const { connection } = useAppState();
  if (connection.state === 'reconnecting') {
    return (
      <div className="banner" role="status">
        Связь потеряна. Переподключаюсь… <span className="caption">попытка {connection.attempt ?? 1}</span>
      </div>
    );
  }
  if (connection.state === 'failed') {
    return (
      <div className="banner banner-error" role="alert">
        Связь потеряна.
        <button type="button" className="btn btn-sm" onClick={() => void connect()}>Подключиться снова</button>
      </div>
    );
  }
  return null;
}
