import redisService from '../services/redis.service';
import whatsappService from '../services/whatsapp.service';
import { intaSendService } from '../services/payment';
import { pesaPalService } from '../services/payment';
import eventService from '../services/event.service';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { BotState, SessionData } from '../types/session';
import { AppError } from '../utils/AppError';
import { normalizePhoneNumber } from '../utils/phoneNormalizer';
import { Prisma, EventCategory } from '@prisma/client';

/**
 * ConversationHandler manages the WhatsApp conversation flow
 * This is the core brain that orchestrates all services
 */
class ConversationHandler {
  private readonly GLOBAL_COMMANDS = ['hi', 'menu', 'start', 'restart', 'reset', 'cancel'];
  private readonly MAX_QUANTITY = 5;
  private readonly LOCK_TTL_SECONDS = 600; // 10 minutes
  
  // Track last welcome menu sent time per phone to prevent loops
  private readonly lastWelcomeMenuSent = new Map<string, number>();
  private readonly WELCOME_MENU_COOLDOWN_MS = 5000; // 5 seconds cooldown

  /**
   * Formats phone number for display (254712... -> 0712...)
   */
  private formatPhoneForDisplay(phone: string): string {
    try {
      const normalized = normalizePhoneNumber(phone);
      if (normalized.startsWith('254')) {
        return '0' + normalized.slice(3);
      }
      return phone;
    } catch {
      return phone;
    }
  }

  /**
   * Normalizes message body for command matching (lowercase, trim)
   */
  private normalizeCommand(body: string): string {
    return body.toLowerCase().trim();
  }

