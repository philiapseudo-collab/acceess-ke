import app from './app';
import dotenv from 'dotenv';
import logger from './config/logger';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - let the server continue running
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  // Exit gracefully
  process.exit(1);
});

// Start server
try {
  const server = app.listen(PORT, () => {
    logger.info('AccessKE Bot Starting...');
    logger.info(`Server running on port ${PORT}`);
  });

  // Handle server errors
  server.on('error', (error: Error) => {
    logger.error('Server error:', error);
  });
} catch (error) {
  logger.error('Failed to start server:', error);
  process.exit(1);
}

