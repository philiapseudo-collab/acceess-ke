import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

/**
 * Migration script to backfill quantitySold field
 * 
 * This script:
 * 1. Counts all PAID bookings per ticket tier
 * 2. Updates quantitySold for each tier based on the sum of quantities from PAID bookings
 * 3. Is idempotent (safe to run multiple times)
 * 
 * Run with: npx ts-node prisma/migrate-quantity-sold.ts
 */
async function main() {
  console.log('🔄 Starting quantitySold backfill migration...\n');

  try {
    // Step 1: Get all ticket tiers
    const tiers = await prisma.ticketTier.findMany({
      include: {
        bookings: {
          where: {
            status: 'PAID',
          },
          select: {
            quantity: true,
          },
        },
      },
    });

    console.log(`Found ${tiers.length} ticket tiers to process\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    // Step 2: Calculate and update quantitySold for each tier
    for (const tier of tiers) {
      // Calculate total quantity sold from PAID bookings
      const totalSold = tier.bookings.reduce((sum, booking) => sum + booking.quantity, 0);

      // Get current quantitySold (should be 0 for existing data, but check anyway)
      const currentQuantitySold = tier.quantitySold || 0;

      // Only update if there's a difference (idempotency)
      if (totalSold !== currentQuantitySold) {
        await prisma.ticketTier.update({
          where: { id: tier.id },
          data: {
            quantitySold: totalSold,
          },
        });

        console.log(
          `✅ Updated tier "${tier.name}" (${tier.id}): ` +
          `quantitySold: ${currentQuantitySold} → ${totalSold} ` +
          `(from ${tier.bookings.length} PAID bookings)`
        );
        updatedCount++;
      } else {
        console.log(
          `⏭️  Skipped tier "${tier.name}" (${tier.id}): ` +
          `quantitySold already correct (${currentQuantitySold})`
        );
        skippedCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  • Total tiers processed: ${tiers.length}`);
    console.log(`  • Tiers updated: ${updatedCount}`);
    console.log(`  • Tiers skipped (already correct): ${skippedCount}`);

    // Step 3: Verify the migration
    console.log('\n🔍 Verification: Checking for any discrepancies...');
    
    const verificationTiers = await prisma.ticketTier.findMany({
      include: {
        bookings: {
          where: {
            status: 'PAID',
          },
          select: {
            quantity: true,
          },
        },
      },
    });

    let discrepancies = 0;
    for (const tier of verificationTiers) {
      const expectedSold = tier.bookings.reduce((sum, booking) => sum + booking.quantity, 0);
      if (tier.quantitySold !== expectedSold) {
        console.error(
          `❌ Discrepancy found in tier "${tier.name}" (${tier.id}): ` +
          `quantitySold=${tier.quantitySold}, expected=${expectedSold}`
        );
        discrepancies++;
      }
    }

    if (discrepancies === 0) {
      console.log('✅ Verification passed: All tiers are correctly synced!');
    } else {
      console.error(`❌ Verification failed: Found ${discrepancies} discrepancies`);
      process.exit(1);
    }

    console.log('\n🎉 Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('❌ Migration script error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('\n👋 Prisma client disconnected');
  });

