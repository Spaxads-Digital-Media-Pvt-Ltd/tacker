/**
 * Re-export of the shared queue registry for ergonomic imports inside the workers surface.
 * Producers/consumers across the codebase should import from `lib/queues.js` directly.
 */
export { QUEUE, getQueue, type QueueName } from '../../lib/queues.js';
