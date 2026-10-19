// Иконки — inline SVG с цветом текста (currentColor)
const base = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const IconCheck = ({ label }: { label?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...base} stroke="var(--ok)" strokeWidth="2.2" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const IconCross = ({ label }: { label?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...base} stroke="var(--danger)" strokeWidth="2.2" role="img" aria-label={label ?? 'Ошибка'}>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
);
export const IconWarn = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...base} stroke="var(--warn)" strokeWidth="2.2" role="img" aria-label="Предупреждение">
    <path d="M12 8v5" />
    <path d="M12 16.5v.5" />
    <path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </svg>
);
export const IconSpinner = () => (
  <svg className="spin" width="20" height="20" viewBox="0 0 24 24" {...base} stroke="var(--accent)" strokeWidth="2.2" role="img" aria-label="Выполняется">
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);
export const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeWidth="2" aria-hidden="true">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);
export const IconClose = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth="2" aria-hidden="true">
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);
export const IconGear = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z" />
  </svg>
);
export const IconClip = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeWidth="1.8" aria-hidden="true">
    <path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />
  </svg>
);
export const IconArrowUp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeWidth="2.2" aria-hidden="true">
    <path d="M12 19V5" />
    <path d="M5 12l7-7 7 7" />
  </svg>
);
export const IconChevron = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" {...base} strokeWidth="2" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const IconImage = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} strokeWidth="1.8" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="M21 17l-5-5-9 8" />
  </svg>
);
export const IconPin = ({ label, size = 13 }: { label?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth="2" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z" />
    <path d="M12 15v5" />
  </svg>
);
export const IconChevronRight = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth="2.2" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const IconChevronLeft = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth="2.2" aria-hidden="true">
    <path d="M15 6l-6 6 6 6" />
  </svg>
);
export const IconFolder = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...base} strokeWidth="2" aria-hidden="true">
    <path d="M3 7h6l2 2h10v10H3z" />
  </svg>
);
export const IconPulse = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeWidth="1.8" aria-hidden="true">
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </svg>
);
