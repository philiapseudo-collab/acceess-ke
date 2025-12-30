import redisService from '../services/redis.service';
import whatsappService from '../services/whatsapp.service';
import { intaSendService } from '../services/payment';
import { pesaPalService } from '../services/payment';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { BotState, SessionData } from '../types/session';
import { AppError } from '../utils/AppError';
import { normalizePhoneNumber } from '../utils/phoneNormalizer';
import { Prisma } from '@prisma/client';

/**
 * ConversationHandler manages the WhatsApp conversation flow
 * This is the core brain that orchestrates all services
 */
class ConversationHandler {
  private readonly GLOBAL_COMMANDS = ['hi', 'menu', 'start', 'restart', 'cancel'];
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
   * Sends the welcome menu (list of active events)
   * Includes retry logic for transient database connection errors
   * Prevents duplicate sends within cooldown period
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

      // Handle global commands
      if (this.GLOBAL_COMMANDS.includes(normalizedBody)) {
        await redisService.clearSession(normalizedPhone);
        await this.sendWelcomeMenu(normalizedPhone);
        await redisService.updateSession(normalizedPhone, BotState.BROWSING_EVENTS);
        return;
      }

      // Fetch current session state
      const { state, data } = await redisService.getSession(normalizedPhone);

      // Route based on state
      switch (state) {
        case BotState.IDLE:
          await this.sendWelcomeMenu(normalizedPhone);
          await redisService.updateSession(normalizedPhone, BotState.BROWSING_EVENTS);
          break;

        case BotState.BROWSING_EVENTS:
          await this.handleBrowsingEvents(normalizedPhone, message.id || message.body, userId);
          break;

        case BotState.SELECTING_TIER:
          await this.handleSelectingTier(normalizedPhone, message.id || message.body, data);
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
   * Handles BROWSING_EVENTS state
   */
  private async handleBrowsingEvents(
    phone: string,
    eventId: string,
    userId: string
  ): Promise<void> {
    try {
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

      if (!event || !event.isActive) {
        await whatsappService.sendText(
          phone,
          "That event is no longer available. Here are the current events:"
        );
        await this.sendWelcomeMenu(phone);
        await redisService.updateSession(phone, BotState.BROWSING_EVENTS);
        return;
      }

      // Filter tiers with available tickets (calculated: quantity - quantitySold > 0)
      const availableTiers = event.ticketTiers.filter(
        (tier) => tier.quantity - tier.quantitySold > 0
      );

      if (availableTiers.length === 0) {
        await whatsappService.sendText(
          phone,
          "Sorry, this event has no available tickets. Here are other events:"
        );
        await this.sendWelcomeMenu(phone);
        await redisService.updateSession(phone, BotState.BROWSING_EVENTS);
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

      const sections = [
        {
          title: 'Ticket Types',
          rows: availableTiers.map((tier) => {
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
          }),
        },
      ];

      await whatsappService.sendList(
        phone,
        bodyText,
        'View Tickets',
        sections
      );

      await redisService.updateSession(phone, BotState.SELECTING_TIER, {
        eventId: event.id,
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
      if (!data.eventId) {
        throw new AppError('Event ID missing from session', 500);
      }

      // Fetch tier
      const tier = await prisma.ticketTier.findUnique({
        where: { id: tierId },
        include: {
          event: true,
        },
      });

      if (!tier || tier.eventId !== data.eventId || !tier.event.isActive) {
        await whatsappService.sendText(
          phone,
          "That ticket type is no longer available. Here are the current events:"
        );
        await this.sendWelcomeMenu(phone);
        await redisService.updateSession(phone, BotState.BROWSING_EVENTS);
        return;
      }

      // Check availability using calculated field: quantity - quantitySold
      const available = tier.quantity - tier.quantitySold;
      if (available <= 0) {
        await whatsappService.sendText(
          phone,
          "Sorry, this ticket type is sold out. Here are other events:"
        );
        await this.sendWelcomeMenu(phone);
        await redisService.updateSession(phone, BotState.BROWSING_EVENTS);
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

