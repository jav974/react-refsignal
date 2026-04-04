export interface Transport {
  post(message: unknown): void;
  /** Returns a cleanup function. */
  listen(callback: (message: unknown) => void): () => void;
}

function nativeTransport(channel: string): Transport {
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

function localStorageTransport(channel: string): Transport {
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

export function resolveTransport(channel: string): Transport {
  return typeof BroadcastChannel !== 'undefined'
    ? nativeTransport(channel)
    : localStorageTransport(channel);
}
