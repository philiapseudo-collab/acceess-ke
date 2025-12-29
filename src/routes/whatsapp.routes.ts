import { Router } from 'express';
import whatsappController from '../controllers/whatsapp.controller';

const router = Router();

/**
 * WhatsApp webhook endpoints
 * GET /webhook - Webhook verification (Meta requirement)
 * POST /webhook - Incoming messages and events
 */
router.get('/webhook', async (req, res) => {
  try {
    await whatsappController.verifyWebhook(req, res);
  } catch (error) {
    // Fallback error handler - only send if response hasn't been sent
    if (!res.headersSent) {
      console.error('Unhandled webhook verification error:', error);
      res.status(500).send('Internal error');
    }
  }
});

router.post('/webhook', async (req, res) => {
  try {
    await whatsappController.receiveWebhook(req, res);
  } catch (error) {
    // Fallback error handler - only send if response hasn't been sent
    if (!res.headersSent) {
      console.error('Unhandled webhook receive error:', error);
      res.status(500).send('Internal error');
    }
  }
});

export default router;

