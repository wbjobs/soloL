const Redis = require('ioredis');
require('dotenv').config();

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || null,
  db: parseInt(process.env.REDIS_DB) || 0,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
};

class RedisClient {
  constructor() {
    this.publisher = new Redis(redisConfig);
    this.consumer = new Redis(redisConfig);
    
    this.publisher.on('connect', () => {
      console.log('✅ Redis Publisher connected');
    });
    
    this.publisher.on('error', (err) => {
      console.error('❌ Redis Publisher error:', err.message);
    });
    
    this.consumer.on('connect', () => {
      console.log('✅ Redis Consumer connected');
    });
    
    this.consumer.on('error', (err) => {
      console.error('❌ Redis Consumer error:', err.message);
    });
  }

  get client() {
    return this.publisher;
  }

  get streams() {
    return {
      MIDI_ANALYSIS: 'midi:analysis:queue',
      MIDI_RESULTS: 'midi:analysis:results',
    };
  }

  async addToStream(streamName, data, maxLen = 10000) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    return await this.publisher.xadd(
      streamName,
      'MAXLEN',
      '~',
      maxLen,
      '*',
      'payload',
      message
    );
  }

  async readFromStream(streamName, lastId = '$', count = 10, block = 5000) {
    try {
      const results = await this.consumer.xread(
        'BLOCK',
        block,
        'COUNT',
        count,
        'STREAMS',
        streamName,
        lastId
      );
      
      if (!results || results.length === 0) return [];
      
      const messages = [];
      for (const [stream, entries] of results) {
        for (const [id, fields] of entries) {
          const payload = fields.find((_, i) => i % 2 === 1);
          try {
            messages.push({
              id,
              data: JSON.parse(payload),
            });
          } catch (e) {
            messages.push({
              id,
              data: payload,
            });
          }
        }
      }
      return messages;
    } catch (err) {
      console.error('Stream read error:', err.message);
      return [];
    }
  }

  async acknowledge(streamName, groupName, id) {
    return await this.consumer.xack(streamName, groupName, id);
  }

  async createConsumerGroup(streamName, groupName) {
    try {
      await this.consumer.xgroup('CREATE', streamName, groupName, '$', 'MKSTREAM');
      console.log(`✅ Consumer group ${groupName} created for stream ${streamName}`);
    } catch (err) {
      if (err.message.includes('BUSYGROUP')) {
        console.log(`ℹ️  Consumer group ${groupName} already exists`);
      } else {
        console.error('Error creating consumer group:', err.message);
      }
    }
  }

  async readGroup(streamName, groupName, consumerName, count = 1, block = 5000) {
    try {
      const results = await this.consumer.xreadgroup(
        'GROUP',
        groupName,
        consumerName,
        'BLOCK',
        block,
        'COUNT',
        count,
        'NOACK',
        'STREAMS',
        streamName,
        '>'
      );
      
      if (!results || results.length === 0) return [];
      
      const messages = [];
      for (const [stream, entries] of results) {
        for (const [id, fields] of entries) {
          const payload = fields.find((_, i) => i % 2 === 1);
          try {
            messages.push({
              id,
              data: JSON.parse(payload),
            });
          } catch (e) {
            messages.push({
              id,
              data: payload,
            });
          }
        }
      }
      return messages;
    } catch (err) {
      console.error('Group read error:', err.message);
      return [];
    }
  }

  async set(key, value, ttl = null) {
    if (ttl) {
      return await this.publisher.setex(key, ttl, value);
    }
    return await this.publisher.set(key, value);
  }

  async get(key) {
    return await this.publisher.get(key);
  }

  async del(key) {
    return await this.publisher.del(key);
  }

  async hset(key, field, value) {
    return await this.publisher.hset(key, field, value);
  }

  async hget(key, field) {
    return await this.publisher.hget(key, field);
  }

  async hgetall(key) {
    return await this.publisher.hgetall(key);
  }

  close() {
    this.publisher.disconnect();
    this.consumer.disconnect();
  }
}

module.exports = new RedisClient();
