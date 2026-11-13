import { useEffect, useState } from 'react';
import { BugReportDialog } from './components/BugReportDialog';
import { ConnectScreen } from './components/ConnectScreen';
import { HostKeyDialog } from './components/HostKeyDialog';
import { MainView } from './components/MainView';
import { SettingsDialog } from './components/SettingsDialog';
import { init, useAppState } from './state';

export function App() {
  const [reportOpen, setReportOpen] = useState(false);
  const openReport = () => setReportOpen(true);
  const { view, hostKey } = useAppState();
  useEffect(() => {
    void init();
  }, []);

  return (
    <>
      {view === 'main' ? <MainView onReport={openReport} /> : null}
      {view === 'connect' || view === 'settings' ? <ConnectScreen onReport={openReport} /> : null}
      {view === 'settings' ? <SettingsDialog onReport={openReport} /> : null}
      {hostKey ? <HostKeyDialog prompt={hostKey} /> : null}
      {reportOpen ? <BugReportDialog onClose={() => setReportOpen(false)} /> : null}
    </>
  );
}
