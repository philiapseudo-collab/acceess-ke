import prisma from '../config/prisma';
import { EventCategory } from '@prisma/client';

/**
 * EventService handles all event-related database operations
 */
class EventService {
  /**
   * Get all active events (for legacy/admin use)
   * Filters by isActive and future startTime
   */
  async getEvents(limit?: number) {
    return await prisma.event.findMany({
      where: {
        isActive: true,
        startTime: {
          gt: new Date(),
        },
      },
      include: {
        ticketTiers: {
          orderBy: {
            price: 'asc',
          },
        },
      },
      orderBy: {
        startTime: 'asc',
      },
      take: limit,
    });
  }

  /**
   * Get events filtered by category
   * Filters by isActive, future startTime, and category
   */
  async getEventsByCategory(category: EventCategory) {
    return await prisma.event.findMany({
      where: {
        isActive: true,
        startTime: {
          gt: new Date(),
        },
        category,
      },
      include: {
        ticketTiers: {
          orderBy: {
            price: 'asc',
          },
        },
      },
      orderBy: {
        startTime: 'asc',
      },
    });
  }

  /**
   * Get all available event categories
   * Returns the enum values as an array
   */
  async getCategories(): Promise<EventCategory[]> {
    return Object.values(EventCategory);
  }
}

// Export singleton instance
export default new EventService();

