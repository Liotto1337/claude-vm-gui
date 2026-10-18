// Подсказки внизу меню Claude Code: запрос разрешения, «доверять папке?», выбор варианта, онбординг.
// Обычное поле ввода показывает «? for shortcuts», а во время работы — «esc to interrupt».
const DIALOG_FOOTER = /Enter to confirm|Esc to cancel|Enter to select|Esc to exit|Press Enter to continue/i;

/** Открыто ли меню: подсказка есть среди последних 12 непустых строк экрана. */
export function dialogOpen(paneText: string): boolean {
  const tail = paneText.split('\n').filter((l) => l.trim() !== '').slice(-12).join('\n');
  return DIALOG_FOOTER.test(tail);
}
