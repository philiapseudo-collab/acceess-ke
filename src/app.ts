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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;

