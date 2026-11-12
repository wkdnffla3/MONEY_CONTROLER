const base = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' };

export const LogoIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth="2.2" {...base} aria-hidden="true">
    <path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14l-3-2-3 2-2-2-2 2-3-2z" />
    <path d="M9 8h6M9 12h6" />
  </svg>
);
export const ChevronLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="2.2" {...base} aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
);
export const ChevronRight = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="2.2" {...base} aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
);
export const PlusIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" strokeWidth="2.5" {...base} aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
export const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="2.2" {...base} aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" strokeWidth="2.2" {...base} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
