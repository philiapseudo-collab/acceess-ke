import { Router, Request, Response } from 'express';
import logger from '../config/logger';

const router = Router();

/**
 * Payment success redirect endpoint
 * GET /payment/success
 * Redirects users back to WhatsApp after successful payment
 */
router.get('/success', (req: Request, res: Response) => {
  try {
    logger.info('User returned from payment', {
      query: req.query,
      headers: req.headers,
    });

    // Get bot phone number from environment
    const botPhoneNumber = process.env.BOT_PHONE_NUMBER;
    
    if (!botPhoneNumber) {
      logger.error('BOT_PHONE_NUMBER not configured');
      return res.status(500).send('Configuration error: BOT_PHONE_NUMBER not set');
    }

    // Normalize phone number (remove leading 0 if present, ensure it starts with country code)
    let normalizedPhone = botPhoneNumber.trim();
    if (normalizedPhone.startsWith('0')) {
      normalizedPhone = '254' + normalizedPhone.substring(1);
    } else if (!normalizedPhone.startsWith('254')) {
      normalizedPhone = '254' + normalizedPhone;
    }

    // Construct WhatsApp deep link to open the chat conversation
    // wa.me/{phone} opens the conversation with that number
    const whatsappUrl = `https://wa.me/${normalizedPhone}`;
    
    logger.info(`Redirecting user back to WhatsApp chat: ${whatsappUrl}`, {
      normalizedPhone,
      originalPhone: botPhoneNumber,
    });
    
    // Redirect to WhatsApp - this will open the existing conversation with the bot
    res.redirect(whatsappUrl);
  } catch (error) {
    logger.error('Error in payment success redirect:', error);
    res.status(500).send('An error occurred while redirecting. Please contact support.');
  }
});

export default router;

