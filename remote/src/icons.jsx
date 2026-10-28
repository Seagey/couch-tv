// One stroke icon set, 24 grid, 2px round strokes (the SF Symbols weight the rest of iOS uses).
const I = ({ d, children, size = 22, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {d ? <path d={d} /> : children}
  </svg>
);

export const Power = (p) => <I d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0" {...p} />;
export const Back = (p) => <I d="M15 5l-7 7 7 7" {...p} />;
export const Home = (p) => <I d="M4 10.5 12 4l8 6.5V20h-5.5v-6h-5v6H4z" {...p} />;
export const Minus = (p) => <I d="M5 12h14" {...p} />;
export const Plus = (p) => <I d="M5 12h14M12 5v14" {...p} />;
export const Chevron = (p) => <I d="M6 15l6-6 6 6" {...p} />;
export const Mic = (p) => <I {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></I>;
export const Pause = (p) => <I {...p} strokeWidth="2.6"><path d="M9 6v12M15 6v12" /></I>;
export const PlayPause = (p) => <I {...p}><path d="M4 6.5v11l7.5-5.5z" fill="currentColor" /><path d="M15 7v10M19.5 7v10" strokeWidth="2.4" /></I>;
export const Play = (p) => <I {...p}><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></I>;
export const Replay = (p) => <I {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /><text x="12" y="15.2" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="-apple-system,system-ui">10</text></I>;
export const Forward = (p) => <I {...p}><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4v4h-4" /><text x="12" y="15.2" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="-apple-system,system-ui">10</text></I>;
export const Prev = (p) => <I {...p}><path d="M6 5v14" /><path d="M19 5.5v13L9 12z" fill="currentColor" /></I>;
export const Next = (p) => <I {...p}><path d="M18 5v14" /><path d="M5 5.5v13L15 12z" fill="currentColor" /></I>;
export const Speaker = (p) => <I d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" {...p} />;
export const Muted = (p) => <I {...p}><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></I>;
export const More = (p) => <I {...p}><circle cx="5.5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" /></I>;
export const Remote = (p) => <I {...p}><rect x="6" y="2.5" width="12" height="19" rx="5" /><circle cx="12" cy="8.5" r="2.5" /><path d="M12 15v2" /></I>;
export const Grid = (p) => <I {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></I>;
export const Moon = (p) => <I d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" {...p} />;
export const Globe = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.8 2.6 4 5.6 4 9s-1.2 6.4-4 9c-2.8-2.6-4-5.6-4-9s1.2-6.4 4-9z" /></I>;
export const Keyboard = (p) => <I {...p}><rect x="2.5" y="6" width="19" height="12" rx="3" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9" /></I>;
export const Captions = (p) => <I {...p}><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M10 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6" /></I>;
export const Input = (p) => <I {...p}><rect x="2.5" y="4" width="19" height="13" rx="2.5" /><path d="M8 21h8M12 7.5v6M9.5 11l2.5 2.5 2.5-2.5" /></I>;
export const Screen = (p) => <I {...p}><rect x="2.5" y="4" width="19" height="13" rx="2.5" /><path d="M8 21h8M12 17v4" /></I>;
export const Gear = (p) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></I>;
export const Close = (p) => <I d="M6 6l12 12M18 6 6 18" {...p} />;
export const Grip = (p) => <I d="M5 9h14M5 15h14" {...p} />;
export const Send = (p) => <I d="M12 19V5M6 11l6-6 6 6" {...p} />;
export const Wifi = (p) => <I {...p}><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.2a10 10 0 0 1 13 0M9 15.8a5 5 0 0 1 6 0" /><circle cx="12" cy="19" r="1" fill="currentColor" /></I>;
export const Sparkle = (p) => <I d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" {...p} />;
export const People = (p) => <I {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 19.5a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.6" /><path d="M15.5 14.2a5 5 0 0 1 5.5 4.8" /></I>;