  /**
   * Ensures user exists in database (upsert pattern)
   */
  private async ensureUser(phone: string, name?: string): Promise<string> {
    const normalizedPhone = normalizePhoneNumber(phone);

    // Try to find existing user
    let user = await prisma.user.findUnique({
      where: { phoneNumber: normalizedPhone },
    });

    // Create if doesn't exist
    if (!user) {
      user = await prisma.user.create({
        data: {
          phoneNumber: normalizedPhone,
          name: name || null,
        },
      });
      logger.info(`Created new user: ${normalizedPhone}`);
    } else if (name && user.name !== name) {
      // Update name if provided and different
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name },
      });
    }

    return user.id;
  }

  /**
   * Sends the category selection menu
   * Shows all available event categories as a List Message
   */
  private async sendCategoryMenu(phone: string, retryCount = 0): Promise<void> {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 1000;
    const normalizedPhone = normalizePhoneNumber(phone);

    // Prevent duplicate category menus within cooldown period
    const lastSent = this.lastWelcomeMenuSent.get(normalizedPhone);
    const now = Date.now();
    if (lastSent && (now - lastSent) < this.WELCOME_MENU_COOLDOWN_MS && retryCount === 0) {
      logger.debug(`Skipping duplicate category menu for ${normalizedPhone} (cooldown active)`);
      return;
    }

    try {
      // Ensure Prisma client is connected
      await prisma.$connect();

      // Get all categories
      const categories = await eventService.getCategories();

      // Map categories to display names with emojis
      const categoryDisplayMap: Record<EventCategory, string> = {
        [EventCategory.UNIVERSITY]: '🎓 University Events',
        [EventCategory.CONCERT]: '🎵 Concerts',
        [EventCategory.CLUB]: '🎉 Club Nights',
        [EventCategory.SOCIAL]: '🤝 Social Events',
        [EventCategory.HOLIDAY]: '🎆 Holiday Celebrations',
      };

      const sections = [
        {
          title: 'Event Categories',
          rows: categories.map((category) => ({
            id: category,
            title: categoryDisplayMap[category] || category,
          })),
        },
      ];

      await whatsappService.sendList(
        phone,
        '🎫 Welcome to AccessKE! Choose a category to explore events:',
        'Browse Categories',
        sections
      );
      
      // Track that we sent the category menu
      this.lastWelcomeMenuSent.set(normalizedPhone, Date.now());
    } catch (error) {
      // Enhanced error logging
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : 'Error';
      
      // Check if it's a connection error that might be retryable
      const isConnectionError = 
        errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('P1001') || // Prisma connection error code
        (error && typeof error === 'object' && 'code' in error && 
         (error.code === 'P1001' || error.code === 'P1002' || error.code === 'P1008'));

      logger.error('Failed to send category menu:', {
        error: errorMessage,
        name: errorName,
        stack: errorStack,
        phone,
        retryCount,
        isConnectionError,
        ...(error && typeof error === 'object' && 'code' in error ? { prismaCode: error.code } : {}),
      });

      // Retry on connection errors
      if (isConnectionError && retryCount < MAX_RETRIES) {
        logger.info(`Retrying category menu (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
        return this.sendCategoryMenu(phone, retryCount + 1);
      }
      
      await whatsappService.sendText(
        phone,
        "Sorry, I'm having trouble loading categories. Please try again later."
      );
    }
  }

  /**
   * Sends events for a specific category
   * Includes a BACK button to return to categories
   */
  private async sendEventsForCategory(phone: string, category: EventCategory, retryCount = 0): Promise<void> {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 1000;
    const normalizedPhone = normalizePhoneNumber(phone);

    try {
      // Ensure Prisma client is connected
      await prisma.$connect();

      // Fetch events for this category
      const events = await eventService.getEventsByCategory(category);

      if (events.length === 0) {
        await whatsappService.sendText(
          phone,
          `Sorry, there are no upcoming ${category.toLowerCase()} events at the moment. Check back later! 🎉`
        );
        return;
      }

      // Format events as list sections
      // WhatsApp limits: title max 24 chars, description max 72 chars
      const categoryDisplayMap: Record<EventCategory, string> = {
        [EventCategory.UNIVERSITY]: '🎓 University',
        [EventCategory.CONCERT]: '🎵 Concert',
        [EventCategory.CLUB]: '🎉 Club',
        [EventCategory.SOCIAL]: '🤝 Social',
        [EventCategory.HOLIDAY]: '🎆 Holiday',
      };

      const rows = events.map((event) => {
        // Truncate title to 24 chars (WhatsApp limit)
        const truncatedTitle = event.title.length > 24 
          ? event.title.substring(0, 21) + '...' 
          : event.title;
        
        // Format description: date and venue (max 72 chars)
        const dateStr = new Date(event.startTime).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric' 
        });
        const description = `${dateStr} • ${event.venue}`;
        const truncatedDescription = description.length > 72 
          ? description.substring(0, 69) + '...' 
          : description;

        return {
          id: event.id,
          title: truncatedTitle,
          description: truncatedDescription,
        };
      });

      // Add BACK button as the last row
      rows.push({
        id: 'BACK_TO_CATEGORIES',
        title: '🔙 Back to Categories',
        description: 'Return to category selection',
      });

      const sections = [
        {
          title: `${categoryDisplayMap[category]} Events`,
          rows,
        },
      ];

      await whatsappService.sendList(
        phone,
        `🎫 ${categoryDisplayMap[category]} Events. Select an event to view tickets:`,
        'View Events',
        sections
      );
    } catch (error) {
      // Enhanced error logging
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : 'Error';
      
      // Check if it's a connection error that might be retryable
      const isConnectionError = 
        errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('P1001') ||
        (error && typeof error === 'object' && 'code' in error && 
         (error.code === 'P1001' || error.code === 'P1002' || error.code === 'P1008'));

      logger.error('Failed to send events for category:', {
        error: errorMessage,
        name: errorName,
        stack: errorStack,
        phone,
        category,
        retryCount,
        isConnectionError,
        ...(error && typeof error === 'object' && 'code' in error ? { prismaCode: error.code } : {}),
      });

      // Retry on connection errors
      if (isConnectionError && retryCount < MAX_RETRIES) {
        logger.info(`Retrying events for category (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
        return this.sendEventsForCategory(phone, category, retryCount + 1);
      }
      
      await whatsappService.sendText(
        phone,
        "Sorry, I'm having trouble loading events. Please try again later."
      );
    }
  }

  /**
   * Sends the welcome menu (list of active events)
   * Includes retry logic for transient database connection errors
   * Prevents duplicate sends within cooldown period
   * NOTE: This is kept for legacy/admin use, but the main flow now uses categories
   */
  private async sendWelcomeMenu(phone: string, retryCount = 0): Promise<void> {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 1000;
    const normalizedPhone = normalizePhoneNumber(phone);

    // Prevent duplicate welcome menus within cooldown period
    const lastSent = this.lastWelcomeMenuSent.get(normalizedPhone);
    const now = Date.now();
    if (lastSent && (now - lastSent) < this.WELCOME_MENU_COOLDOWN_MS && retryCount === 0) {
      logger.debug(`Skipping duplicate welcome menu for ${normalizedPhone} (cooldown active)`);
      return;
    }

    try {
      // Ensure Prisma client is connected
      await prisma.$connect();

      // Fetch top 10 active events
      const events = await prisma.event.findMany({
        where: {
          isActive: true,
          startTime: {
            gt: new Date(),
          },
        },
        orderBy: {
          startTime: 'asc',
        },
        take: 10,
      });

      if (events.length === 0) {
        await whatsappService.sendText(
          phone,
          "Sorry, there are no upcoming events at the moment. Check back later! 🎉"
        );
        return;
      }

      // Format events as list sections
      // WhatsApp limits: title max 24 chars, description max 72 chars
      const sections = [
        {
          title: 'Upcoming Events',
          rows: events.map((event) => {
            // Truncate title to 24 chars (WhatsApp limit)
            const truncatedTitle = event.title.length > 24 
              ? event.title.substring(0, 21) + '...' 
              : event.title;
            
            // Format description: date and venue (max 72 chars)
            const dateStr = new Date(event.startTime).toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric' 
            });
            const description = `${dateStr} • ${event.venue}`;
            const truncatedDescription = description.length > 72 
              ? description.substring(0, 69) + '...' 
              : description;

            return {
              id: event.id,
              title: truncatedTitle,
              description: truncatedDescription,
            };
          }),
        },
      ];

      await whatsappService.sendList(
        phone,
        '🎫 Welcome to AccessKE! Select an event to get started:',
        'View Events',
        sections
      );
      
      // Track that we sent the welcome menu
      this.lastWelcomeMenuSent.set(normalizedPhone, Date.now());
    } catch (error) {
      // Enhanced error logging
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : 'Error';
      
      // Check if it's a connection error that might be retryable
      const isConnectionError = 
        errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('P1001') || // Prisma connection error code
        (error && typeof error === 'object' && 'code' in error && 
         (error.code === 'P1001' || error.code === 'P1002' || error.code === 'P1008'));

      logger.error('Failed to send welcome menu:', {
        error: errorMessage,
        name: errorName,
        stack: errorStack,
        phone,
        retryCount,
        isConnectionError,
        // Log Prisma-specific errors
        ...(error && typeof error === 'object' && 'code' in error ? { prismaCode: error.code } : {}),
      });

      // Retry on connection errors
      if (isConnectionError && retryCount < MAX_RETRIES) {
        logger.info(`Retrying welcome menu (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
        return this.sendWelcomeMenu(phone, retryCount + 1);
      }
      
      await whatsappService.sendText(
        phone,
        "Sorry, I'm having trouble loading events. Please try again later."
      );
    }
  }

  /**
   * Main entry point for handling incoming messages
   */
  async handleMessage(
    user: { phone: string; name?: string },
    message: { type: 'text' | 'interactive'; body: string; id?: string }
  ): Promise<void> {
    try {
      const normalizedPhone = normalizePhoneNumber(user.phone);
      const normalizedBody = this.normalizeCommand(message.body);

      logger.info(`Handling message from ${normalizedPhone}:`, {
        type: message.type,
        body: message.body,
        id: message.id,
      });

      // Ensure user exists
      const userId = await this.ensureUser(user.phone, user.name);

      // Handle global commands (reset/restart commands clear session and start fresh)
      if (this.GLOBAL_COMMANDS.includes(normalizedBody)) {
        logger.info(`Global command received: ${normalizedBody} from ${normalizedPhone} - clearing session and starting fresh`);
        await redisService.clearSession(normalizedPhone);
        await this.sendCategoryMenu(normalizedPhone);
        await redisService.updateSession(normalizedPhone, BotState.SELECTING_CATEGORY);
        return;
      }

      // Fetch current session state
      const { state, data } = await redisService.getSession(normalizedPhone);
      
      logger.info(`Message routing: phone=${normalizedPhone}, state=${state}, messageType=${message.type}, body=${message.body}, id=${message.id}`);

      // Route based on state
      switch (state) {
        case BotState.IDLE:
          await this.sendCategoryMenu(normalizedPhone);
          await redisService.updateSession(normalizedPhone, BotState.SELECTING_CATEGORY);
          break;

        case BotState.SELECTING_CATEGORY:
          // For interactive messages, use the ID from the list/button reply
          const categoryId = message.id || message.body;
          logger.info(`SELECTING_CATEGORY: phone=${normalizedPhone}, categoryId=${categoryId}`);
          await this.handleSelectingCategory(normalizedPhone, categoryId);
          break;

        case BotState.BROWSING_EVENTS:
          // For interactive messages, use the ID from the list/button reply
          const eventId = message.id || message.body;
          logger.info(`BROWSING_EVENTS: phone=${normalizedPhone}, eventId=${eventId}, state=${state}`);
          await this.handleBrowsingEvents(normalizedPhone, eventId, userId);
          break;

        case BotState.SELECTING_TIER:
          // Safety check: if user clicks BACK or if ID looks like an event ID, reset to categories
          const tierId = message.id || message.body;
          if (tierId === 'BACK_TO_CATEGORIES') {
            await this.sendCategoryMenu(normalizedPhone);
            await redisService.updateSession(normalizedPhone, BotState.SELECTING_CATEGORY);
            break;
          }
          // If tier lookup fails and it might be an event ID, reset state
          // This handles cases where state is stale from previous interaction
          await this.handleSelectingTier(normalizedPhone, tierId, data);
          break;

        case BotState.SELECTING_QUANTITY:
          await this.handleSelectingQuantity(normalizedPhone, message.body, data);
          break;

        case BotState.AWAITING_PAYMENT_METHOD:
          await this.handleAwaitingPaymentMethod(normalizedPhone, message.id || message.body, data, userId);
          break;

        case BotState.AWAITING_PAYMENT_PHONE:
          await this.handleAwaitingPaymentPhone(normalizedPhone, message.id || message.body, message.body, data, userId);
          break;

        default:
          logger.warn(`Unknown state: ${state}, resetting to IDLE`);
          await redisService.clearSession(normalizedPhone);
          await this.sendWelcomeMenu(normalizedPhone);
          await redisService.updateSession(normalizedPhone, BotState.BROWSING_EVENTS);
      }
    } catch (error) {
      logger.error('ConversationHandler error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        user: user.phone,
        message,
      });

      // Send error message to user
      try {
        await whatsappService.sendText(
          user.phone,
          "Sorry, something went wrong. Please try again or type 'menu' to start over."
        );
      } catch (sendError) {
        logger.error('Failed to send error message:', sendError);
      }
    }
  }

  /**
   * Handles SELECTING_CATEGORY state
   * User has selected a category, show events for that category
   */
  private async handleSelectingCategory(
    phone: string,
    categoryId: string
  ): Promise<void> {
    try {
      // Validate category
      if (!Object.values(EventCategory).includes(categoryId as EventCategory)) {
        await whatsappService.sendText(
          phone,
          "Invalid category selection. Please choose from the menu."
        );
        await this.sendCategoryMenu(phone);
        return;
      }

      const category = categoryId as EventCategory;
      
      // Send events for this category
      await this.sendEventsForCategory(phone, category);
      
      // Update state to BROWSING_EVENTS and store the selected category
      // This allows users to go back to events from ticket tiers
      await redisService.updateSession(phone, BotState.BROWSING_EVENTS, {
        selectedCategory: category,
      });
    } catch (error) {
      logger.error('Error handling SELECTING_CATEGORY:', error);
      throw error;
    }
  }

  /**
   * Handles BROWSING_EVENTS state
   * Handles both event selection and BACK button
   */
  private async handleBrowsingEvents(
    phone: string,
    eventId: string,
    userId: string
  ): Promise<void> {
    try {
      logger.info(`handleBrowsingEvents: phone=${phone}, eventId=${eventId}`);
      
      // Check if user clicked BACK button
      if (eventId === 'BACK_TO_CATEGORIES') {
        await this.sendCategoryMenu(phone);
        await redisService.updateSession(phone, BotState.SELECTING_CATEGORY, {});
        return;
      }
      
      // Safety check: If the ID looks like a category, handle it as category selection
      if (Object.values(EventCategory).includes(eventId as EventCategory)) {
        logger.warn(`User clicked category ${eventId} while in BROWSING_EVENTS state. Handling as category selection.`);
        await this.handleSelectingCategory(phone, eventId);
        return;
      }

      // Validate eventId format (should be a UUID)
      if (!eventId || eventId.length < 10) {
        logger.warn(`Invalid eventId format: ${eventId}`);
        await whatsappService.sendText(
          phone,
          "Invalid selection. Let's go back to categories:"
        );
        await this.sendCategoryMenu(phone);
        await redisService.updateSession(phone, BotState.SELECTING_CATEGORY, {});
        return;
      }

      // Fetch event with all ticket tiers
      const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
          ticketTiers: {
            orderBy: {
              price: 'asc',
            },
          },
        },
      });

      logger.info(`Event lookup result: found=${!!event}, isActive=${event?.isActive}, tiers=${event?.ticketTiers?.length || 0}`);

      if (!event) {
        logger.warn(`Event not found: eventId=${eventId}`);
        await whatsappService.sendText(
          phone,
          "That event is no longer available. Let's go back to categories:"
        );
        await this.sendCategoryMenu(phone);
        await redisService.updateSession(phone, BotState.SELECTING_CATEGORY);
        return;
      }

      if (!event.isActive) {
        logger.warn(`Event is inactive: eventId=${eventId}, title=${event.title}`);
        await whatsappService.sendText(
          phone,
          "That event is no longer available. Let's go back to categories:"
        );
        await this.sendCategoryMenu(phone);
        await redisService.updateSession(phone, BotState.SELECTING_CATEGORY);
        return;
      }

      // Filter tiers with available tickets (calculated: quantity - quantitySold > 0)
      const availableTiers = event.ticketTiers.filter(
        (tier) => tier.quantity - tier.quantitySold > 0
      );

      if (availableTiers.length === 0) {
        await whatsappService.sendText(
          phone,
          "Sorry, this event has no available tickets. Let's go back to categories:"
        );
        await this.sendCategoryMenu(phone);
        await redisService.updateSession(phone, BotState.SELECTING_CATEGORY);
        return;
      }

      // Format ticket tiers as list
      // WhatsApp limits: body max 1024 chars, title max 24 chars, description max 72 chars
      const eventTitle = event.title.length > 50 ? event.title.substring(0, 47) + '...' : event.title;
      const eventDescription = event.description 
        ? (event.description.length > 200 ? event.description.substring(0, 197) + '...' : event.description)
        : '';
      
      // Build body text (max 1024 chars total)
      let bodyText = `🎫 ${eventTitle}`;
      if (eventDescription) {
        bodyText += `\n\n${eventDescription}`;
      }
      bodyText += '\n\nSelect a ticket type:';
      
      // Truncate body if needed (leave some margin)
      if (bodyText.length > 1000) {
        bodyText = bodyText.substring(0, 997) + '...';
      }

      const rows = availableTiers.map((tier) => {
        // Format price (remove decimals if .00)
        const priceStr = tier.price.toNumber().toFixed(0);
        // Calculate available tickets: quantity - quantitySold
        const available = tier.quantity - tier.quantitySold;
        const description = `KES ${priceStr} • ${available} available`;
        
        return {
          id: tier.id,
          title: tier.name, // Will be truncated by WhatsApp service if needed
          description: description, // Will be truncated by WhatsApp service if needed
        };
      });

      // Add BACK button - go to category menu (safer when category context might be lost after event switching)
      rows.push({
        id: 'BACK_TO_CATEGORIES',
        title: '🔙 Back to Categories',
        description: 'Return to category selection',
      });

      const sections = [
        {
          title: 'Ticket Types',
          rows,
        },
      ];

      await whatsappService.sendList(
        phone,
        bodyText,
        'View Tickets',
        sections
      );

      // Get current session to preserve selectedCategory
      const { data: currentData } = await redisService.getSession(phone);
      await redisService.updateSession(phone, BotState.SELECTING_TIER, {
        eventId: event.id,
        selectedCategory: currentData?.selectedCategory, // Preserve category for back navigation
      });
    } catch (error) {
      logger.error('Error handling BROWSING_EVENTS:', error);
      throw error;
    }
  }

  /**
   * Handles SELECTING_TIER state
   */
  private async handleSelectingTier(
    phone: string,
    tierId: string,
    data: SessionData
  ): Promise<void> {
    try {
      logger.info(`handleSelectingTier: phone=${phone}, tierId=${tierId}, eventId=${data.eventId}, category=${data.selectedCategory}`);
      
      // Handle BACK button - go to category menu (safer when category context might be lost)
      if (tierId === 'BACK_TO_EVENTS' || tierId === 'BACK_TO_CATEGORIES') {
        logger.info(`User clicked BACK (${tierId}) from ticket tiers, going to category menu`);
        await this.sendCategoryMenu(phone);
        await redisService.updateSession(phone, BotState.SELECTING_CATEGORY, {});
        return;
      }
      
      // Safety check: if tierId is empty or invalid
      if (!tierId) {
        logger.warn(`Invalid tierId in SELECTING_TIER: tierId=${tierId}`);
        // Try to go back to events if we have a category
        if (data.selectedCategory && Object.values(EventCategory).includes(data.selectedCategory as EventCategory)) {
          await this.sendEventsForCategory(phone, data.selectedCategory as EventCategory);
          await redisService.updateSession(phone, BotState.BROWSING_EVENTS, {
            selectedCategory: data.selectedCategory,
          });
          return;
        }
        await this.sendCategoryMenu(phone);
        await redisService.updateSession(phone, BotState.SELECTING_CATEGORY, {});
        return;
      }
      
      if (!data.eventId) {
        logger.error(`Event ID missing from session in SELECTING_TIER: phone=${phone}`);
        await this.sendCategoryMenu(phone);
        await redisService.updateSession(phone, BotState.SELECTING_CATEGORY);
        return;
      }

      // Fetch tier
      const tier = await prisma.ticketTier.findUnique({
        where: { id: tierId },
        include: {
          event: true,
        },
      });

      // If tier not found, check if this might be an event ID (user switched events)
      if (!tier) {
        logger.info(`Tier not found: tierId=${tierId}. Checking if it's an event ID for event switching...`);
        
        // Dual lookup: Check if this ID is actually an event ID
        const newEvent = await prisma.event.findUnique({
          where: { id: tierId },
          include: {
            ticketTiers: {
              orderBy: {
                price: 'asc',
              },
            },
          },
        });
        
        if (newEvent) {
          // User switched events - validate and show new event's ticket tiers
          logger.info(`User switched event from ${data.eventId} to ${tierId} (${newEvent.title})`);
          
          // Validate event: must be active and in the future
          const now = new Date();
          if (!newEvent.isActive) {
            logger.warn(`Switched event is inactive: eventId=${tierId}`);
            await whatsappService.sendText(
              phone,
              "This event is no longer available. Let's go back to categories:"
            );
            await this.sendCategoryMenu(phone);
            await redisService.updateSession(phone, BotState.SELECTING_CATEGORY, {});
            return;
          }
          
          if (newEvent.startTime <= now) {
            logger.warn(`Switched event has ended: eventId=${tierId}, startTime=${newEvent.startTime}`);
            await whatsappService.sendText(
              phone,
              "This event has ended. Let's go back to categories:"
            );
            await this.sendCategoryMenu(phone);
            await redisService.updateSession(phone, BotState.SELECTING_CATEGORY, {});
            return;
          }
          
          // Event is valid - show its ticket tiers (silent switch)
          const availableTiers = newEvent.ticketTiers.filter(
            (t) => t.quantity - t.quantitySold > 0
          );
          
          if (availableTiers.length === 0) {
            await whatsappService.sendText(
              phone,
              "Sorry, this event has no available tickets. Let's go back to categories:"
            );
            await this.sendCategoryMenu(phone);
            await redisService.updateSession(phone, BotState.SELECTING_CATEGORY, {});
            return;
          }
          
          // Format ticket tiers for the new event
          const eventTitle = newEvent.title.length > 50 ? newEvent.title.substring(0, 47) + '...' : newEvent.title;
          const eventDescription = newEvent.description 
            ? (newEvent.description.length > 200 ? newEvent.description.substring(0, 197) + '...' : newEvent.description)
            : '';
          
          let bodyText = `🎫 ${eventTitle}`;
          if (eventDescription) {
            bodyText += `\n\n${eventDescription}`;
          }
          bodyText += '\n\nSelect a ticket type:';
          
          if (bodyText.length > 1000) {
            bodyText = bodyText.substring(0, 997) + '...';
          }
          
          const rows = availableTiers.map((t) => {
            const priceStr = t.price.toNumber().toFixed(0);
            const available = t.quantity - t.quantitySold;
            const description = `KES ${priceStr} • ${available} available`;
            
            return {
              id: t.id,
              title: t.name,
              description: description,
            };
          });
          
          // Add BACK button - go to category menu (since category context might be lost)
          rows.push({
            id: 'BACK_TO_CATEGORIES',
            title: '🔙 Back to Categories',
            description: 'Return to category selection',
          });
          
          const sections = [
            {
              title: 'Ticket Types',
              rows,
            },
          ];
          
          await whatsappService.sendList(
            phone,
            bodyText,
            'View Tickets',
            sections
          );
          
          // Update session with new event ID, preserve category if available
          await redisService.updateSession(phone, BotState.SELECTING_TIER, {
            eventId: newEvent.id,
            selectedCategory: data.selectedCategory, // Preserve if available, but allow category switching
          });
          
          return; // Event switch complete
        }
        
        // Not an event ID either - invalid selection
        logger.warn(`Invalid tier/event ID: tierId=${tierId}`);
        await whatsappService.sendText(
          phone,
          "That selection is no longer available. Let's go back to categories:"
        );
        await this.sendCategoryMenu(phone);
        await redisService.updateSession(phone, BotState.SELECTING_CATEGORY, {});
        return;
      }

      // Validate tier belongs to the event in session
      if (tier.eventId !== data.eventId || !tier.event.isActive) {
        logger.warn(`Tier validation failed: tier=${!!tier}, eventIdMatch=${tier?.eventId === data.eventId}, eventActive=${tier?.event?.isActive}`);
        await whatsappService.sendText(
          phone,
          "That ticket type is no longer available. Let's go back to categories:"
        );
        await this.sendCategoryMenu(phone);
        await redisService.updateSession(phone, BotState.SELECTING_CATEGORY);
        return;
      }

      // Check availability using calculated field: quantity - quantitySold
      const available = tier.quantity - tier.quantitySold;
      if (available <= 0) {
        logger.warn(`Tier sold out: tierId=${tierId}, available=${available}`);
        await whatsappService.sendText(
          phone,
          "Sorry, this ticket type is sold out. Let's go back to categories:"
        );
        await this.sendCategoryMenu(phone);
        await redisService.updateSession(phone, BotState.SELECTING_CATEGORY);
        return;
      }

      await whatsappService.sendText(
        phone,
        `How many ${tier.name} tickets would you like? (Max ${this.MAX_QUANTITY})`
      );

      await redisService.updateSession(phone, BotState.SELECTING_QUANTITY, {
        tierId: tier.id,
      });
    } catch (error) {
      logger.error('Error handling SELECTING_TIER:', error);
      throw error;
    }
  }

  /**
   * Handles SELECTING_QUANTITY state
   */
  private async handleSelectingQuantity(
    phone: string,
    body: string,
    data: SessionData
  ): Promise<void> {
    try {
      if (!data.tierId) {
        throw new AppError('Tier ID missing from session', 500);
      }

      // Parse quantity
      const quantity = parseInt(body, 10);

      if (isNaN(quantity) || quantity < 1 || quantity > this.MAX_QUANTITY) {
        await whatsappService.sendText(
          phone,
          `Please type a number between 1 and ${this.MAX_QUANTITY}.`
        );
        return; // Stay in same state
      }

      // Fetch tier to get price
      const tier = await prisma.ticketTier.findUnique({
        where: { id: data.tierId },
      });

      if (!tier) {
        throw new AppError('Tier not found', 404);
      }

      // Calculate total amount
      const totalAmount = Prisma.Decimal.mul(tier.price, quantity);

      // Acquire lock (session lock to prevent spam)
      const lockKey = `tier:${data.tierId}:user:${phone}`;
      const lockAcquired = await redisService.acquireLock(
        lockKey,
        this.LOCK_TTL_SECONDS,
        phone
      );

      if (!lockAcquired) {
        await whatsappService.sendText(
          phone,
          "Sorry, high demand. Please try again in a moment."
        );
        await redisService.updateSession(phone, BotState.IDLE);
        return;
      }

      // Update session with quantity and total
      await redisService.updateSession(phone, BotState.AWAITING_PAYMENT_METHOD, {
        quantity,
        totalAmount: totalAmount.toNumber(),
      });

      // Send payment method selection
      await whatsappService.sendButtons(
        phone,
        `Pay KES ${totalAmount.toString()} via:`,
        [
          { id: 'mpesa', title: 'M-Pesa' },
          { id: 'card', title: 'Card' },
        ]
      );
    } catch (error) {
      logger.error('Error handling SELECTING_QUANTITY:', error);
      throw error;
    }
  }

  /**
   * Handles AWAITING_PAYMENT_METHOD state
   */
  private async handleAwaitingPaymentMethod(
    phone: string,
    methodId: string,
    data: SessionData,
    userId: string
  ): Promise<void> {
    try {
      if (!data.tierId || !data.quantity || !data.totalAmount) {
        throw new AppError('Missing session data for payment', 500);
      }

      if (methodId === 'mpesa') {
        // Ask if user wants to use current number
        const displayPhone = this.formatPhoneForDisplay(phone);
        await whatsappService.sendButtons(
          phone,
          `Use current number ${displayPhone}?`,
          [
            { id: 'yes', title: 'Yes' },
            { id: 'no', title: 'No (Use Different)' },
          ]
        );

        await redisService.updateSession(phone, BotState.AWAITING_PAYMENT_PHONE, {
          paymentMethod: 'MPESA',
        });
      } else if (methodId === 'card') {
        // Create booking for card payment
        const booking = await prisma.booking.create({
          data: {
            userId,
            ticketTierId: data.tierId,
            quantity: data.quantity,
            totalAmount: new Prisma.Decimal(data.totalAmount),
            status: 'AWAITING_PAYMENT',
            paymentMethod: 'CARD',
            paymentPhoneNumber: phone,
            expiryTime: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
          },
        });

        // Get payment link
        const tier = await prisma.ticketTier.findUnique({
          where: { id: data.tierId },
          include: {
            event: true,
          },
        });

        const user = await prisma.user.findUnique({
          where: { id: userId },
        });

        if (!tier || !user) {
          throw new AppError('Failed to fetch booking details', 500);
        }

        const paymentLink = await pesaPalService.getPaymentLink({
          id: booking.id,
          amount: data.totalAmount,
          email: `${phone}@accesske.local`, // Placeholder email
          phone: phone,
          firstName: user.name?.split(' ')[0] || 'User',
          lastName: user.name?.split(' ').slice(1).join(' ') || '',
        });

        await whatsappService.sendText(
          phone,
          `Click here to pay: ${paymentLink}\n\nAfter payment, you'll receive your tickets automatically.`
        );

        // Reset to IDLE (waiting for webhook)
        await redisService.clearSession(phone);
      } else {
        await whatsappService.sendText(
          phone,
          "Please select a payment method using the buttons above."
        );
      }
    } catch (error) {
      logger.error('Error handling AWAITING_PAYMENT_METHOD:', error);
      throw error;
    }
  }

  /**
   * Handles AWAITING_PAYMENT_PHONE state
   */
  private async handleAwaitingPaymentPhone(
    phone: string,
    buttonId: string | undefined,
    body: string,
    data: SessionData,
    userId: string
  ): Promise<void> {
    try {
      if (!data.tierId || !data.quantity || !data.totalAmount) {
        throw new AppError('Missing session data for payment', 500);
      }

      let paymentPhone: string;

      if (buttonId === 'yes') {
        // Use current WhatsApp number
        paymentPhone = phone;
      } else if (buttonId === 'no' || body) {
        // User provided different number
        // Validate phone number
        const normalized = normalizePhoneNumber(body);
        paymentPhone = normalized;
      } else {
        await whatsappService.sendText(
          phone,
          "Please reply with the M-Pesa number in the format 07XX..."
        );
        return; // Stay in same state
      }

      // Create booking
      const booking = await prisma.booking.create({
        data: {
          userId,
          ticketTierId: data.tierId,
          quantity: data.quantity,
          totalAmount: new Prisma.Decimal(data.totalAmount),
          status: 'AWAITING_PAYMENT',
          paymentMethod: 'MPESA',
          paymentPhoneNumber: paymentPhone,
          expiryTime: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        },
      });

      // Initiate STK Push
      try {
        const stkResponse = await intaSendService.initiateSTKPush(
          paymentPhone,
          data.totalAmount,
          booking.id // apiRef
        );

        await whatsappService.sendText(
          phone,
          "STK Push sent! Please enter your M-Pesa PIN to complete payment."
        );

        // Update session to track STK push
        await redisService.updateSession(phone, BotState.AWAITING_STK_PUSH, {
          tempBookingId: booking.id,
        });
      } catch (stkError) {
        logger.error('STK Push failed:', stkError);

        // Soft retry - don't reset to IDLE
        await whatsappService.sendText(
          phone,
          "We couldn't reach M-Pesa. Please try again or choose Card."
        );

        // Return to payment method selection
        await redisService.updateSession(phone, BotState.AWAITING_PAYMENT_METHOD);
      }
    } catch (error) {
      logger.error('Error handling AWAITING_PAYMENT_PHONE:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default new ConversationHandler();

