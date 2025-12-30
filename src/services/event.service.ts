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
    const now = new Date();
    const events = await prisma.event.findMany({
      where: {
        isActive: true,
        startTime: {
          gt: now,
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
    
    // Log for debugging
    console.log(`getEventsByCategory(${category}): Found ${events.length} events`);
    if (events.length > 0) {
      console.log(`Sample event IDs: ${events.slice(0, 3).map(e => e.id).join(', ')}`);
    }
    
    return events;
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

