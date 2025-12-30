import prisma from '../config/prisma';
import logger from '../config/logger';
import { AppError } from '../utils/AppError';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import qrCodeService from './assets/qr.service';
import whatsappService from './whatsapp.service';

/**
 * TicketService handles ticket generation and booking completion
 */
class TicketService {
  /**
   * Generates a unique ticket code in format XXXX-XXXX (4-4 alphanumeric)
   * @returns Formatted ticket code (e.g., AE92-8X4B)
   */
  private generateTicketCode(): string {
    // Generate 8 random bytes (16 hex characters)
    const bytes = crypto.randomBytes(4);
    const hex = bytes.toString('hex').toUpperCase();
    
    // Format as XXXX-XXXX
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
  }

  /**
   * Sends visual ticket images (QR codes) to user via WhatsApp
   * Uses best-effort delivery - logs errors but never throws
   * @param bookingId - The booking ID
   * @param tickets - Array of tickets with unique codes
   */
  private async sendTicketImages(
    bookingId: string,
    tickets: Array<{ id: string; uniqueCode: string; isRedeemed: boolean }>
  ): Promise<void> {
    try {
      // Fetch booking with event details for caption
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          user: true,
          ticketTier: {
            include: {
              event: true,
            },
          },
        },
      });

      if (!booking) {
        logger.error(`Cannot send ticket images: Booking ${bookingId} not found`);
        return;
      }

      const eventName = booking.ticketTier.event.title;
      const tierName = booking.ticketTier.name;
      const userPhone = booking.user.phoneNumber;

      logger.info(`Sending ${tickets.length} ticket images to ${userPhone} for booking ${bookingId}`);

      // Process all tickets in parallel (best effort)
      const imagePromises = tickets.map(async (ticket, index) => {
        try {
          // Generate QR code
          const qrBuffer = await qrCodeService.generateTicketCode(ticket.uniqueCode);

          // Upload to WhatsApp
          const mediaId = await whatsappService.uploadMedia(qrBuffer, 'image/png');

          // Send image with caption
          const caption = `🎟️ ${eventName} - ${tierName}`;
          await whatsappService.sendImage(userPhone, mediaId, caption);

          logger.info(`Ticket image sent: ${ticket.uniqueCode} (${index + 1}/${tickets.length})`);
        } catch (error) {
          // Log error but continue with other tickets (best effort)
          logger.error(`Failed to send ticket image for ${ticket.uniqueCode}:`, {
            error: error instanceof Error ? error.message : 'Unknown error',
            ticketCode: ticket.uniqueCode,
            bookingId,
          });
        }
      });

      // Wait for all images to complete (or fail)
      await Promise.all(imagePromises);

      logger.info(`Ticket image delivery completed for booking ${bookingId}`);
    } catch (error) {
      // Log error but never throw - ticket generation is already complete
      logger.error(`Failed to send ticket images for booking ${bookingId}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Completes a booking by marking it as paid and generating tickets
   * Uses optimistic locking to prevent double-processing
   * Sends visual ticket images (QR codes) via WhatsApp
   * @param bookingId - The booking ID
   * @param paymentRef - Payment reference (invoice ID or order tracking ID)
   * @param paymentPhone - Optional payment phone number from webhook
   * @returns Array of created tickets
   * @throws AppError if booking not found or already processed
   */
  async completeBooking(
    bookingId: string,
    paymentRef: string,
    paymentPhone?: string
  ): Promise<Array<{ id: string; uniqueCode: string; isRedeemed: boolean }>> {
    try {
      logger.info(`Completing booking: bookingId=${bookingId}, paymentRef=${paymentRef}`);

      // Step 1: Check if booking exists and get details (before transaction)
      const existingBooking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          ticketTier: true,
          tickets: true,
        },
      });

      // Idempotency check: If already paid, return existing tickets
      if (existingBooking?.status === 'PAID' && existingBooking.tickets.length > 0) {
        logger.info(`Booking ${bookingId} already paid, returning existing tickets`);
        return existingBooking.tickets.map(ticket => ({
          id: ticket.id,
          uniqueCode: ticket.uniqueCode,
          isRedeemed: ticket.isRedeemed,
        }));
      }

      if (!existingBooking) {
        throw new AppError(`Booking ${bookingId} not found`, 404);
      }

      // Check if booking is in a processable state
      if (existingBooking.status !== 'PENDING' && existingBooking.status !== 'AWAITING_PAYMENT') {
        throw new AppError(
          `Booking ${bookingId} is in ${existingBooking.status} state and cannot be completed`,
          400
        );
      }

      const tierId = existingBooking.ticketTierId;
      const quantity = existingBooking.quantity;

      // Step 2: Generate unique ticket codes (before transaction - safe as we check uniqueness)
      const ticketsToCreate: Prisma.TicketCreateManyInput[] = [];
      
      for (let i = 0; i < quantity; i++) {
        let uniqueCode: string;
        let isUnique = false;
        let attempts = 0;
        const maxAttempts = 10;

        // Ensure code is unique (retry if collision)
        while (!isUnique && attempts < maxAttempts) {
          uniqueCode = this.generateTicketCode();
          
          // Check if code already exists
          const existing = await prisma.ticket.findUnique({
            where: { uniqueCode },
          });

          if (!existing) {
            isUnique = true;
          } else {
            attempts++;
            logger.warn(`Ticket code collision detected: ${uniqueCode}, retrying...`);
          }
        }

        if (!isUnique) {
          throw new AppError(
            `Failed to generate unique ticket code after ${maxAttempts} attempts`,
            500
          );
        }

        ticketsToCreate.push({
          uniqueCode: uniqueCode!,
          bookingId: bookingId,
          isRedeemed: false,
        });
      }

      // Step 3: Atomic transaction - Update booking, increment quantitySold, create tickets
      const result = await prisma.$transaction(async (tx) => {
        // Update booking status (with optimistic locking)
        const updateResult = await tx.booking.updateMany({
          where: {
            id: bookingId,
            status: {
              in: ['PENDING', 'AWAITING_PAYMENT'],
            },
          },
          data: {
            status: 'PAID',
            paymentReference: paymentRef,
            ...(paymentPhone && { paymentPhoneNumber: paymentPhone }),
          },
        });

        if (updateResult.count === 0) {
          throw new AppError(
            `Booking ${bookingId} was already processed by another transaction`,
            409
          );
        }

        // Increment quantitySold for the ticket tier
        await tx.ticketTier.update({
          where: { id: tierId },
          data: {
            quantitySold: {
              increment: quantity,
            },
          },
        });

        // Create all tickets
        await tx.ticket.createMany({
          data: ticketsToCreate,
        });

        logger.info(
          `Transaction completed: Updated booking ${bookingId} to PAID, incremented quantitySold by ${quantity} for tier ${tierId}, created ${ticketsToCreate.length} tickets`
        );

        // Return created tickets
        return await tx.ticket.findMany({
          where: {
            bookingId: bookingId,
            uniqueCode: {
              in: ticketsToCreate.map(t => t.uniqueCode),
            },
          },
          select: {
            id: true,
            uniqueCode: true,
            isRedeemed: true,
          },
        });
      });

      // Step 4: Send visual tickets (QR codes) via WhatsApp (outside transaction)
      // This is a new booking completion (not idempotent retry), so send images
      await this.sendTicketImages(bookingId, result);

      return result;
    } catch (error) {
      logger.error(`Failed to complete booking ${bookingId}:`, error);

      if (error instanceof AppError) {
        throw error;
      }

      // Wrap unknown errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new AppError(
        `Failed to complete booking: ${errorMessage}`,
        500
      );
    }
  }

  /**
   * Cancels a paid booking and decrements quantitySold
   * Should be called when a booking is refunded or cancelled
   * Uses transaction to ensure atomicity
   * @param bookingId - The booking ID to cancel
   * @param reason - Optional reason for cancellation
   * @throws AppError if booking not found or not in a cancellable state
   */
  async cancelBooking(
    bookingId: string,
    reason?: string
  ): Promise<void> {
    try {
      logger.info(`Cancelling booking: bookingId=${bookingId}, reason=${reason || 'N/A'}`);

      // Step 1: Check if booking exists and is in a cancellable state
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          ticketTier: true,
        },
      });

      if (!booking) {
        throw new AppError(`Booking ${bookingId} not found`, 404);
      }

      // Only allow cancellation of PAID bookings (not already cancelled/failed)
      if (booking.status !== 'PAID') {
        throw new AppError(
          `Booking ${bookingId} is in ${booking.status} state and cannot be cancelled`,
          400
        );
      }

      const tierId = booking.ticketTierId;
      const quantity = booking.quantity;

      // Step 2: Atomic transaction - Update booking status and decrement quantitySold
      await prisma.$transaction(async (tx) => {
        // Update booking status to CANCELLED
        const updateResult = await tx.booking.updateMany({
          where: {
            id: bookingId,
            status: 'PAID', // Only cancel if still PAID (optimistic locking)
          },
          data: {
            status: 'CANCELLED',
          },
        });

        if (updateResult.count === 0) {
          throw new AppError(
            `Booking ${bookingId} was already cancelled or modified by another transaction`,
            409
          );
        }

        // Decrement quantitySold for the ticket tier
        await tx.ticketTier.update({
          where: { id: tierId },
          data: {
            quantitySold: {
              decrement: quantity,
            },
          },
        });

        logger.info(
          `Transaction completed: Updated booking ${bookingId} to CANCELLED, decremented quantitySold by ${quantity} for tier ${tierId}`
        );
      });
    } catch (error) {
      logger.error(`Failed to cancel booking ${bookingId}:`, error);

      if (error instanceof AppError) {
        throw error;
      }

      // Wrap unknown errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new AppError(
        `Failed to cancel booking: ${errorMessage}`,
        500
      );
    }
  }
}

// Export singleton instance
export default new TicketService();

