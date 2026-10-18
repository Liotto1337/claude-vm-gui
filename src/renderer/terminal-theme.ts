import type { ITheme } from '@xterm/xterm';

/** Палитра ANSI под фон темы: в светлой теме терминал светлый, как панели claude.ai. */
export function terminalTheme(t: 'light' | 'dark'): ITheme {
  if (t === 'light') {
    return {
      background: '#ffffff', foreground: '#262624', cursor: '#c6613f', cursorAccent: '#ffffff',
      selectionBackground: 'rgba(217, 119, 87, 0.25)',
      black: '#141413', red: '#b53333', green: '#558a42', yellow: '#a86b1f', blue: '#2a78d6', magenta: '#a64d87', cyan: '#2e9191', white: '#73726c',
      brightBlack: '#87867f', brightRed: '#c6613f', brightGreen: '#5f9a4a', brightYellow: '#c9a82d', brightBlue: '#6a9bcc', brightMagenta: '#c46686', brightCyan: '#3aa3a3', brightWhite: '#b0aea5',
    };
  }
  return {
    background: '#1f1e1d', foreground: '#e8e6dc', cursor: '#d97757', cursorAccent: '#1f1e1d',
    selectionBackground: 'rgba(217, 119, 87, 0.3)',
    black: '#30302e', red: '#e07a6b', green: '#7faf6a', yellow: '#d9a05b', blue: '#6a9bcc', magenta: '#c46686', cyan: '#5fb3b3', white: '#c2c0b6',
    brightBlack: '#73726c', brightRed: '#eb8f7f', brightGreen: '#9cc788', brightYellow: '#e6bb74', brightBlue: '#8fb5dd', brightMagenta: '#d98aa6', brightCyan: '#7fcaca', brightWhite: '#faf9f5',
  };
}
