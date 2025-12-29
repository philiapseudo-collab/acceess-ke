import { Router } from 'express';
import webhookController from '../controllers/webhook.controller';

const router = Router();

/**
 * IntaSend webhook endpoint
 * POST /webhooks/intasend
 */
router.post('/intasend', (req, res) => {
  webhookController.handleIntaSend(req, res).catch((error) => {
    // Fallback error handler (should not reach here if controller handles properly)
    console.error('Unhandled webhook error:', error);
    res.status(500).send('Internal error');
  });
});

/**
 * PesaPal webhook endpoints
 * GET /webhooks/pesapal - URL validation
 * POST /webhooks/pesapal - Payment notification
 */
router.get('/pesapal', (req, res) => {
  webhookController.handlePesaPal(req, res).catch((error) => {
    console.error('Unhandled webhook error:', error);
    res.status(500).json({ status: 500, error: 'Internal error' });
  });
});

router.post('/pesapal', (req, res) => {
  webhookController.handlePesaPal(req, res).catch((error) => {
    console.error('Unhandled webhook error:', error);
    res.status(500).json({ status: 500, error: 'Internal error' });
  });
});

export default router;

