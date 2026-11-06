import type { Pin } from '../pins';
import { preview } from '../pins';

const MAX_SEGMENTS = 4;

/**
 * Панель закреплённого под шапкой (как в Telegram): слева полоска из сегментов — положение среди закреплённых,
 * справа заголовок и начало текста. Нажатие — к сообщению (onJump), панель переходит к предыдущему закреплённому.
 */
export function PinBar({ pins, active, onJump }: { pins: Pin[]; active: string; onJump: (id: string) => void }) {
  const index = Math.max(0, pins.findIndex((p) => p.id === active));
  const pin = pins[index];
  if (!pin) return null;
  // Сегментов не больше MAX_SEGMENTS: окно вокруг активного
  const count = Math.min(pins.length, MAX_SEGMENTS);
  const start = Math.min(Math.max(0, index - Math.floor(count / 2)), pins.length - count);
  const title = pins.length > 1 ? `Закреплённое сообщение #${index + 1} из ${pins.length}` : 'Закреплённое сообщение';
  return (
    <button type="button" className="pin-bar" aria-label={`${title}: ${pin.text}`} onClick={() => onJump(pin.id)}>
      <span className="pin-segments" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={start + i === index ? 'pin-seg is-active' : 'pin-seg'} />
        ))}
      </span>
      <span className="pin-text">
        <span className="pin-title">{title}</span>
        <span className="pin-preview ellipsis">{preview(pin.text)}</span>
      </span>
    </button>
  );
}
