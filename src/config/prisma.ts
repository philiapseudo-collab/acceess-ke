import { PrismaClient } from '@prisma/client';
import logger from './logger';

// Singleton Prisma Client instance
// Prevents "Too many connections" errors in serverless/dev environments
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'],
});

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
  logger.info('Prisma client disconnected');
});

export default prisma;

