import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

/**
 * Verification script for AccessKE database seed
 * Verifies that all expected events and ticket tiers are present with correct quantities
 */

// Expected events with their ticket tiers (name -> quantity)
const EXPECTED_EVENTS = [
  {
    title: "Freshers' Night: The Awakening",
    venue: 'UoN Grounds',
    tiers: [
      { name: 'Student ID', quantity: 1000 },
      { name: 'Outsider', quantity: 200 },
    ],
  },
  {
    title: "Mr. & Miss Campus Grand Finale",
    venue: 'UoN Taifa Hall',
    tiers: [
      { name: 'Regular', quantity: 500 },
      { name: 'VIP', quantity: 100 },
      { name: 'Judges Circle', quantity: 10 }, // Critical: Low stock for concurrency testing
    ],
  },
  {
    title: 'The Finalists Dinner (Black Tie)',
    venue: 'UoN Graduation Hall',
    tiers: [
      { name: 'Single Ticket', quantity: 150 },
      { name: 'Couples Table', quantity: 50 },
    ],
  },
  {
    title: 'Inter-Uni Gaming Championship',
    venue: 'Strathmore Student Center',
    tiers: [
      { name: 'Spectator', quantity: 300 },
      { name: 'Competitor Entry', quantity: 32 },
    ],
  },
  {
    title: 'Nairobi NYE Glow Fest 🎆',
    venue: 'KICC Grounds',
    tiers: [
      { name: 'Regular', quantity: 2000 },
      { name: 'VIP', quantity: 500 },
      { name: 'VVIP Golden Circle', quantity: 20 }, // Critical: Low stock
    ],
  },
  {
    title: 'Sunset & Sips: Rooftop Jazz',
    venue: 'GTC Rooftop, Westlands',
    tiers: [
      { name: 'General Admission', quantity: 40 },
      { name: 'Couples Table', quantity: 5 }, // Critical: Very low stock
    ],
  },
];

interface VerificationResult {
  eventTitle: string;
  found: boolean;
  venueMatch: boolean;
  tierCount: number;
  tierDetails: Array<{
    name: string;
    expected: number;
    actual: number;
    match: boolean;
  }>;
}

async function verifySeed() {
  console.log('🔍 Starting database verification...\n');

  try {
    // Fetch all events with their ticket tiers
    const events = await prisma.event.findMany({
      include: {
        ticketTiers: {
          orderBy: {
            name: 'asc',
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    console.log(`📊 Found ${events.length} events in database\n`);

    if (events.length !== EXPECTED_EVENTS.length) {
      console.error(
        `❌ Event count mismatch! Expected ${EXPECTED_EVENTS.length}, found ${events.length}`
      );
      process.exit(1);
    }

    const results: VerificationResult[] = [];
    let allPassed = true;

    // Verify each expected event
    for (const expected of EXPECTED_EVENTS) {
      const foundEvent = events.find((e) => e.title === expected.title);

      if (!foundEvent) {
        console.error(`❌ Event not found: "${expected.title}"`);
        results.push({
          eventTitle: expected.title,
          found: false,
          venueMatch: false,
          tierCount: 0,
          tierDetails: [],
        });
        allPassed = false;
        continue;
      }

      // Verify venue
      const venueMatch = foundEvent.venue === expected.venue;

      // Verify ticket tiers
      const tierDetails = expected.tiers.map((expectedTier) => {
        const actualTier = foundEvent.ticketTiers.find(
          (t) => t.name === expectedTier.name
        );

        if (!actualTier) {
          return {
            name: expectedTier.name,
            expected: expectedTier.quantity,
            actual: 0,
            match: false,
          };
        }

        const match = actualTier.quantity === expectedTier.quantity;
        return {
          name: expectedTier.name,
          expected: expectedTier.quantity,
          actual: actualTier.quantity,
          match,
        };
      });

      const allTiersMatch = tierDetails.every((t) => t.match);
      const allTiersFound = tierDetails.every((t) => t.actual > 0);

      if (!venueMatch || !allTiersMatch || !allTiersFound) {
        allPassed = false;
      }

      results.push({
        eventTitle: expected.title,
        found: true,
        venueMatch,
        tierCount: foundEvent.ticketTiers.length,
        tierDetails,
      });
    }

    // Print detailed results
    console.log('📋 Verification Results:\n');
    console.log('═'.repeat(80));

    for (const result of results) {
      const status = result.found && result.venueMatch && result.tierDetails.every((t) => t.match)
        ? '✅'
        : '❌';

      console.log(`\n${status} ${result.eventTitle}`);
      console.log(`   Venue: ${result.venueMatch ? '✅' : '❌'} (Expected: ${EXPECTED_EVENTS.find((e) => e.title === result.eventTitle)?.venue})`);

      if (!result.found) {
        console.log('   ⚠️  Event not found in database');
        continue;
      }

      console.log(`   Ticket Tiers: ${result.tierCount} (Expected: ${EXPECTED_EVENTS.find((e) => e.title === result.eventTitle)?.tiers.length})`);

      for (const tier of result.tierDetails) {
        const tierStatus = tier.match ? '✅' : '❌';
        console.log(
          `      ${tierStatus} ${tier.name}: ${tier.actual} (Expected: ${tier.expected})`
        );

        if (!tier.match) {
          console.log(`         ⚠️  Quantity mismatch!`);
        }
      }
    }

    console.log('\n' + '═'.repeat(80));

    // Summary
    const totalEvents = results.length;
    const passedEvents = results.filter(
      (r) => r.found && r.venueMatch && r.tierDetails.every((t) => t.match)
    ).length;

    const totalTiers = results.reduce((sum, r) => sum + r.tierDetails.length, 0);
    const passedTiers = results.reduce(
      (sum, r) => sum + r.tierDetails.filter((t) => t.match).length,
      0
    );

    console.log('\n📊 Summary:');
    console.log(`   Events: ${passedEvents}/${totalEvents} passed`);
    console.log(`   Ticket Tiers: ${passedTiers}/${totalTiers} passed`);

    if (allPassed) {
      console.log('\n✅ All verifications passed! Database seed is correct.\n');
      process.exit(0);
    } else {
      console.log('\n❌ Some verifications failed. Please check the details above.\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Verification failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verifySeed();

