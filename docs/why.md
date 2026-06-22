# Why refsignal

← [Back to README](../README.md) · [Concepts](concepts.md) · [API Reference](api.md) · [Patterns](patterns.md) · [Benchmark](benchmark.md)

---

The README tells you *what* refsignal does. This is the *why* — and the honest version of it, which is that almost none of this library was designed. It was cornered into existence, one real problem at a time. That story is the strongest argument for it, so it's worth telling straight.

---

## It started as a question, not a design

refsignal didn't begin as "a state library." It began as a question React leaves unanswered. To see the question, look at what makes a `useRef` special — two things, and the second is the quiet one:

- It lives **outside the render cycle** — you can mutate `.current` without triggering a render.
- A read of `.current` is **always the current value.** Unlike a `useState` value, a ref doesn't hand you a snapshot captured at render time. Any reader — an event handler, a deferred callback, even a stale closure React captured three renders ago — sees the latest write. That's by design, and it's the property that lets you read a value anywhere in imperative code and *trust* it, with no dependency-array gymnastics to keep it fresh.

The one thing a ref can't do is tell you when it changed. It's silent — nothing can subscribe. So the question sharpens to:

> *What if the thing that's always accurate to read could also notify you when it changes?*

The first two primitives are the answer:

1. **I wanted a ref** → `useRefSignal` — a `.current` you can mutate and always read fresh, living outside React's render cycle.
2. **I wanted a `useEffect` on that ref** → `useRefSignalEffect(fn, [signal])` — same shape as `useEffect`, same deps array, but it fires when the signal changes, not when React re-renders.

That was the whole library, briefly. Then a pattern started repeating:

```tsx
useRefSignalEffect(() => { setRerender(true); }, [signal]);
```

I was hand-writing that "subscribe, then force a render" bridge constantly. When you write the same line often enough, *not* extracting it is the strange decision:

3. **I also wanted to render from a signal** → `useRefSignalRender([signal])` — the bridge, promoted to a first-class primitive.

Then I pushed update rates up — a canvas, a drag, a simulation — and walked straight into the problem the bridge re-opened. Calling `setState` on *every* signal change reintroduces the exact re-render storm that signals exist to escape. I'd brought the problem back.

4. **So the render path had to be able to slow down** → timing options (`frame`, `throttle`, `debounce`) — coalescing as the answer to the storm the render bridge created, not a feature bolted on for its own sake.
5. I put those options on `useRefSignalRender` **first**, on principle: the render path is the most expensive consumer, so it's the first place a limiter should live.

Then came the move that made the rest fall into place:

6. **The timing options didn't belong to render — they belonged to a shared level**, so `useRefSignalEffect` (and later `watch`, `persist`, `broadcast`) get them too. That turned timing from a per-primitive feature into a *vocabulary you learn once and apply everywhere*. The realization that sealed it: even on the imperative path it usually makes no sense *not* to coalesce — at minimum to a frame. So the correct batching posture became a free, one-token reflex on every consumer.

And finally, a layer I didn't expect to need, found in real production use:

7. **The signals wanted to live in Providers.** Building a real app (a node-editor IDE), I kept putting signal stores in React Context — and realized Context/Provider is *already* the dependency-injection mechanism every React developer knows. Redux's answer to "how do components reach shared state" is a parallel system you import alongside React (`store`, typed `dispatch`, typed selector hooks). React already shipped the answer years ago. So instead of inventing distribution, I sugared the thing that exists → `createRefSignalContext` with `renderOn` / `unwrap`. `renderOn` does the render-subscription at the store layer, so store users never even meet `useRefSignalRender` — the concept gets *absorbed*, not duplicated.

   And here the foundational ref property comes back, now at the root of the tree. Context re-renders its consumers only when its *value* changes. The value here is the store handle — a stable *outer* identity — while every update mutates the *inner* `.current` of the signals it holds. So the Context value never changes, Context never propagates a render, and only the signals' named subscribers wake up. The same inner/outer split that gives always-fresh reads at the leaf gives **render-free state in a Provider** at the root — the exact pattern React steered everyone away from, made safe again, by the property we started with.

