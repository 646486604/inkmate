import '@fastify/cookie';
import type { PublicUser } from '@inkmate/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicUser;
  }
}
