import { DevToolsAdapter, RefSignal, setDevToolsAdapter } from './refsignal';

interface ReduxDevToolsExtension {
  connect(options: { name: string; features: Record<string, unknown> }): {
    init(state: Record<string, unknown>): void;
    send(
      action: { type: string; payload: unknown },
      state: Record<string, unknown>,
    ): void;
  };
}

export interface DevToolsConfig {
  /** Enable Redux DevTools Extension integration */
  reduxDevTools?: boolean;
  /** Log signal updates to console */
  logUpdates?: boolean;
  /** Maximum number of updates to keep in history */
  maxHistory?: number;
}

export interface SignalUpdate {
  signalId: string;
  name?: string;
  timestamp: number;
  oldValue: unknown;
  newValue: unknown;
  stackTrace?: string;
}

class DevTools implements DevToolsAdapter {
  private config: DevToolsConfig = {
    reduxDevTools: false,
    logUpdates: false,
    maxHistory: 100,
  };

  // Using object as key type to avoid generic variance issues
  private signals = new WeakMap<object, string>();
  private signalsByName = new Map<string, RefSignal>();
  private signalIdCounter = 0;
  private updateHistory: SignalUpdate[] = [];
  private reduxDevToolsExtension: ReturnType<
    ReduxDevToolsExtension['connect']
  > | null = null;

  configure(config: Partial<DevToolsConfig>): void {
    this.config = { ...this.config, ...config };

    // Initialize Redux DevTools if enabled.
    // Production guard: every signal update is forwarded to the attached
    // DevTools extension, so leaving this enabled in a prod build would
    // leak application state. Refuse to connect and warn the user.
    if (this.config.reduxDevTools && typeof window !== 'undefined') {
      if (
        typeof process !== 'undefined' &&
        process.env.NODE_ENV === 'production'
      ) {
        console.warn(
          '[react-refsignal] Redux DevTools is disabled in production builds to avoid leaking signal state. Gate `reduxDevTools: true` behind a dev-only check.',
        );
        return;
      }
      const ext = (
        window as unknown as {
          __REDUX_DEVTOOLS_EXTENSION__?: ReduxDevToolsExtension;
        }
      ).__REDUX_DEVTOOLS_EXTENSION__;
      if (ext) {
        this.reduxDevToolsExtension = ext.connect({
          name: 'RefSignal DevTools',
          features: {
            pause: true,
            export: true,
            import: 'custom',
            jump: true,
            skip: true,
            reorder: true,
            dispatch: true,
          },
        });
        this.reduxDevToolsExtension.init(this.getState());
      }
    }
  }

  registerSignal<T>(signal: RefSignal<T>, name?: string): string {
    const id = name ?? `signal_${String(this.signalIdCounter++)}`;
    this.signals.set(signal as object, id);

    if (name) {
      this.signalsByName.set(name, signal as RefSignal);
    }

    return id;
  }

  trackUpdate<T>(signal: RefSignal<T>, oldValue: T, newValue: T): void {
    const signalId = this.signals.get(signal as object) || 'unknown';
    const update: SignalUpdate = {
      signalId,
      name: signalId,
      timestamp: Date.now(),
      oldValue,
      newValue,
      stackTrace: this.config.logUpdates ? new Error().stack : undefined,
    };

    this.updateHistory.push(update);

    // Maintain max history size
    if (this.updateHistory.length > (this.config.maxHistory ?? 100)) {
      this.updateHistory.shift();
    }

    // Log to console if enabled
    if (this.config.logUpdates) {
      console.log(`[RefSignal] ${signalId} updated:`, {
        from: oldValue,
        to: newValue,
      });
    }

    // Send to Redux DevTools if connected
    if (this.reduxDevToolsExtension) {
      this.reduxDevToolsExtension.send(
        {
          type: `UPDATE ${signalId}`,
          payload: { oldValue, newValue },
        },
        this.getState(),
      );
    }
  }

  getSignalName<T>(signal: RefSignal<T>): string | undefined {
    return this.signals.get(signal as object);
  }

  getUpdateHistory(): SignalUpdate[] {
    return [...this.updateHistory];
  }

  clearHistory(): void {
    this.updateHistory = [];
  }

  /** Clear all tracked signals (useful for testing) */
  reset(): void {
    this.updateHistory = [];
    this.signalsByName.clear();
    this.signalIdCounter = 0;
  }

  private getState(): Record<string, unknown> {
    const state: Record<string, unknown> = {};

    // Build current state from all tracked signals
    this.signalsByName.forEach((signal, name) => {
      state[name] = signal.current;
    });

    return state;
  }

  getSignalByName<T = unknown>(name: string): RefSignal<T> | undefined {
    return this.signalsByName.get(name) as RefSignal<T> | undefined;
  }

  getAllSignals(): Array<{ name: string; signal: RefSignal }> {
    const result: Array<{ name: string; signal: RefSignal }> = [];

    this.signalsByName.forEach((signal, name) => {
      result.push({ name, signal });
    });

    return result;
  }
}

// Singleton instance
export const devtools = new DevTools();

// Convenience export for configuration
export function configureDevTools(config: Partial<DevToolsConfig>): void {
  devtools.configure(config);
}

// Self-register with the core when this module is imported
setDevToolsAdapter(devtools);
