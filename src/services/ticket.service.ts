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

      // Step 1: Optimistic locking - Update booking only if still PENDING or AWAITING_PAYMENT
      const updateResult = await prisma.booking.updateMany({
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

      // Check if update was successful (idempotency check)
      if (updateResult.count === 0) {
        // Booking was already processed or doesn't exist
        logger.warn(`Booking ${bookingId} already processed or not found`);
        
        // Check if it's already paid (idempotent - return existing tickets)
        const existingBooking = await prisma.booking.findUnique({
          where: { id: bookingId },
          include: {
            tickets: true,
          },
        });

        if (existingBooking?.status === 'PAID' && existingBooking.tickets.length > 0) {
          logger.info(`Booking ${bookingId} already paid, returning existing tickets`);
          return existingBooking.tickets.map(ticket => ({
            id: ticket.id,
            uniqueCode: ticket.uniqueCode,
            isRedeemed: ticket.isRedeemed,
          }));
        }

        throw new AppError(
          `Booking ${bookingId} not found or already processed`,
          404
        );
      }

      // Step 2: Fetch the updated booking with ticket tier
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          ticketTier: true,
        },
      });

      if (!booking) {
        throw new AppError(`Booking ${bookingId} not found after update`, 500);
      }

      // Step 3: Generate tickets based on quantity
      const ticketsToCreate: Prisma.TicketCreateManyInput[] = [];
      
      for (let i = 0; i < booking.quantity; i++) {
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
          bookingId: booking.id,
          isRedeemed: false,
        });
      }

      // Step 4: Create all tickets in a single transaction
      const createResult = await prisma.ticket.createMany({
        data: ticketsToCreate,
      });

      logger.info(
        `Generated ${createResult.count} tickets for booking ${bookingId}`
      );

      // Step 5: Fetch and return created tickets
      const createdTickets = await prisma.ticket.findMany({
        where: {
          bookingId: booking.id,
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

      // Step 6: Send visual tickets (QR codes) via WhatsApp
      // This is a new booking completion (not idempotent retry), so send images
      await this.sendTicketImages(bookingId, createdTickets);

      return createdTickets;
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
}

// Export singleton instance
export default new TicketService();

