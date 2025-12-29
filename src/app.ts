import express from 'express';
import dotenv from 'dotenv';
import webhookRoutes from './routes/webhook.routes';
import whatsappRoutes from './routes/whatsapp.routes';

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/webhooks', webhookRoutes);
app.use('/', whatsappRoutes); // WhatsApp webhook at /webhook

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'AccessKE Bot API',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      whatsapp: {
        webhook: '/webhook (GET for verification, POST for messages)',
      },
      webhooks: {
        intasend: '/webhooks/intasend (POST)',
        pesapal: '/webhooks/pesapal (GET/POST)',
      },
    },
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;

