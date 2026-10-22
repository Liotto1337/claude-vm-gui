import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ExitReason } from '@shared/ipc';
import { parseOsc52 } from '@shared/osc52';
import { api } from '../api';
import { noteTerminalInput, refreshSessions, useAppState } from '../state';
import { terminalTheme } from '../terminal-theme';

const EXIT_TEXT: Record<Exclude<ExitReason, 'connection-lost'>, string> = {
  killed: 'Сессия завершена',
  detached: 'Отключено от сессии',
};

/** xterm.js, привязанный к PTY-каналу `tmux attach` выбранной сессии. */
/** hidden — показана лента: терминал остаётся в разметке (размер PTY не меняется), но невидим. */
export function TerminalView({ name, hidden = false }: { name: string; hidden?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const { theme } = useAppState();
  const [exit, setExit] = useState<Exclude<ExitReason, 'connection-lost'> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setExit(null);
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: false,
      theme: terminalTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;
    fit.fit();

    const copySelection = () => {
      const text = term.getSelection();
      if (!text) return false;
      api.clipboard.write(text);
      return true;
    };
    const pasteClipboard = () => {
      void api.clipboard.read().then((t) => t && term.paste(t)).catch(() => undefined);
    };
    // Выделение мышью в Claude Code и копирование в tmux приходят как OSC 52 — кладём текст в буфер Windows
    const osc52 = term.parser.registerOscHandler(52, (data) => {
      const text = parseOsc52(data);
      if (text) api.clipboard.write(text);
      return true;
    });
    // Claude Code включает отслеживание всех движений мыши; xterm.js считает их вводом и снимает
    // выделение (Shift+мышь) при первом же движении. Пока выделение есть, движение без кнопок не передаём.
    const keepSelection = (e: MouseEvent) => {
      if (e.buttons === 0 && term.hasSelection()) e.stopPropagation();
    };
    el.addEventListener('mousemove', keepSelection, true);
    // Ctrl+C копирует, когда есть выделение (иначе это прерывание для claude); Ctrl+Shift+C/V — всегда.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true;
      const key = e.key.toLowerCase();
      if (key === 'c' && (e.shiftKey || term.hasSelection())) {
        copySelection();
        return false;
      }
      if (key === 'v' && e.shiftKey) {
        pasteClipboard();
        return false;
      }
      return true;
    });
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      if (!copySelection()) pasteClipboard();
    };
    el.addEventListener('contextmenu', onContext);

    const offData = api.term.onData((d) => term.write(d));
    const offExit = api.term.onExit((reason) => {
      if (reason === 'connection-lost') return;
      setExit(reason);
      void refreshSessions();
    });
    const input = term.onData((d) => {
      noteTerminalInput(name, d);
      api.term.write(d);
    });
    void api.term.open(name, term.cols, term.rows).then((r) => {
      if (!r.ok) setExit('killed');
      else if (!hiddenRef.current) term.focus();
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      api.term.resize(term.cols, term.rows);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      el.removeEventListener('contextmenu', onContext);
      el.removeEventListener('mousemove', keepSelection, true);
      osc52.dispose();
      input.dispose();
      offData();
      offExit();
      term.dispose();
      termRef.current = null;
    };
  }, [name, attempt]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme(theme);
  }, [theme]);

  // Спрятан под ленту — фокус из терминала в поле ввода, иначе нажатия ушли бы в невидимый терминал.
  // Снова видим — подогнать размер и отдать фокус
  useEffect(() => {
    if (hidden) {
      const a = document.activeElement;
      if (!a || a === document.body || host.current?.contains(a)) {
        termRef.current?.blur();
        document.getElementById('composer-input')?.focus();
      }
      return;
    }
    if (!termRef.current) return;
    fitRef.current?.fit();
    api.term.resize(termRef.current.cols, termRef.current.rows);
    termRef.current.focus();
  }, [hidden]);

  return (
    <section aria-label="Терминал" className={hidden ? 'terminal-card is-hidden' : 'terminal-card'} aria-hidden={hidden || undefined}>
      <div ref={host} className="terminal-host" />
      {exit ? (
        <div className="terminal-exit" role="status">
          <p>{EXIT_TEXT[exit]}</p>
          {exit === 'detached' ? (
            <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>Подключиться снова</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
