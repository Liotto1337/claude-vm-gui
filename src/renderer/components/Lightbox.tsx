import { useEffect, useRef } from 'react';

/** Картинка на весь экран: Esc, ✕ или нажатие на фон закрывают; фокус возвращается туда, откуда открыли. */
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => back?.focus();
  }, []);
  return (
    <div
      className="overlay lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <img src={src} alt={alt} />
      <button ref={close} type="button" className="icon-btn lightbox-close" aria-label="Закрыть" onClick={onClose}>✕</button>
    </div>
  );
}
