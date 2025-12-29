import Redis from 'ioredis';
import dotenv from 'dotenv';
import logger from './logger';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Singleton Redis client instance
// Lazy connection - won't block app startup
const redisClient = new Redis(REDIS_URL, {
  lazyConnect: true, // Don't connect immediately
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    logger.warn(`Redis connection retry attempt ${times}, waiting ${delay}ms`);
    return delay;
  },
  maxRetriesPerRequest: 3,
  connectTimeout: 10000, // 10 second timeout
  enableReadyCheck: false, // Don't wait for ready state
});

redisClient.on('connect', () => {
  logger.info('Redis client connected');
});

redisClient.on('ready', () => {
  logger.info('Redis client ready');
});

redisClient.on('error', (err) => {
  logger.error('Redis client error:', err);
});

redisClient.on('close', () => {
  logger.warn('Redis client connection closed');
});

redisClient.on('reconnecting', () => {
  logger.info('Redis client reconnecting...');
});

export default redisClient;

