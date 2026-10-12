/**
 * Typed platform event bus.
 *
 * Purpose: let side effects (toasts, diagnostics, future autosave) react to domain events without
 * the domain layer importing UI code. Listeners are isolated — one throwing listener must not stop
 * the others, and must never break the action that emitted the event.
 */

export type EventMap = Record<string, unknown>;

export type EventListener<TPayload> = (payload: TPayload) => void;

export type Unsubscribe = () => void;

export type BusErrorReporter = (error: unknown, event: string) => void;

export class EventBus<TMap extends EventMap> {
  private readonly listeners = new Map<keyof TMap, Set<EventListener<never>>>();

  public constructor(private readonly reportError: BusErrorReporter = () => undefined) {}

  public on<TKey extends keyof TMap>(
    event: TKey,
    listener: EventListener<TMap[TKey]>,
  ): Unsubscribe {
    const set = this.listeners.get(event) ?? new Set<EventListener<never>>();
    set.add(listener);
    this.listeners.set(event, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(event);
    };
  }

  public once<TKey extends keyof TMap>(
    event: TKey,
    listener: EventListener<TMap[TKey]>,
  ): Unsubscribe {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  public emit<TKey extends keyof TMap>(event: TKey, payload: TMap[TKey]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as EventListener<TMap[TKey]>)(payload);
      } catch (error) {
        this.reportError(error, String(event));
      }
    }
  }

  public listenerCount(event: keyof TMap): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  public clear(): void {
    this.listeners.clear();
  }
}

/** Events the platform emits today. Extend as studios gain real behaviour. */
export type PlatformEventMap = {
  'document:created': { id: string; title: string; studioId: string };
  'document:saved': { id: string; title: string; revision: number };
  'document:deleted': { id: string; title: string };
  'documents:loaded': { count: number; skipped: number; migrated: number };
  'documents:cleared': { removed: number };
  'preferences:changed': { key: string };
  'storage:error': { code: string; message: string };
  'catalogue:queried': { source: string; total: number; page: number };
  'command:executed': { id: string; group: string };
  'learning:progress-changed': { lessonSlug: string; completed: boolean };
};

export type PlatformEventBus = EventBus<PlatformEventMap>;

export function createPlatformEventBus(reportError?: BusErrorReporter): PlatformEventBus {
  return new EventBus<PlatformEventMap>(
    reportError ??
      ((error, event) => {
        // Surfacing beats swallowing: a broken listener is a bug worth seeing in the console.
        console.error(`[forge] listener for "${event}" threw:`, error);
      }),
  );
}
