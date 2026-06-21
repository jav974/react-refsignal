// Fixed bottom-right demo switcher. Renders one `<a href="#hash">` per item;
// `active` gets the accent fill. Items come from the demo registry (passed in
// rather than imported, so this stays a leaf component with no cycle).

import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { color, font } from '../theme';

export interface NavItem {
  hash: string;
  label: string;
}

export function DemoNav({
  items,
  active,
}: {
  items: NavItem[];
  active: string;
}) {
  const navRef = useRef<HTMLElement>(null);

  // Publish the nav's height as a CSS var so demos can park bottom-anchored
  // panels above it (mirrors --refsignal-devtools-height from the devtools
  // dock). Re-measured on resize in case the row reflows.
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty(
        '--demo-nav-height',
        `${el.offsetHeight}px`,
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--demo-nav-height');
    };
  }, []);

  return (
    <nav ref={navRef} style={navStyle}>
      {items.map((item) => (
        <a
          key={item.hash}
          href={`#${item.hash}`}
          style={navBtn(active === item.hash)}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

const navStyle: CSSProperties = {
  position: 'fixed',
  // Sit above the devtools dock when present; degrade to plain 12px bottom
  // when the var isn't set (overlay unmounted or prod build).
  bottom: 'calc(var(--refsignal-devtools-height, 0px) + 12px)',
  right: 12,
  zIndex: 100,
  display: 'flex',
  gap: 4,
  padding: 4,
  background: 'rgba(0,0,0,0.65)',
  backdropFilter: 'blur(6px)',
  borderRadius: 6,
  boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
  fontFamily: font.sans,
  fontSize: 12,
};

function navBtn(active: boolean): CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 4,
    background: active ? color.accent : 'transparent',
    color: active ? '#fff' : color.muted,
    textDecoration: 'none',
    fontWeight: 600,
  };
}
