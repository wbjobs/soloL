import { Module, Global } from '@nestjs/common';
import * as Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const client = new Redis.default(
          process.env.REDIS_URL || 'redis://localhost:6379',
        );
        client.on('error', (err) => {
          console.error('Redis connection error:', err);
        });
        client.on('connect', () => {
          console.log('Connected to Redis');
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
