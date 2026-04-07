# Decision Tree

← [Back to README](../README.md) · [API Reference](api.md) · [Concepts](concepts.md) · [Patterns](patterns.md)

---

- [1. Signal Creation](#1-signal-creation)
- [2. Signal Updates](#2-signal-updates)
- [3. Reacting to Changes](#3-reacting-to-changes)
- [4. Rate Limiting](#4-rate-limiting)
- [5. Batching](#5-batching)
- [6. Derived Values](#6-derived-values)
- [7. Context / Shared State](#7-context--shared-state)
- [8. Persistence](#8-persistence)
- [9. Cross-tab Broadcast](#9-cross-tab-broadcast)

---

## 1. Signal Creation

```mermaid
flowchart TD
    Q1{"Where are you creating the signal?"}
    Q1 -->|Inside a React component| A["useRefSignal(initialValue, options?)"]
    Q1 -->|"Module scope / context factory / outside React"| B["createRefSignal(initialValue, options?)"]

    A & B --> Q2{"Transform, validate, or cancel incoming values?"}
    Q2 -->|Yes| C["interceptor: (incoming, current) => value | CANCEL"]
    Q2 -->|No| Q3

    Q3{"Prevent updates for semantically equal objects?"}
    Q3 -->|Yes| D["equal: (a, b) => boolean"]
    Q3 -->|No| E[Done]
```

---

## 2. Signal Updates

> **Critical:** `useRefSignalRender` watches `lastUpdated`. Only `update()` and `notifyUpdate()` increment it. `notify()` alone never triggers a re-render.

```mermaid
flowchart TD
    Q1{"How are you setting the new value?"}

    Q1 -->|"signal.update(value) — preferred"| A["Runs interceptor → checks equal/=== → sets .current\n→ bumps lastUpdated → notifies all subscribers"]

    Q1 -->|"signal.current = value — direct mutation"| Q2{"Do subscribers need notification?"}
    Q2 -->|No| B[Done — no notification sent]
    Q2 -->|Yes| Q3{"Should components re-render?"}
    Q3 -->|"Yes — value drives JSX"| C["signal.notifyUpdate()\nBumps lastUpdated + notifies\nuseRefSignalRender WILL re-render"]
    Q3 -->|"No — side effects only"| D["signal.notify()\nNotifies subscribers only\nlastUpdated unchanged\nuseRefSignalRender will NOT re-render"]

    Q1 -->|Restore to initial value| E["signal.reset()\nCalls update(initialValue) — respects interceptor and equal"]
```

---

## 3. Reacting to Changes

> Use `watch(signal, listener, options?)` instead of `subscribe`/`unsubscribe` pairs when outside React — it returns a cleanup function and supports the same timing and filter options as hooks.

```mermaid
flowchart TD
    Q1{"What should happen when the signal changes?"}

    Q1 -->|"JSX must reflect the value — trigger a re-render"| A["useRefSignalRender(deps, options?)"]
    Q1 -->|"Side effect: canvas, audio, logging, DOM mutation"| B["useRefSignalEffect(effect, deps, options?)"]
    Q1 -->|"Outside React — non-component code"| C["watch(signal, listener, options?) → cleanup fn"]

    A --> Q2{"In a context hook — want plain values + setters?"}
    Q2 -->|Yes| D["renderOn + unwrap: true"]
    Q2 -->|No| E["Read signal.current in JSX"]

    B --> Q3{"Should the effect run on mount?"}
    Q3 -->|"Yes — default"| F[Normal usage]
    Q3 -->|"No — react to changes only"| G["skipMount: true"]

    A & B & C --> Q4{"Gate the callback conditionally?"}
    Q4 -->|Yes| H["filter: () => boolean"]
    Q4 -->|No| I["Rate limit? → Section 4"]
```

---

## 4. Rate Limiting

Applies to `watch()`, `useRefSignalEffect`, `useRefSignalRender`, context hooks, persist, and broadcast. **Options are mutually exclusive** — combining them is a TypeScript error.

```mermaid
flowchart TD
    Q1{"Do you need to limit how often the effect or render fires?"}
    Q1 -->|No| A[No timing options needed]
    Q1 -->|"At most once per N ms — leading + trailing edge"| B["throttle: N"]
    Q1 -->|"Only after N ms of silence"| C["debounce: N"]
    C --> Q2{"Guarantee a flush even if signal keeps firing?"}
    Q2 -->|Yes| D["Add maxWait: N"]
    Q2 -->|No| E[Done]
    Q1 -->|"Sync to animation frame — collapse multiple fires per frame"| F["rAF: true"]
```

---

## 5. Batching

```mermaid
flowchart TD
    Q1{"Updating multiple signals and want a single notification burst?"}
    Q1 -->|No| A[No batch needed]
    Q1 -->|"Yes — all updates via signal.update()"| B["batch(fn)\nAuto-tracks .update() calls — recommended"]
    Q1 -->|"Yes — mutating .current directly or calling .notify() manually"| C["batch(fn, [sig1, sig2, ...])\nExplicit deps required"]
```

---

## 6. Derived Values

```mermaid
flowchart TD
    Q1{"Where do you need the derived value?"}

    Q1 -->|Inside a React component| A["useRefSignalMemo(factory, deps)\nTied to component lifetime\nDeps can mix signals and non-signals (props, state)"]
    Q1 -->|"Outside React — module scope, context factory"| B["createComputedSignal(compute, deps)\nDeps must be RefSignals\nReturns read-only ComputedSignal with .dispose()"]

    B --> Q2{"Created dynamically and discarded later?"}
    Q2 -->|Yes| C["Call .dispose() to unsubscribe from deps and allow GC"]
    Q2 -->|"No — app lifetime"| D[No cleanup needed]
```

---

## 7. Context / Shared State

```mermaid
flowchart TD
    Q1{"Scope of shared state?"}
    Q1 -->|"Global singleton — one instance for the whole app"| A["createRefSignalStore(factory)\nReturns the store directly — no Provider"]
    Q1 -->|"Per-subtree — isolated store per Provider mount"| Q2

    A --> B["useRefSignalStore(store, options?)\nConnect to a component with opt-in re-renders"]

    Q2{"Do you need custom logic in the Provider body?\n(typed props, useEffect, external subscriptions)"}
    Q2 -->|No| C["createRefSignalContext(name, factory)\nGenerates Provider + hook automatically"]
    Q2 -->|Yes| D["createRefSignalContextHook(name)\nReturns [Context, hook] — write your own Provider"]

    B & C & D --> Q3{"Should consumers re-render on signal changes?"}
    Q3 -->|"Never — read .current imperatively"| E["No renderOn"]
    Q3 -->|Specific signals| F["renderOn: ['key1', 'key2']"]
    Q3 -->|All signals| G["renderOn: ALL"]

    F & G --> Q4{"Want plain values + auto-generated setters instead of signal refs?"}
    Q4 -->|Yes| H["unwrap: true\nrequires renderOn — type error without it"]
    Q4 -->|No| I["Read signal.current in JSX"]
```

---

## 8. Persistence

> Activation: add `import 'react-refsignal/persist'` to your entry point. Safe to import in SSR environments.

```mermaid
flowchart TD
    Q1{"What scope?"}

    Q1 -->|Single signal| A["persist option in createRefSignal / useRefSignal\npersist: { key: 'myKey' }"]
    Q1 -->|Entire store| Q2{"Provider lifecycle?"}

    Q2 -->|"Factory — lives for app lifetime"| B["persist(factory, options) wrapper\npersist(() => ({ ... }), { key: 'x' })"]
    Q2 -->|Provider mounts and unmounts| C["usePersist(store, options)\nReturns { hydrated: RefSignal&lt;boolean&gt;, flush: () =&gt; void }"]

    A & B & C --> Q3{"Which storage backend?"}
    Q3 -->|Default| D["localStorage"]
    Q3 -->|Tab session only| E["storage: 'session'"]
    Q3 -->|"Large data / beyond localStorage limits"| F["storage: 'indexeddb'\nOptions: dbName, dbVersion, storeName"]
    Q3 -->|Custom backend| G["Implement PersistStorage\n{ get, set, remove } returning Promise"]

    A & B & C --> Q4{"Data shape may change across releases?"}
    Q4 -->|Yes| H["version: N\nmigrate: (storedData, storedVersion) => newData"]
    Q4 -->|No| Q5

    Q5{"High-frequency updates? Want to coalesce storage writes?"}
    Q5 -->|No| Q6
    Q5 -->|"At most once per N ms"| J["throttle: N"]
    Q5 -->|"After N ms of quiet"| K["debounce: N\n+ optional maxWait: N"]
    Q5 -->|"One write per animation frame"| L["rAF: true"]

    J & K & L --> Q6{"Need to guarantee write on unmount\n(pending timer would be cancelled)?"}
    Q6 -->|No| I[Done]
    Q6 -->|Yes| M["usePersist onUnmount: (_, flush) => flush()"]
    M --> I
```

---

## 9. Cross-tab Broadcast

> Activation: add `import 'react-refsignal/broadcast'` to your entry point. Safe to import in SSR environments.

```mermaid
flowchart TD
    Q1{"What scope?"}

    Q1 -->|Single signal| A["broadcast option in createRefSignal / useRefSignal\nbroadcast: 'channel-name'"]
    Q1 -->|Entire store| Q2{"Provider lifecycle?"}

    Q2 -->|"Factory — lives for app lifetime"| B["broadcast(factory, options) wrapper"]
    Q2 -->|Provider mounts and unmounts| C["useBroadcast(store, options)"]

    A & B & C --> Q3{"How should tabs coordinate?"}
    Q3 -->|"All tabs send and receive equally — default"| D["mode: 'many-to-many'"]
    Q3 -->|"One elected tab sends, others receive only"| E["mode: 'one-to-many'"]

    E --> Q4{"Need to react when this tab is elected broadcaster?"}
    Q4 -->|Yes| F["onBroadcasterChange: (isBroadcaster) => void"]
    Q4 -->|No| G[Done]

    B --> H["Compose with persist:\nbroadcast(persist(factory, persistOpts), broadcastOpts)"]
```
