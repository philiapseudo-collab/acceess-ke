import { Request, Response } from 'express';
import logger from '../config/logger';
import { AppError } from '../utils/AppError';
import ticketService from '../services/ticket.service';
import { pesaPalService } from '../services/payment';
import whatsappService from '../services/whatsapp.service';
import prisma from '../config/prisma';

/**
 * WebhookController handles payment provider webhooks
 */
class WebhookController {
  /**
   * Sends WhatsApp confirmation message after successful payment
   * @param bookingId - The booking ID
   */
  private async sendPaymentConfirmation(bookingId: string): Promise<void> {
    try {
      // Fetch booking with all related data
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          user: true,
          tickets: true,
          ticketTier: {
            include: {
              event: true,
            },
          },
        },
      });

      if (!booking) {
        logger.warn(`Cannot send confirmation: Booking ${bookingId} not found`);
        return;
      }

      // Format ticket codes
      const ticketCodes = booking.tickets.map((t) => t.uniqueCode).join('\n');

      // Format event date
      const eventDate = new Date(booking.ticketTier.event.startTime).toLocaleDateString('en-KE', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      // Build confirmation message
      const message =
        `✅ *Payment Successful!*\n\n` +
        `*Event:* ${booking.ticketTier.event.title}\n` +
        `*Date:* ${eventDate}\n` +
        `*Venue:* ${booking.ticketTier.event.venue}\n` +
        `*Tier:* ${booking.ticketTier.name}\n` +
        `*Quantity:* ${booking.quantity}\n` +
        `*Total:* KES ${booking.totalAmount}\n\n` +
        `*Your Ticket Codes:*\n${ticketCodes}\n\n` +
        `Show these codes at the venue entrance. Keep them safe! 🎫`;

      // Send WhatsApp message
      await whatsappService.sendText(booking.user.phoneNumber, message);

      logger.info(`Payment confirmation sent to ${booking.user.phoneNumber} for booking ${bookingId}`);
    } catch (error) {
      // Log error but don't throw - payment is already processed
      logger.error(`Failed to send payment confirmation for booking ${bookingId}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
  /**
   * Handles IntaSend webhook notifications
   * @param req - Express request
   * @param res - Express response
   */
  async handleIntaSend(req: Request, res: Response): Promise<void> {
    try {
      // Log entire payload for debugging
      logger.info('IntaSend webhook received:', JSON.stringify(req.body, null, 2));

      const { challenge, state, api_ref, invoice_id, account } = req.body;

      // Security check: Verify challenge
      if (challenge !== 'complete') {
        logger.warn('IntaSend webhook challenge mismatch:', challenge);
        res.status(400).send('Invalid challenge');
        return;
      }

      // Only process COMPLETE payments
      if (state !== 'COMPLETE') {
        logger.info(`IntaSend webhook: Payment not complete, state=${state}`);
        res.send('OK');
        return;
      }

      // Validate required fields
      if (!api_ref || !invoice_id) {
        logger.error('IntaSend webhook missing required fields:', { api_ref, invoice_id });
        res.status(400).send('Missing required fields');
        return;
      }

      // Complete the booking
      logger.info(`Processing IntaSend payment: bookingId=${api_ref}, invoiceId=${invoice_id}`);
      
      await ticketService.completeBooking(
        api_ref, // bookingId
        invoice_id, // paymentRef
        account // paymentPhone (optional)
      );

      logger.info(`IntaSend booking completed: ${api_ref}`);

      // Send WhatsApp confirmation (non-blocking)
      this.sendPaymentConfirmation(api_ref).catch((err) => {
        logger.error('Failed to send IntaSend payment confirmation:', err);
      });

      // IntaSend expects simple "OK" response
      res.send('OK');
    } catch (error) {
      logger.error('IntaSend webhook error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        body: req.body,
      });

      if (error instanceof AppError) {
        res.status(error.statusCode).send(error.message);
        return;
      }

      // Return OK even on error to prevent IntaSend from retrying
      // (We'll handle the error internally via logs)
      res.status(500).send('Internal error');
    }
  }

  /**
   * Handles PesaPal webhook notifications
   * Supports both GET (URL validation) and POST (actual notification)
   * @param req - Express request
   * @param res - Express response
   */
  async handlePesaPal(req: Request, res: Response): Promise<void> {
    try {
      // Log entire payload for debugging
      logger.info('PesaPal webhook received:', {
        method: req.method,
        query: req.query,
        body: req.body,
      });

      // Extract OrderTrackingId and OrderNotificationType from query OR body
      // PesaPal typically sends as query params even for POST requests
      const orderTrackingId = (req.query.OrderTrackingId as string) || req.body?.OrderTrackingId;
      const orderNotificationType = 
        (req.query.OrderNotificationType as string) || req.body?.OrderNotificationType;

      // Validate required fields
      if (!orderTrackingId) {
        logger.error('PesaPal webhook missing OrderTrackingId');
        throw new AppError('Missing OrderTrackingId', 400);
      }

      // For GET requests (URL validation), just return success
      if (req.method === 'GET') {
        logger.info('PesaPal URL validation request');
        res.json({
          orderNotificationType: orderNotificationType || 'IPN',
          orderTrackingId,
          status: 200,
        });
        return;
      }

      // For POST requests, verify transaction status
      logger.info(`Verifying PesaPal transaction: orderTrackingId=${orderTrackingId}`);

      const transactionStatus = await pesaPalService.getTransactionStatus(orderTrackingId);

      // Log full transaction status for debugging
      logger.debug('PesaPal transaction status:', JSON.stringify(transactionStatus, null, 2));

      // Check if payment is completed
      const paymentStatus = transactionStatus.payment_status_description || transactionStatus.status;
      
      if (paymentStatus === 'Completed' || paymentStatus === 'COMPLETED') {
        // Extract booking ID from merchant reference
        const bookingId = 
          transactionStatus.order_merchant_reference || 
          transactionStatus.merchant_reference ||
          transactionStatus.confirmation_code;

        if (!bookingId) {
          logger.error('PesaPal webhook: Payment completed but no booking ID found', transactionStatus);
          throw new AppError('Missing booking reference in transaction', 400);
        }

        // Extract payment reference
        const paymentRef = 
          transactionStatus.confirmation_code || 
          transactionStatus.order_tracking_id ||
          orderTrackingId;

        logger.info(`Processing PesaPal payment: bookingId=${bookingId}, paymentRef=${paymentRef}`);

        // Complete the booking
        await ticketService.completeBooking(
          bookingId,
          paymentRef,
          transactionStatus.phone_number // Optional payment phone
        );

        logger.info(`PesaPal booking completed: ${bookingId}`);

        // Send WhatsApp confirmation (non-blocking)
        this.sendPaymentConfirmation(bookingId).catch((err) => {
          logger.error('Failed to send PesaPal payment confirmation:', err);
        });
      } else {
        logger.info(`PesaPal payment not completed: status=${paymentStatus}`);
      }

      // PesaPal requires specific response format to stop retrying
      res.json({
        orderNotificationType: orderNotificationType || 'IPN',
        orderTrackingId,
        status: 200,
      });
    } catch (error) {
      logger.error('PesaPal webhook error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        query: req.query,
        body: req.body,
      });

      if (error instanceof AppError) {
        // Still return the expected format even on error
        const orderTrackingId = 
          (req.query.OrderTrackingId as string) || req.body?.OrderTrackingId;
        const orderNotificationType = 
          (req.query.OrderNotificationType as string) || req.body?.OrderNotificationType;

        res.status(error.statusCode).json({
          orderNotificationType: orderNotificationType || 'IPN',
          orderTrackingId: orderTrackingId || 'unknown',
          status: error.statusCode,
          error: error.message,
        });
        return;
      }

      // Return expected format even on unknown errors
      const orderTrackingId = 
        (req.query.OrderTrackingId as string) || req.body?.OrderTrackingId;
      const orderNotificationType = 
        (req.query.OrderNotificationType as string) || req.body?.OrderNotificationType;

      res.status(500).json({
        orderNotificationType: orderNotificationType || 'IPN',
        orderTrackingId: orderTrackingId || 'unknown',
        status: 500,
        error: 'Internal server error',
      });
    }
  }
}

// Export singleton instance
export default new WebhookController();