That's the whole library:

> I wanted a ref I could `useEffect` on. Then I kept writing the same line to re-render from it, so I named it. Then I went too fast and brought back the storm I was escaping, so I taught the render path to slow down — and then realized every consumer should be able to, the same way, with the same words. Then I noticed I'd been putting the signals in Providers all along, and that React already had the dependency injection I needed.

Nothing speculative survived. Every primitive had to earn entry by *already existing as a pain*.

---

## The axis: it subtracts coordination, it doesn't add capability

Here's the thing the genesis reveals, and the lens to judge refsignal by.

In ordinary code, the algorithm is rarely the hard part. A delay buffer is trivial; a throttle is trivial. What's expensive is the **coordination** — the wiring between *"this changed"* and *"these things must react to it."* A `requestAnimationFrame` loop, a re-render guard, a subscription you must remember to tear down, a dependency array you must keep honest, a ref to dodge a stale closure. None of that is the idea. It's bookkeeping that exists only to connect cause to effect — and when you read the code later, you have to mentally *execute* that bookkeeping to recover the intent. That reconstruction is the real cognitive tax.

refsignal's primitives don't add power you didn't have. They **absorb the coordination** so it's no longer on the page. `useReplayRefSignal(pointer, 300)` reads as the literal sentence *"a ghost is the pointer, 300 ms ago."* Mechanism and intent are the same text — nothing to reconstruct. The coordination didn't get easier; it left the source file.

That's why it can feel like nothing new and land like something new at the same time. The result is often unremarkable; what changed is how much you have to hold in your head to read the code that produces it.

> The primitives don't add capability — they subtract the coordination you'd otherwise have to read.

---

## A worked proof: the comet

The clearest proof is a demo where the *result* is deliberately unremarkable, so any difference is pure coordination. That's the comet ([`demo/demos/replay/index.tsx`](../demo/demos/replay/index.tsx)): a cursor trailed by seven ghosts, each retracing your exact path a fixed delay behind, over a faint canvas trail that fades out exactly as the slowest ghost passes.

The whole thing is **one `pointer` signal and seven `useReplayRefSignal(pointer, ms)` views of it.** Each ghost is consumed by the *same* frame-coalesced effect as the live cursor — only the delay differs. The trail is driven by a `frame` pulse; the per-consumer `{ frame: true }` is the only batching anywhere.

What's *not* in the source file:

