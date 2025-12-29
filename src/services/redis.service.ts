import redisClient from '../config/redis';
import logger from '../config/logger';
import { BotState, Session, SessionData } from '../types/session';
import { normalizePhoneNumber } from '../utils/phoneNormalizer';

const SESSION_TTL = parseInt(process.env.SESSION_TTL || '600', 10); // Default 10 minutes
const SESSION_KEY_PREFIX = 'session:';
const LOCK_KEY_PREFIX = 'lock:';

/**
 * In-memory session fallback when Redis is unavailable
 * Maps normalized phone number -> Session
 */
const inMemorySessions = new Map<string, { session: Session; expiresAt: number }>();

/**
 * RedisService handles session management and distributed locking
 * Falls back to in-memory storage when Redis is unavailable
 */
class RedisService {
  private isRedisAvailable: boolean = true;

  /**
   * Checks if Redis is available
   */
  private async checkRedisAvailability(): Promise<boolean> {
    try {
      await redisClient.ping();
      this.isRedisAvailable = true;
      return true;
    } catch (error) {
      this.isRedisAvailable = false;
      return false;
    }
  }

  /**
   * Cleans up expired in-memory sessions
   */
  private cleanupInMemorySessions(): void {
    const now = Date.now();
    for (const [key, value] of inMemorySessions.entries()) {
      if (value.expiresAt < now) {
        inMemorySessions.delete(key);
      }
    }
  }
  /**
   * Gets the session for a phone number
   * @param phoneNumber - Phone number (will be normalized)
   * @returns Session object with state and data, defaults to IDLE if missing
   * Falls back to in-memory storage if Redis is unavailable
   */
  async getSession(phoneNumber: string): Promise<Session> {
    const normalized = normalizePhoneNumber(phoneNumber);
    const key = `${SESSION_KEY_PREFIX}${normalized}`;
    
    try {
      // Try Redis first
      const sessionJson = await redisClient.get(key);
      
      if (sessionJson) {
        const session: Session = JSON.parse(sessionJson);
        return session;
      }
      
      // Not in Redis, check in-memory fallback
      this.cleanupInMemorySessions();
      const inMemory = inMemorySessions.get(normalized);
      if (inMemory && inMemory.expiresAt > Date.now()) {
        return inMemory.session;
      }
      
      // No session found, return default
      return {
        state: BotState.IDLE,
        data: {},
      };
    } catch (error) {
      // Redis unavailable - use in-memory fallback
      this.isRedisAvailable = false;
      this.cleanupInMemorySessions();
      
      const inMemory = inMemorySessions.get(normalized);
      if (inMemory && inMemory.expiresAt > Date.now()) {
        logger.debug(`Using in-memory session for ${normalized} (Redis unavailable)`);
        return inMemory.session;
      }
      
      // No in-memory session, return default
      logger.warn(`Redis unavailable, returning default session for ${normalized}:`, error instanceof Error ? error.message : 'Unknown error');
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
   * Falls back to in-memory storage if Redis is unavailable
   */
  async updateSession(
    phoneNumber: string,
    state: BotState,
    data?: Partial<SessionData>
  ): Promise<void> {
    const normalized = normalizePhoneNumber(phoneNumber);
    const key = `${SESSION_KEY_PREFIX}${normalized}`;
    
    // Get existing session (will use in-memory if Redis is down)
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
    
    try {
      // Try Redis first
      await redisClient.setex(key, SESSION_TTL, JSON.stringify(updatedSession));
      logger.debug(`Session updated in Redis for ${normalized}: state=${state}`);
    } catch (error) {
      // Redis unavailable - use in-memory fallback
      this.isRedisAvailable = false;
      const expiresAt = Date.now() + (SESSION_TTL * 1000);
      inMemorySessions.set(normalized, { session: updatedSession, expiresAt });
      logger.debug(`Session updated in-memory for ${normalized}: state=${state} (Redis unavailable)`);
    }
  }

  /**
   * Clears the session, resetting to IDLE state
   * @param phoneNumber - Phone number (will be normalized)
   * Falls back to in-memory storage if Redis is unavailable
   */
  async clearSession(phoneNumber: string): Promise<void> {
    const normalized = normalizePhoneNumber(phoneNumber);
    const key = `${SESSION_KEY_PREFIX}${normalized}`;
    
    const clearedSession: Session = {
      state: BotState.IDLE,
      data: {},
    };
    
    try {
      // Try Redis first
      await redisClient.setex(key, SESSION_TTL, JSON.stringify(clearedSession));
      logger.debug(`Session cleared in Redis for ${normalized}`);
    } catch (error) {
      // Redis unavailable - use in-memory fallback
      this.isRedisAvailable = false;
      const expiresAt = Date.now() + (SESSION_TTL * 1000);
      inMemorySessions.set(normalized, { session: clearedSession, expiresAt });
      logger.debug(`Session cleared in-memory for ${normalized} (Redis unavailable)`);
    }
    
    // Also clear from in-memory (in case it exists there)
    inMemorySessions.delete(normalized);
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

