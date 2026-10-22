import { useEffect, useState } from 'react';
import type { UpdateInfo } from '@shared/ipc';
import { api } from '../api';

/** «Доступно обновление»: нажатие открывает страницу релиза, крестик скрывает баннер для этой версии. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([api.updates.get(), api.updates.dismissed()]).then(([u, d]) => {
      if (!alive) return;
      setDismissed(d);
      if (u) setUpdate(u);
    });
    const off = api.updates.onAvailable((u) => setUpdate(u));
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!update || update.version === dismissed) return null;
  return (
    <div className="banner banner-update" role="status">
      <button type="button" className="banner-update-link" onClick={() => api.links.open(update.url)}>
        Доступно обновление {update.version}
      </button>
      <button
        type="button"
        className="banner-close"
        aria-label="Закрыть"
        onClick={() => {
          setDismissed(update.version);
          void api.updates.dismiss(update.version);
        }}
      >
        ✕
      </button>
    </div>
  );
}
