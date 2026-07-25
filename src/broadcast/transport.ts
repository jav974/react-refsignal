export interface Transport {
  post(message: unknown): void;
  /** Returns a cleanup function. */
  listen(callback: (message: unknown) => void): () => void;
}

/** Default wire — structured clone semantics, delivered to every same-origin
 * context listening on `channel` except the posting one. */
export function nativeTransport(channel: string): Transport {
  const bc = new BroadcastChannel(channel);
  return {
    post: (msg) => {
      bc.postMessage(msg);
    },
    listen: (cb) => {
      bc.onmessage = (e: MessageEvent) => {
        cb(e.data);
      };
      return () => {
        bc.close();
      };
    },
  };
}

/**
 * Legacy fallback transport for environments without `BroadcastChannel`
 * (browsers older than ~2022). Pass it explicitly via the `transport` option.
 *
 * Wire format is JSON — unlike the default transport it does NOT structured
 * clone, so `Blob`/`Map`/`Set`/`Date` values will not survive. Same-origin,
 * window contexts only (workers have no `localStorage`).
 */
export function localStorageTransport(channel: string): Transport {
  const key = `__bc__${channel}`;
  return {
    post: (msg) => {
      try {
        localStorage.setItem(key, JSON.stringify(msg));
      } catch {
        // storage full or unavailable — silently skip
      }
    },
    listen: (cb) => {
      const handler = (e: StorageEvent) => {
        if (e.key !== key || !e.newValue) return;
        try {
          cb(JSON.parse(e.newValue));
        } catch {
          // corrupt message — ignore
        }
      };
      window.addEventListener('storage', handler);
      return () => {
        window.removeEventListener('storage', handler);
      };
    },
  };
}
