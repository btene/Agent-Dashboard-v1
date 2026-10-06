// In-process event bus. Everything that happens (runs starting, logging,
// finishing; agents changing) is published here and fanned out to
// Server-Sent-Event clients and outbound webhooks.
import { EventEmitter } from 'node:events';

export function createBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return {
    publish(type, data) {
      emitter.emit('event', { type, data, at: new Date().toISOString() });
    },
    subscribe(fn) {
      emitter.on('event', fn);
      return () => emitter.off('event', fn);
    },
  };
}
