/**
 * Toast/notification store.
 *
 * Framework-free and testable; the visual layer only renders what is here. Notifications carry a
 * tone and an optional action, and are announced through an ARIA live region by the renderer.
 */

import { createStore, type Store } from '../lib/create-store';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type ToastAction = {
  readonly label: string;
  readonly href?: string;
  readonly onSelect?: () => void;
};

export type Toast = {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly description?: string;
  readonly action?: ToastAction;
  /** Milliseconds before auto-dismiss; `null` keeps the toast until it is dismissed. */
  readonly durationMs: number | null;
  readonly createdAt: string;
};

export type ToastInput = {
  readonly tone?: ToastTone;
  readonly title: string;
  readonly description?: string;
  readonly action?: ToastAction;
  readonly durationMs?: number | null;
};

export type ToastState = {
  readonly toasts: readonly Toast[];
};

export class ToastStore {
  private readonly store: Store<ToastState> = createStore<ToastState>({ toasts: [] });
  private counter = 0;

  public constructor(private readonly now: () => Date = () => new Date()) {}

  public subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  public getState(): ToastState {
    return this.store.getState();
  }

  public push(input: ToastInput): Toast {
    this.counter += 1;
    const toast: Toast = {
      id: `toast-${this.counter}`,
      tone: input.tone ?? 'info',
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.action === undefined ? {} : { action: input.action }),
      durationMs: input.durationMs === undefined ? 6000 : input.durationMs,
      createdAt: this.now().toISOString(),
    };
    this.store.setState((previous) => ({ toasts: [...previous.toasts, toast] }));
    return toast;
  }

  public dismiss(id: string): void {
    this.store.setState((previous) => ({
      toasts: previous.toasts.filter((toast) => toast.id !== id),
    }));
  }

  public clear(): void {
    this.store.setState({ toasts: [] });
  }

  /** Convenience helpers used by the shell; keeps tone strings out of components. */
  public success(title: string, description?: string): Toast {
    return this.push({
      tone: 'success',
      title,
      ...(description === undefined ? {} : { description }),
    });
  }

  public info(title: string, description?: string): Toast {
    return this.push({
      tone: 'info',
      title,
      ...(description === undefined ? {} : { description }),
    });
  }

  public warning(title: string, description?: string): Toast {
    return this.push({
      tone: 'warning',
      title,
      ...(description === undefined ? {} : { description }),
      durationMs: 9000,
    });
  }

  public error(title: string, description?: string): Toast {
    return this.push({
      tone: 'error',
      title,
      ...(description === undefined ? {} : { description }),
      durationMs: null,
    });
  }
}
