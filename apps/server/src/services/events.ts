import type { FastifyReply } from 'fastify';

const clients = new Set<FastifyReply>();
let heartbeat: NodeJS.Timeout | undefined;

export function subscribe(reply: FastifyReply): void {
  clients.add(reply);
}

export function unsubscribe(reply: FastifyReply): void {
  clients.delete(reply);
}

export function publish(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const reply of clients) {
    if (reply.raw.destroyed || reply.raw.writableEnded) {
      clients.delete(reply);
      continue;
    }
    try {
      reply.raw.write(payload);
    } catch {
      clients.delete(reply);
    }
  }
}

export function startEventHeartbeat(): () => void {
  heartbeat = setInterval(() => {
    for (const reply of clients) {
      if (reply.raw.destroyed || reply.raw.writableEnded) {
        clients.delete(reply);
        continue;
      }
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        clients.delete(reply);
      }
    }
  }, 25_000);
  heartbeat.unref?.();
  return () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    for (const reply of clients) {
      try {
        if (!reply.raw.writableEnded) reply.raw.end();
      } catch {
        // ignore
      }
    }
    clients.clear();
  };
}
