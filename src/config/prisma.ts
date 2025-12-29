import { PrismaClient } from '@prisma/client';
import logger from './logger';

// Singleton Prisma Client instance
// Prevents "Too many connections" errors in serverless/dev environments
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Test database connection on initialization
async function testConnection() {
  try {
    await prisma.$connect();
    logger.info('✅ Database connection established');
    
    // Test query to ensure connection works
    await prisma.$queryRaw`SELECT 1`;
    logger.info('✅ Database query test passed');
  } catch (error) {
    logger.error('❌ Database connection failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      databaseUrl: process.env.DATABASE_URL ? 'Set (hidden)' : 'Not set',
    });
    // Don't throw - let the app start and handle errors gracefully
  }
}

// Run connection test (non-blocking)
testConnection().catch((error) => {
  logger.error('Connection test error:', error);
});

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
  logger.info('Prisma client disconnected');
});

export default prisma;

