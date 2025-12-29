import app from './app';
import dotenv from 'dotenv';
import logger from './config/logger';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

// TODO: Initialize database connection (Prisma)
// TODO: Initialize Redis connection

app.listen(PORT, () => {
  logger.info('AccessKE Bot Starting...');
  logger.info(`Server running on port ${PORT}`);
});

