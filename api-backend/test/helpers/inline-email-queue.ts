/**
 * For tests: the email queue delivered in-process (O11). `vi.mock('../../src/lib/queues.js', (io) =>
 * inlineEmailQueue(io))` — jobs on the `email` queue run deliverOutboxEmail right away (one attempt,
 * treated as the last, so a failure marks the outbox row failed) instead of waiting for a worker; every
 * other queue is the real one. Keeps tests deterministic and isolated from other files' workers.
 */
type QueuesModule = typeof import('../../src/lib/queues.js');

export async function inlineEmailQueue(importOriginal: () => Promise<unknown>): Promise<QueuesModule> {
  const actual = (await importOriginal()) as QueuesModule;
  return {
    ...actual,
    getQueue: ((name: Parameters<QueuesModule['getQueue']>[0]) => {
      if (name !== actual.QUEUE.email) return actual.getQueue(name);
      return {
        add: async (_job: string, data: { outboxId: string }) => {
          const { deliverOutboxEmail } = await import('../../src/lib/email/outbox.js');
          await deliverOutboxEmail(data.outboxId, 1, true).catch(() => undefined);
        },
      } as unknown as ReturnType<QueuesModule['getQueue']>;
    }) as QueuesModule['getQueue'],
  };
}
