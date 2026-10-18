import { useEffect } from 'react';
import { ConnectScreen } from './components/ConnectScreen';
import { HostKeyDialog } from './components/HostKeyDialog';
import { MainView } from './components/MainView';
import { SettingsDialog } from './components/SettingsDialog';
import { init, useAppState } from './state';

export function App() {
  const { view, hostKey } = useAppState();
  useEffect(() => {
    void init();
  }, []);

  return (
    <>
      {view === 'main' ? <MainView /> : null}
      {view === 'connect' || view === 'settings' ? <ConnectScreen /> : null}
      {view === 'settings' ? <SettingsDialog /> : null}
      {hostKey ? <HostKeyDialog prompt={hostKey} /> : null}
    </>
  );
}
