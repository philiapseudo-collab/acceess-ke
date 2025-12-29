import express from 'express';
import dotenv from 'dotenv';
import webhookRoutes from './routes/webhook.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import prisma from './config/prisma';
import logger from './config/logger';

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

// Health check endpoint with database check
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    
    // Check if events table is accessible
    const eventCount = await prisma.event.count();
    
    res.json({ 
      status: 'ok',
      database: 'connected',
      events: eventCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({ 
      status: 'error',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

export default app;

