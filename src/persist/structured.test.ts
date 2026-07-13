/**
 * @jest-environment node
 *
 * Structured-clone persistence (Blob/Date/Map/Set native on IndexedDB).
 *
 * `node` env on purpose: fake-indexeddb clones via the global `structuredClone`,
 * and only Node's native one preserves Blob/Date/Map (the jsdom setup polyfills
 * it with a Blob-destroying JSON round-trip). `instanceof` is unreliable across
 * jest realms, so type survival is asserted via `constructor.name` + behavior.
 */
import 'fake-indexeddb/auto';
import { createRefSignal, type RefSignal } from '../refsignal';
import { indexedDBStorage } from './idb';
import { setupPersist } from './persist';

/** Drain IndexedDB's multi-tick async (open → txn → request) plus microtasks. */
const flushIDB = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};

// ─── Adapter marker ────────────────────────────────────────────────────────────

describe('indexedDBStorage({ structured })', () => {
  it('marks the adapter structured when opted in', () => {
    expect(indexedDBStorage({ structured: true }).structured).toBe(true);
  });

  it('is not structured by default', () => {
    expect(indexedDBStorage().structured).toBeFalsy();
  });

  it('marks the SSR no-op adapter consistently', () => {
    const saved = (globalThis as { indexedDB?: unknown }).indexedDB;
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    try {
      expect(indexedDBStorage({ structured: true }).structured).toBe(true);
    } finally {
      (globalThis as { indexedDB?: unknown }).indexedDB = saved;
    }
  });

  it('stores structured values untouched (no JSON string) and reads them back', async () => {
    const idb = indexedDBStorage({
      dbName: 'struct-adapter',
      storeName: 's',
      structured: true,
    });
    await idb.set('k', { v: 1, data: { blob: new Blob(['hi']) } });
    const out = (await idb.get('k')) as { data: { blob: Blob } };
    expect(out.data.blob.constructor.name).toBe('Blob');
    expect(await out.data.blob.text()).toBe('hi');
  });
});

// ─── Store-level round-trip ─────────────────────────────────────────────────────

describe('structured persist — store-level round-trip', () => {
  type NoteStore = {
    attachment: RefSignal<Blob | null>;
    when: RefSignal<Date>;
    tags: RefSignal<Map<string, number>>;
  };

  const makeStore = (): NoteStore => ({
    attachment: createRefSignal<Blob | null>(null),
    when: createRefSignal(new Date(0)),
    tags: createRefSignal(new Map<string, number>()),
  });

  it('persists and re-hydrates Blob, Date and Map through IndexedDB', async () => {
    const config = {
      key: 'note',
      storage: 'indexeddb' as const,
      dbName: 'struct-store',
      storeName: 'p',
      structured: true,
    };

    // Write phase — populate a store and let it persist.
    const a = makeStore();
    const controllerA = setupPersist(a, config);
    await flushIDB(); // let hydrate (empty) settle before writing

    a.attachment.update(new Blob(['hello world'], { type: 'text/plain' }));
    a.when.update(new Date(1000));
    a.tags.update(new Map([['a', 1]]));
    await flushIDB();
    controllerA.cleanup();

    // Read phase — a fresh store hydrates from the same key.
    const b = makeStore();
    setupPersist(b, config);
    await flushIDB();

    expect(b.attachment.current?.constructor.name).toBe('Blob');
    expect(await b.attachment.current!.text()).toBe('hello world');
    expect(b.attachment.current!.type).toBe('text/plain');
    expect(b.when.current.constructor.name).toBe('Date');
    expect(b.when.current.getTime()).toBe(1000);
    expect(b.tags.current.constructor.name).toBe('Map');
    expect(b.tags.current.get('a')).toBe(1);
  });

  it('writes the envelope object (not a JSON string) to the backend', async () => {
    const store = { attachment: createRefSignal<Blob | null>(null) };
    setupPersist(store, {
      key: 'raw-check',
      storage: 'indexeddb',
      dbName: 'struct-raw',
      storeName: 'p',
      structured: true,
    });
    await flushIDB();
    store.attachment.update(new Blob(['bytes']));
    await flushIDB();

    // Read the raw stored value with a plain (non-persist) adapter.
    const raw = await indexedDBStorage({
      dbName: 'struct-raw',
      storeName: 'p',
    }).get('raw-check');
    expect(typeof raw).not.toBe('string');
    expect((raw as { v: number }).v).toBe(1);
    expect(
      (raw as { data: { attachment: Blob } }).data.attachment.constructor.name,
    ).toBe('Blob');
  });
});

// ─── Signal-level round-trip ─────────────────────────────────────────────────────

describe('structured persist — signal-level', () => {
  it('re-hydrates a Blob-valued signal from a fresh signal', async () => {
    const persist = {
      key: 'sig-blob',
      storage: 'indexeddb' as const,
      dbName: 'struct-sig',
      storeName: 'p',
      structured: true,
    };

    const a = createRefSignal<Blob | null>(null, { persist });
    await flushIDB();
    a.update(new Blob(['voice'], { type: 'audio/webm' }));
    await flushIDB();

    const b = createRefSignal<Blob | null>(null, { persist });
    await flushIDB();
    expect(b.current?.constructor.name).toBe('Blob');
    expect(await b.current!.text()).toBe('voice');
    expect(b.current!.type).toBe('audio/webm');
  });
});

// ─── Guards ──────────────────────────────────────────────────────────────────

describe('structured persist — guards', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('warns when structured is requested on a string backend (localStorage)', () => {
    const store = { count: createRefSignal(0) };
    // The resolve-time guard fires before any storage access. Cast past the
    // type error to exercise the runtime guard a plain-JS caller would hit.
    setupPersist(store, {
      key: 'g1',
      ...({ storage: 'local', structured: true } as { storage: 'local' }),
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no effect on localStorage'),
    );
  });

  it('warns and ignores a custom serialize when the backend is structured', async () => {
    const serialize = jest.fn((v: unknown) => JSON.stringify(v));
    const store = { count: createRefSignal(0) };
    setupPersist(store, {
      key: 'g2',
      storage: 'indexeddb',
      dbName: 'struct-guard',
      storeName: 'p',
      structured: true,
      serialize,
    });
    await flushIDB();
    store.count.update(5);
    await flushIDB();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('`serialize`/`deserialize` are ignored'),
    );
    expect(serialize).not.toHaveBeenCalled();
  });
});