- A `requestAnimationFrame` loop (the `frame` pulse is the loop).
- A timestamped ring buffer per ghost, drained in order at its due time (that's what `replay` is).
- Hand-rolled coalescing so a fast mouse doesn't flood seven consumers per move.
- Subscription teardown for any of it.

A competent hand-rolled version of the same effect is on the order of 60–70 lines of coordination, carrying roughly four live correctness traps: timeline reordering, frame drift, object aliasing (capturing a reference to a value that keeps mutating), and a timer/listener leak. The refsignal version is a handful of hook calls and **zero** of those traps — they're eliminated by construction, not by care. You can't have a bug in code you didn't have to write.

And it holds 120 fps **with devtools open and subscribed to every signal update** — which is not a coincidence, but the next section.

---

## The dividend you don't design for: per-consumer rate

Step 6 above — putting the timing knob on the *consumer* — produced a property nobody typed.

Look at `.update()`: it takes a value. There's no rate parameter, no consumer list, no "who's listening." There is structurally **nowhere** to express a consumer concern on the producer side. So the producer stays clean — not by discipline, but because the API gives you no place to pollute it. Each consumer, independently, chooses its own contract: untimed (every value), `frame`, `throttle`, `debounce`, or `replay` for the full time-shifted timeline. The producer is blind to all of it.

The payoff is **observability without the observer effect.** Normally, to watch a hot internal value you poll it into a shadow copy, or instrument it with throttled logging — boilerplate around the very value you want to watch, and worse, instrumentation that perturbs the hot path it measures. With refsignal the signal *is* the observation point. An observer subscribes at its own cadence; the producer never learns it exists; and because the limiter lives on the consumer, the slow observer's cost is paid on the observer's side. **You watch the fast thing without slowing the fast thing.**

- **Self-hosting devtools** are the existence proof: refsignal inspects its *own* signal graph, at a rate the user dials, while 120 fps demos run — with no measurable penalty. A library observing itself, at a chosen rate, without taxing what it observes.
- **A physics engine** is the canonical case: the solver reads its signals at sim rate, a debug overlay reads them at 60 fps, a UI panel at 10 fps — simultaneously, from the same signals, with zero intermediate copies. The `observedPosition` / `observedVelocity` shadow-variable scaffolding simply doesn't exist.

One precision, because it's the correct semantics and not a caveat: a throttled or framed observer sees a *sampled* view, not every intermediate value — which, for observing internals, is almost always exactly what you want. A consumer that genuinely needs every value subscribes untimed, or uses `replay`. The point isn't "everyone gets everything"; it's that **each consumer chooses its own truth about the stream — sampled, framed, or complete — and the producer is blind to the choice.**

---

## No magic: the writes say what they mean

If coordination gets absorbed, why are there *three* ways to write a signal — `update`, `notifyUpdate`, `notify` — plus raw `.current` assignment? Why not one write path, with the library figuring out the rest?

Because the alternative is a proxy, and a proxy is magic. Valtio and MobX wrap your state in one that auto-detects mutation and fires for you — a single write path, no ceremony. The price is that you can no longer *see*, at the write site, what a write does or what it wakes. The mechanism is hidden, and hidden mechanism is exactly what makes reactive code hard to reason about. refsignal absorbs *coordination* — the subscription plumbing between cause and effect — but it deliberately refuses to absorb *intent*. What a write should wake is yours to state, in plain method calls, with nothing reading your mind.

So the write paths aren't redundancy. They're a vocabulary across two questions you're already answering in your head — *allocate or mutate?* and *render or just run effects?*

| Write | Allocates? | Wakes renders? | Wakes effects? |
|---|---|---|---|
| `update(v)` | yes (new value) | yes | yes |
| `notifyUpdate()` *(after mutating `.current` in place)* | no | yes | yes |
| `notify()` *(after mutating `.current` in place)* | no | no | yes |
| `.current = x` *(raw)* | — | no | no (silent) |

- **`update(v)`** — the default: set a new value, wake everyone, renders included. You reach for it almost always.
- **`notifyUpdate()`** — you mutated `.current` in place; wake everyone, renders included, but allocate nothing.
- **`notify()`** — you mutated in place; wake effects only, no render. Supplementary power for when *you know* nothing needs to render.
- **raw `.current = x`** — set silently, wake no one (for batching, initialization, or handing off to a coordinated flush).

Two real forces shaped this, and both are worth naming because they're why it isn't over-design:

**GC made in-place mutation a requirement, not a nicety.** At pointer speed, allocating a fresh object per write is fine for one cursor or the comet's seven consumers — but the pressure scales with *frequency × fan-out* faster than you'd expect. So `notify()`-after-mutation isn't a micro-optimization; it's the path the hot loop needs. `update()` (immutable, allocating) is just the ergonomic default for everything that isn't a hot loop.

**The render/effect split tracks one fact:** `lastUpdated` is the render trigger (`useRefSignalRender` watches it; `useSyncExternalStore` reads it). `update` and `notifyUpdate` bump it; `notify` doesn't. The default keeps renders working because you can never know in advance whether *someone* renders off a signal — and `notify` lets a caller who *does* know opt out of that bookkeeping entirely. You pay for the render path only when you ask for it.

The principle underneath both: refsignal absorbs *mechanism* but never *intent*. That's the one place it asks more of you than a magic library would, and it's on purpose — **a write you can read is worth more than a write you don't have to think about.**

---

## What it costs you

Honesty matters more than a clean pitch, so here's the real cost, with the things that *aren't* costs removed.

The genuine cost is **vocabulary** — and it's small, because most of it is recycled React knowledge with new names:

| Concept | New to a React dev? | Rhymes with |
|---|---|---|
| `useRefSignal` / `createRefSignal` | familiar | `useRef` / `useState` |
| `.current` read, `.update()` write | familiar | `ref.current`, `setState` |
| **three write paths** (`update` / `notify` / `notifyUpdate`) | **new** | — |
| read ≠ subscribe (reading `.current` doesn't make you react) | **new-ish** | — |
| `useRefSignalEffect` | familiar | `useEffect` + deps |
| `useRefSignalMemo` | familiar | `useMemo` |
| **mount-time capture** (initial value/rate/source captured once) | **new (gotcha)** | `useState`'s initial arg |
| timing options (`frame`/`throttle`/`debounce`) | familiar concept | learned once, uniform everywhere |

The load-bearing new concepts are really just two: **the three write paths** and **mount-time capture**. Everything else sits inside React's existing model — you're still in "refs, effects, memo, deps array" land. There's no new paradigm to context-switch into.

And there's a floor. You wouldn't reach for Redux to hold a boolean in one local component; you wouldn't reach for refsignal for it either. Its value turns on at the **second consumer**, or at **any cadence faster than React wants to render** — and below that line there's nothing to compare. A single `useState` is fine, and refsignal is honest about not competing for it.

---

## Compared to Redux & friends

Counting vocabulary at each library's best (Redux Toolkit, not legacy Redux), Redux asks you to hold ~12 net-new concepts that cohere into a *foreign paradigm*: `store`, `slice`, reducer, action + creators, `dispatch`, Immer's mutate-but-immutable contract, selectors + `createSelector`, `useAppSelector` (and its re-render-on-new-object gotcha), `useAppDispatch`, the `RootState`/`AppDispatch` typed setup, `createAsyncThunk` with its pending/fulfilled/rejected lifecycle, `extraReducers`. To debug, you trace `dispatch → middleware → reducer → new state → selector → re-render`. None of that model exists in vanilla React.

The asymmetry isn't the count (≈12 vs ≈4) — it's **model versus methods.** Redux asks you to learn a new *model* of how state changes, grafted onto React. refsignal asks you to learn a few new *methods* on a container you already understand.

There's a second axis too: **distribution.** Redux's answer to "how do components reach shared state" is a parallel wiring system bolted alongside React — import the store, the typed dispatch, the typed selector hooks. refsignal uses the dependency-injection mechanism React already ships and every developer knows: Provider + `useContext`, sugared with `renderOn` / `unwrap`. (`createRefSignalContext` keeps a *stable* store handle in Context, so there's no Context re-render — the pattern React steered everyone away from, made safe again.)

To be fair about what Redux's extra vocabulary *buys*: the action/reducer indirection gives you a serializable, replayable, centralized log of every state transition — time-travel, action-level middleware, one auditable mutation chokepoint. That's the genuine price of a command-log architecture, and some teams want exactly that. It's *right* for auditable, app-wide, human-paced state — and *actively wrong* for refsignal's domain, where routing 120 fps of cursor movement through `dispatch → reducer → selector → re-render` is precisely the overhead you adopted refsignal to escape.

---

## Why it stays small

Pull the threads together and the structure is this:

- Steps 1–7 are the **API** — each piece cornered into existence by a real problem.
- The per-consumer rate decoupling is the **architecture** those steps quietly produced — a property nobody typed, that falls out of where the knobs ended up.

A library designed up front has properties because someone intended them, and you can usually feel the seams where intent met reality. A library *derived* from real problems has properties because its local decisions were correct — and correctness compounds into dividends you didn't ask for. Observability without the observer effect is one of those. You can't market your way to it; it only happens when the small decisions were genuinely right.

It also explains the size. An API that can only grow by *encountering* a need — never by anticipating one — has a natural ceiling on its surface area. It converges instead of sprawling. That's the real reason it "feels like everything gets easier": you're not reading someone's idea of what reactivity should be. You're reading the minimal set of names for problems you'd have hit anyway.

---

### Keep reading

- **[Concepts](concepts.md)** — the mental model, the three write paths, `notify` vs `notifyUpdate`.
- **[API Reference](api.md)** — every primitive and option.
- **[Patterns](patterns.md)** — divergent consumers, time-shifted signals, stores, cross-tab sync.
