import redisClient from '../config/redis';
import logger from '../config/logger';
import { BotState, Session, SessionData } from '../types/session';
import { normalizePhoneNumber } from '../utils/phoneNormalizer';

const SESSION_TTL = parseInt(process.env.SESSION_TTL || '600', 10); // Default 10 minutes
const SESSION_KEY_PREFIX = 'session:';
const LOCK_KEY_PREFIX = 'lock:';

/**
 * RedisService handles session management and distributed locking
 */
class RedisService {
  /**
   * Gets the session for a phone number
   * @param phoneNumber - Phone number (will be normalized)
   * @returns Session object with state and data, defaults to IDLE if missing
   * Returns default IDLE session if Redis is unavailable (graceful degradation)
   */
  async getSession(phoneNumber: string): Promise<Session> {
    try {
      const normalized = normalizePhoneNumber(phoneNumber);
      const key = `${SESSION_KEY_PREFIX}${normalized}`;
      
      const sessionJson = await redisClient.get(key);
      
      if (!sessionJson) {
        return {
          state: BotState.IDLE,
          data: {},
        };
      }
      
      const session: Session = JSON.parse(sessionJson);
      return session;
    } catch (error) {
      // Graceful degradation: return default session if Redis is unavailable
      logger.warn(`Redis unavailable, returning default session for ${phoneNumber}:`, error instanceof Error ? error.message : 'Unknown error');
      return {
        state: BotState.IDLE,
        data: {},
      };
    }
  }

  /**
   * Updates the session state and/or data
   * Merges new data with existing data
   * @param phoneNumber - Phone number (will be normalized)
   * @param state - New bot state
   * @param data - Partial session data to merge
   * Silently fails if Redis is unavailable (graceful degradation)
   */
  async updateSession(
    phoneNumber: string,
    state: BotState,
    data?: Partial<SessionData>
  ): Promise<void> {
    try {
      const normalized = normalizePhoneNumber(phoneNumber);
      const key = `${SESSION_KEY_PREFIX}${normalized}`;
      
      // Get existing session
      const existing = await this.getSession(phoneNumber);
      
      // Merge data
      const updatedData: SessionData = {
        ...existing.data,
        ...data,
      };
      
      // Create updated session
      const updatedSession: Session = {
        state,
        data: updatedData,
      };
      
      // Store with TTL
      await redisClient.setex(key, SESSION_TTL, JSON.stringify(updatedSession));
      
      logger.debug(`Session updated for ${normalized}: state=${state}`);
    } catch (error) {
      // Graceful degradation: log warning but don't throw
      logger.warn(`Redis unavailable, session update skipped for ${phoneNumber}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Clears the session, resetting to IDLE state
   * @param phoneNumber - Phone number (will be normalized)
   * Silently fails if Redis is unavailable (graceful degradation)
   */
  async clearSession(phoneNumber: string): Promise<void> {
    try {
      const normalized = normalizePhoneNumber(phoneNumber);
      const key = `${SESSION_KEY_PREFIX}${normalized}`;
      
      const clearedSession: Session = {
        state: BotState.IDLE,
        data: {},
      };
      
      // Set to IDLE state (or delete - setting is safer for consistency)
      await redisClient.setex(key, SESSION_TTL, JSON.stringify(clearedSession));
      
      logger.debug(`Session cleared for ${normalized}`);
    } catch (error) {
      // Graceful degradation: log warning but don't throw
      logger.warn(`Redis unavailable, session clear skipped for ${phoneNumber}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Acquires a distributed lock for a resource
   * Uses Redis SET with NX (set if not exists) and PX (expiration in milliseconds)
   * @param resourceKey - The resource key (e.g., "event:123:tier:456")
   * @param ttlSeconds - Time to live in seconds
   * @param ownerPhoneNumber - Phone number of the lock owner (will be normalized)
   * @returns true if lock was acquired, false if already locked or Redis unavailable
   * Returns false if Redis is unavailable (graceful degradation - allows operation to proceed)
   */
  async acquireLock(
    resourceKey: string,
    ttlSeconds: number,
    ownerPhoneNumber: string
  ): Promise<boolean> {
    try {
      const normalized = normalizePhoneNumber(ownerPhoneNumber);
      const key = `${LOCK_KEY_PREFIX}${resourceKey}`;
      const ttlMillis = ttlSeconds * 1000;
      
      // SET key value PX ttl NX
      // NX = only set if not exists
      // PX = expiration in milliseconds
      const result = await redisClient.set(key, normalized, 'PX', ttlMillis, 'NX');
      
      if (result === 'OK') {
        logger.debug(`Lock acquired: ${key} by ${normalized}`);
        return true;
      } else {
        logger.debug(`Lock already exists: ${key}`);
        return false;
      }
    } catch (error) {
      // Graceful degradation: allow operation to proceed if Redis is unavailable
      // Database optimistic locking will still prevent double-processing
      logger.warn(`Redis unavailable, lock acquisition skipped for ${resourceKey}:`, error instanceof Error ? error.message : 'Unknown error');
      return true; // Allow operation to proceed
    }
  }

  /**
   * Releases a lock only if it belongs to the owner (safe unlock)
   * @param resourceKey - The resource key
   * @param ownerPhoneNumber - Phone number of the expected lock owner (will be normalized)
   * @returns true if lock was released, false if lock doesn't exist or belongs to someone else
   * Silently fails if Redis is unavailable (graceful degradation)
   */
  async safeReleaseLock(
    resourceKey: string,
    ownerPhoneNumber: string
  ): Promise<boolean> {
    try {
      const normalized = normalizePhoneNumber(ownerPhoneNumber);
      const key = `${LOCK_KEY_PREFIX}${resourceKey}`;
      
      // Get current lock value
      const currentOwner = await redisClient.get(key);
      
      if (!currentOwner) {
        logger.debug(`Lock does not exist: ${key}`);
        return false;
      }
      
      // Check if we own the lock
      if (currentOwner !== normalized) {
        logger.warn(`Lock ${key} is owned by ${currentOwner}, not ${normalized}`);
        return false;
      }
      
      // Delete the lock
      await redisClient.del(key);
      logger.debug(`Lock released: ${key} by ${normalized}`);
      return true;
    } catch (error) {
      // Graceful degradation: log warning but don't throw
      logger.warn(`Redis unavailable, lock release skipped for ${resourceKey}:`, error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Releases a lock without ownership check (use with caution)
   * @param resourceKey - The resource key
   * Silently fails if Redis is unavailable (graceful degradation)
   */
  async releaseLock(resourceKey: string): Promise<void> {
    try {
      const key = `${LOCK_KEY_PREFIX}${resourceKey}`;
      await redisClient.del(key);
      logger.debug(`Lock force-released: ${key}`);
    } catch (error) {
      // Graceful degradation: log warning but don't throw
      logger.warn(`Redis unavailable, lock force-release skipped for ${resourceKey}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }
}

// Export singleton instance
export default new RedisService();

