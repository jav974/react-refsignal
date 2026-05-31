import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DevToolsOverlay } from './overlay/DevToolsOverlay';

export {
  configureDevTools,
  devtools,
  type CascadeEdge,
  type DevToolsConfig,
  type PulseSample,
  type PulseState,
  type SignalEntry,
  type SignalUpdate,
} from './adapter';
export { DevToolsOverlay } from './overlay/DevToolsOverlay';
export type { DevToolsAdapter, DevToolsEvent } from '../refsignal';

export interface MountOptions {
  /** Container element. Defaults to a fresh `<div>` appended to `document.body`. */
  container?: HTMLElement;
}

const isProd = (): boolean =>
  typeof process !== 'undefined' && process.env.NODE_ENV === 'production';

let mountedRoot: Root | null = null;
let mountedContainer: HTMLElement | null = null;
let ownsContainer = false;

/**
 * Mounts the in-page devtools overlay. Returns a cleanup function. Safe to
 * leave uncondtionally in your app entry — no-ops in production (so the
 * overlay never ships to end users even if the import isn't gated).
 *
 * @example
 * import { mountDevTools } from 'react-refsignal/devtools';
 * mountDevTools();
 */
export function mountDevTools(options: MountOptions = {}): () => void {
  if (isProd() || typeof document === 'undefined') {
    return () => {
      /* no-op */
    };
  }
  if (mountedRoot) {
    return () => {
      /* already mounted — no-op */
    };
  }

  const container = options.container ?? document.createElement('div');
  if (!options.container) {
    container.setAttribute('data-refsignal-devtools-host', '');
    document.body.appendChild(container);
    ownsContainer = true;
  }
  mountedContainer = container;

  const root = createRoot(container);
  root.render(createElement(DevToolsOverlay));
  mountedRoot = root;

  return () => {
    if (!mountedRoot) return;
    mountedRoot.unmount();
    mountedRoot = null;
    if (ownsContainer && mountedContainer?.parentNode) {
      mountedContainer.parentNode.removeChild(mountedContainer);
    }
    mountedContainer = null;
    ownsContainer = false;
  };
}
