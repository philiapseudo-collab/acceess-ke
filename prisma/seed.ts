import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

/**
 * Database seed script for AccessKE
 * Populates Events and TicketTiers with mock data for testing
 */

async function main() {
  console.log('🌱 Starting database seed...');

  // Clean existing data (deleteMany for idempotency)
  console.log('🧹 Cleaning existing events and tiers...');
  await prisma.ticketTier.deleteMany({});
  await prisma.event.deleteMany({});
  console.log('✅ Cleanup complete');

  // Helper to create events with tiers
  const createEventWithTiers = async (
    title: string,
    description: string,
    venue: string,
    startTime: Date,
    endTime: Date,
    tiers: Array<{ name: string; price: number; quantity: number }>
  ) => {
    const event = await prisma.event.create({
      data: {
        title,
        description,
        venue,
        startTime,
        endTime,
        isActive: true,
        bannerUrl: null,
        ticketTiers: {
          create: tiers.map((tier) => ({
            name: tier.name,
            price: new Prisma.Decimal(tier.price),
            quantity: tier.quantity,
          })),
        },
      },
      include: {
        ticketTiers: true,
      },
    });

    console.log(`✅ Created: ${event.title} (${event.ticketTiers.length} tiers)`);
    return event;
  };

  // Calculate dates (spread over next few weeks)
  const now = new Date();
  const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const threeWeeksFromNow = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);
  const fourWeeksFromNow = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);
  const fiveWeeksFromNow = new Date(now.getTime() + 35 * 24 * 60 * 60 * 1000);

  // Event A: Freshers' Night: The Awakening (1 week from now)
  const eventAStart = new Date(oneWeekFromNow);
  eventAStart.setHours(19, 0, 0, 0);
  const eventAEnd = new Date(oneWeekFromNow);
  eventAEnd.setHours(23, 59, 0, 0);
  await createEventWithTiers(
    "Freshers' Night: The Awakening",
    'A chaotic, high-energy welcome party for first-years. Experience the ultimate campus initiation with live DJs, performances, and unforgettable memories.',
    'UoN Grounds',
    eventAStart,
    eventAEnd,
    [
      { name: 'Student ID', price: 500, quantity: 1000 },
      { name: 'Outsider', price: 1500, quantity: 200 },
    ]
  );

  // Event B: Mr. & Miss Campus Grand Finale (2 weeks from now)
  const eventBStart = new Date(twoWeeksFromNow);
  eventBStart.setHours(18, 0, 0, 0);
  const eventBEnd = new Date(twoWeeksFromNow);
  eventBEnd.setHours(22, 0, 0, 0);
  await createEventWithTiers(
    "Mr. & Miss Campus Grand Finale",
    'A prestigious fashion and talent show showcasing the best of campus. High demand for VIP seats with exclusive access to judges and performers.',
    'UoN Taifa Hall',
    eventBStart,
    eventBEnd,
    [
      { name: 'Regular', price: 300, quantity: 500 },
      { name: 'VIP', price: 1000, quantity: 100 },
      { name: 'Judges Circle', price: 3000, quantity: 10 }, // Low stock for concurrency testing
    ]
  );

  // Event C: The Finalists Dinner (Black Tie) (3 weeks from now)
  const eventCStart = new Date(threeWeeksFromNow);
  eventCStart.setHours(19, 0, 0, 0);
  const eventCEnd = new Date(threeWeeksFromNow);
  eventCEnd.setHours(23, 0, 0, 0);
  await createEventWithTiers(
    'The Finalists Dinner (Black Tie)',
    'An exclusive, elegant dinner for the graduating class. Celebrate your achievements in style with fine dining and networking opportunities.',
    'UoN Graduation Hall',
    eventCStart,
    eventCEnd,
    [
      { name: 'Single Ticket', price: 2500, quantity: 150 },
      { name: 'Couples Table', price: 4500, quantity: 50 },
    ]
  );

  // Event D: Inter-Uni Gaming Championship (4 weeks from now)
  const eventDStart = new Date(fourWeeksFromNow);
  eventDStart.setHours(14, 0, 0, 0);
  const eventDEnd = new Date(fourWeeksFromNow);
  eventDEnd.setHours(20, 0, 0, 0);
  await createEventWithTiers(
    'Inter-Uni Gaming Championship',
    'E-sports tournament featuring the best gamers from universities across Kenya. Watch intense competitions or compete yourself!',
    'Strathmore Student Center',
    eventDStart,
    eventDEnd,
    [
      { name: 'Spectator', price: 100, quantity: 300 },
      { name: 'Competitor Entry', price: 1000, quantity: 32 }, // Bracket style
    ]
  );

  // Event E: Nairobi NYE Glow Fest 🎆 (5 weeks from now - New Year's Eve)
  const nyeDate = new Date(fiveWeeksFromNow);
  nyeDate.setMonth(11); // December
  nyeDate.setDate(31);
  const nyeStart = new Date(nyeDate);
  nyeStart.setHours(18, 0, 0, 0); // 6 PM
  const nyeEnd = new Date(nyeDate);
  nyeEnd.setDate(nyeEnd.getDate() + 1); // Next day
  nyeEnd.setHours(6, 0, 0, 0); // 6 AM (12 hours duration)
  await createEventWithTiers(
    'Nairobi NYE Glow Fest 🎆',
    'Ring in the New Year with the most spectacular celebration in Nairobi! Live performances, fireworks, and unforgettable memories.',
    'KICC Grounds',
    nyeStart,
    nyeEnd,
    [
      { name: 'Regular', price: 2500, quantity: 2000 },
      { name: 'VIP', price: 8000, quantity: 500 },
      { name: 'VVIP Golden Circle', price: 20000, quantity: 20 },
    ]
  );

  // Event F: Sunset & Sips: Rooftop Jazz (2 weeks from now, different day)
  const jazzDate = new Date(twoWeeksFromNow);
  jazzDate.setDate(jazzDate.getDate() + 2); // 2 days after Event B
  const jazzStart = new Date(jazzDate);
  jazzStart.setHours(17, 0, 0, 0); // 5 PM
  const jazzEnd = new Date(jazzDate);
  jazzEnd.setHours(22, 0, 0, 0); // 10 PM
  await createEventWithTiers(
    'Sunset & Sips: Rooftop Jazz',
    'An intimate evening of smooth jazz, cocktails, and stunning city views. Perfect for a romantic date or networking event.',
    'GTC Rooftop, Westlands',
    jazzStart,
    jazzEnd,
    [
      { name: 'General Admission', price: 3000, quantity: 40 },
      { name: 'Couples Table', price: 10000, quantity: 5 }, // Sold out test tier
    ]
  );

  console.log('\n🎉 Database seed completed successfully!');
  console.log('\n📊 Summary:');
  const allEvents = await prisma.event.findMany({
    include: {
      ticketTiers: true,
    },
  });

  allEvents.forEach((event) => {
    const totalTickets = event.ticketTiers.reduce((sum, tier) => sum + tier.quantity, 0);
    console.log(`  • ${event.title}`);
    console.log(`    Venue: ${event.venue}`);
    console.log(`    Date: ${event.startTime.toLocaleDateString()} ${event.startTime.toLocaleTimeString()}`);
    console.log(`    Tiers: ${event.ticketTiers.length} | Total Tickets: ${totalTickets}`);
  });
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('\n👋 Prisma client disconnected');
  });

