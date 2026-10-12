import { describe, expect, it, vi } from 'vitest';

import { EventBus, createPlatformEventBus, type PlatformEventMap } from './event-bus';

type TestMap = {
  'test:tick': { count: number };
  'test:tock': { label: string };
};

describe('EventBus', () => {
  it('delivers payloads to every subscriber of the event', () => {
    const bus = new EventBus<TestMap>();
    const first = vi.fn();
    const second = vi.fn();

    bus.on('test:tick', first);
    bus.on('test:tick', second);
    bus.emit('test:tick', { count: 3 });

    expect(first).toHaveBeenCalledWith({ count: 3 });
    expect(second).toHaveBeenCalledWith({ count: 3 });
  });

  it('does not deliver an event to subscribers of another event', () => {
    const bus = new EventBus<TestMap>();
    const tick = vi.fn();
    bus.on('test:tick', tick);
    bus.emit('test:tock', { label: 'nope' });
    expect(tick).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus<TestMap>();
    const listener = vi.fn();
    const unsubscribe = bus.on('test:tick', listener);
    unsubscribe();
    bus.emit('test:tick', { count: 1 });

    expect(listener).not.toHaveBeenCalled();
    expect(bus.listenerCount('test:tick')).toBe(0);
  });

  it('supports one-shot listeners', () => {
    const bus = new EventBus<TestMap>();
    const listener = vi.fn();
    bus.once('test:tick', listener);
    bus.emit('test:tick', { count: 1 });
    bus.emit('test:tick', { count: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing listener from the others and from the emitter', () => {
    const reportError = vi.fn();
    const bus = new EventBus<TestMap>(reportError);
    const healthy = vi.fn();

    bus.on('test:tick', () => {
      throw new Error('listener exploded');
    });
    bus.on('test:tick', healthy);

    expect(() => {
      bus.emit('test:tick', { count: 1 });
    }).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'test:tick');
  });

  it('emitting an event with no listeners is a no-op', () => {
    const bus = new EventBus<TestMap>();
    expect(() => {
      bus.emit('test:tock', { label: 'silence' });
    }).not.toThrow();
  });

  it('clear() removes every listener', () => {
    const bus = new EventBus<TestMap>();
    bus.on('test:tick', vi.fn());
    bus.on('test:tock', vi.fn());
    bus.clear();
    expect(bus.listenerCount('test:tick')).toBe(0);
    expect(bus.listenerCount('test:tock')).toBe(0);
  });
});

describe('createPlatformEventBus', () => {
  it('routes listener failures through the supplied reporter', () => {
    const reportError = vi.fn();
    const bus = createPlatformEventBus(reportError);
    bus.on('storage:error', () => {
      throw new Error('boom');
    });
    bus.emit('storage:error', { code: 'storage-corrupt', message: 'unreadable' });
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('carries the documented platform events', () => {
    const payload: PlatformEventMap['documents:loaded'] = {
      count: 2,
      skipped: 1,
      migrated: 0,
    };
    const bus = createPlatformEventBus();
    const listener = vi.fn();
    bus.on('documents:loaded', listener);
    bus.emit('documents:loaded', payload);
    expect(listener).toHaveBeenCalledWith({ count: 2, skipped: 1, migrated: 0 });
  });
});
