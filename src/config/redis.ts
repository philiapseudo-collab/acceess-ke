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
    // Stop retrying after 5 attempts (to reduce log spam)
    if (times > 5) {
      logger.warn('Redis connection failed after 5 attempts. App will continue without Redis (sessions won\'t persist).');
      return null; // Stop retrying
    }
    const delay = Math.min(times * 50, 2000);
    // Only log first few retries to reduce spam
    if (times <= 3) {
      logger.warn(`Redis connection retry attempt ${times}, waiting ${delay}ms`);
    }
    return delay;
  },
  maxRetriesPerRequest: 3,
  connectTimeout: 10000, // 10 second timeout
  enableReadyCheck: false, // Don't wait for ready state
  // Reduce connection error logging
  showFriendlyErrorStack: false,
});

redisClient.on('connect', () => {
  logger.info('Redis client connected');
});

redisClient.on('ready', () => {
  logger.info('Redis client ready');
});

// Track last error log time to reduce spam
let lastErrorLogTime = 0;
const ERROR_LOG_INTERVAL = 60000; // Log errors at most once per minute

redisClient.on('error', (err) => {
  const now = Date.now();
  // Only log errors once per minute to reduce spam
  if (now - lastErrorLogTime > ERROR_LOG_INTERVAL) {
    logger.warn('Redis client error (will retry silently):', err instanceof Error ? err.message : 'Unknown error');
    lastErrorLogTime = now;
  }
});

redisClient.on('close', () => {
  logger.warn('Redis client connection closed');
});

// Track last reconnecting log time to reduce spam
let lastReconnectingLogTime = 0;
const RECONNECTING_LOG_INTERVAL = 30000; // Log reconnecting at most once per 30 seconds

redisClient.on('reconnecting', () => {
  const now = Date.now();
  // Only log reconnecting once per 30 seconds to reduce spam
  if (now - lastReconnectingLogTime > RECONNECTING_LOG_INTERVAL) {
    logger.info('Redis client reconnecting...');
    lastReconnectingLogTime = now;
  }
});

export default redisClient;

