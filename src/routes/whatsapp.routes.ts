import { Router } from 'express';
import whatsappController from '../controllers/whatsapp.controller';

const router = Router();

/**
 * WhatsApp webhook endpoints
 * GET /webhook - Webhook verification (Meta requirement)
 * POST /webhook - Incoming messages and events
 */
router.get('/webhook', (req, res) => {
  whatsappController.verifyWebhook(req, res).catch((error) => {
    // Fallback error handler
    console.error('Unhandled webhook verification error:', error);
    res.status(500).send('Internal error');
  });
});

router.post('/webhook', (req, res) => {
  whatsappController.receiveWebhook(req, res).catch((error) => {
    // Fallback error handler (response already sent, just log)
    console.error('Unhandled webhook receive error:', error);
  });
});

export default router;

