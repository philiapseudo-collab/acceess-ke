import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

/**
 * Database seed script for AccessKE
 * Populates Events and TicketTiers with mock data for testing
 * Includes 11 events (6 original + 5 new university events)
 * All events include a "Dev Test Pass (Team Only)" tier for testing
 */

// Helper to add days to a date
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

async function main() {
  console.log('🌱 Starting database seed...');

  // Clean existing data (deleteMany for idempotency)
  console.log('🧹 Cleaning existing events and tiers...');
  await prisma.ticketTier.deleteMany({});
  await prisma.event.deleteMany({});
  console.log('✅ Cleanup complete');

  // Helper to create events with tiers (automatically adds Dev Test Pass as last tier)
  const createEventWithTiers = async (
    title: string,
    description: string,
    venue: string,
    startTime: Date,
    endTime: Date,
    tiers: Array<{ name: string; price: number; quantity: number }>
  ) => {
    // Add Dev Test Pass as the last tier for all events
    const allTiers = [
      ...tiers,
      { name: 'Dev Test Pass (Team Only)', price: 10, quantity: 100 },
    ];

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
          create: allTiers.map((tier) => ({
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

  // Calculate base date (today)
  const now = new Date();
  
  // Spread events over 8 weeks (56 days)
  const week1 = addDays(now, 7);
  const week2 = addDays(now, 14);
  const week3 = addDays(now, 21);
  const week4 = addDays(now, 28);
  const week5 = addDays(now, 35);
  const week6 = addDays(now, 42);
  const week7 = addDays(now, 49);
  const week8 = addDays(now, 56);

  // ============================================
  // ORIGINAL EVENTS (6 events)
  // ============================================

  // Event 1: Freshers' Night: The Awakening (Week 1)
  const event1Start = new Date(week1);
  event1Start.setHours(19, 0, 0, 0);
  const event1End = new Date(week1);
  event1End.setHours(23, 59, 0, 0);
  await createEventWithTiers(
    "Freshers' Night: The Awakening",
    'A chaotic, high-energy welcome party for first-years. Experience the ultimate campus initiation with live DJs, performances, and unforgettable memories.',
    'UoN Grounds',
    event1Start,
    event1End,
    [
      { name: 'Student ID', price: 500, quantity: 1000 },
      { name: 'Outsider', price: 1500, quantity: 200 },
    ]
  );

  // Event 2: Mr. & Miss Campus Grand Finale (Week 2)
  const event2Start = new Date(week2);
  event2Start.setHours(18, 0, 0, 0);
  const event2End = new Date(week2);
  event2End.setHours(22, 0, 0, 0);
  await createEventWithTiers(
    "Mr. & Miss Campus Grand Finale",
    'A prestigious fashion and talent show showcasing the best of campus. High demand for VIP seats with exclusive access to judges and performers.',
    'UoN Taifa Hall',
    event2Start,
    event2End,
    [
      { name: 'Regular', price: 300, quantity: 500 },
      { name: 'VIP', price: 1000, quantity: 100 },
      { name: 'Judges Circle', price: 3000, quantity: 10 }, // Low stock for concurrency testing
    ]
  );

  // Event 3: The Finalists Dinner (Black Tie) (Week 3)
  const event3Start = new Date(week3);
  event3Start.setHours(19, 0, 0, 0);
  const event3End = new Date(week3);
  event3End.setHours(23, 0, 0, 0);
  await createEventWithTiers(
    'The Finalists Dinner (Black Tie)',
    'An exclusive, elegant dinner for the graduating class. Celebrate your achievements in style with fine dining and networking opportunities.',
    'UoN Graduation Hall',
    event3Start,
    event3End,
    [
      { name: 'Single Ticket', price: 2500, quantity: 150 },
      { name: 'Couples Table', price: 4500, quantity: 50 },
    ]
  );

  // Event 4: Inter-Uni Gaming Championship (Week 4)
  const event4Start = new Date(week4);
  event4Start.setHours(14, 0, 0, 0);
  const event4End = new Date(week4);
  event4End.setHours(20, 0, 0, 0);
  await createEventWithTiers(
    'Inter-Uni Gaming Championship',
    'E-sports tournament featuring the best gamers from universities across Kenya. Watch intense competitions or compete yourself!',
    'Strathmore Student Center',
    event4Start,
    event4End,
    [
      { name: 'Spectator', price: 100, quantity: 300 },
      { name: 'Competitor Entry', price: 1000, quantity: 32 }, // Bracket style
    ]
  );

  // Event 5: Nairobi NYE Glow Fest 🎆 (Week 5 - New Year's Eve)
  const nyeDate = new Date(week5);
  // If week5 is not December, adjust to next December 31st
  if (nyeDate.getMonth() !== 11) {
    nyeDate.setMonth(11); // December
    nyeDate.setDate(31);
  } else {
    nyeDate.setDate(31);
  }
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

  // Event 6: Sunset & Sips: Rooftop Jazz (Week 2, different day)
  const jazzDate = addDays(week2, 2); // 2 days after Event 2
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

  // ============================================
  // NEW UNIVERSITY EVENTS (5 events)
  // ============================================

  // Event 7: JKUAT - Tech & Innovation Expo 🤖 (Week 6)
  const jkuatStart = new Date(week6);
  jkuatStart.setHours(10, 0, 0, 0); // 10 AM
  const jkuatEnd = new Date(week6);
  jkuatEnd.setHours(18, 0, 0, 0); // 6 PM
  await createEventWithTiers(
    'Tech & Innovation Expo 🤖',
    'Showcase of cutting-edge technology, robotics, and innovation projects from JKUAT students. Network with tech leaders and explore the future of engineering.',
    'JKUAT Main Campus (Juja)',
    jkuatStart,
    jkuatEnd,
    [
      { name: 'Student', price: 200, quantity: 800 },
      { name: 'General Admission', price: 500, quantity: 300 },
      { name: 'Industry Professional', price: 1500, quantity: 100 },
    ]
  );

  // Event 8: KU - Cultural Week Grand Finale 🎭 (Week 3, different day)
  const kuDate = addDays(week3, 3); // 3 days after Event 3
  const kuStart = new Date(kuDate);
  kuStart.setHours(17, 0, 0, 0); // 5 PM
  const kuEnd = new Date(kuDate);
  kuEnd.setHours(22, 0, 0, 0); // 10 PM
  await createEventWithTiers(
    'Cultural Week Grand Finale 🎭',
    'Celebrate Kenya\'s rich cultural diversity with traditional performances, music, dance, and food from all regions. A vibrant showcase of our heritage.',
    'The Amphitheatre',
    kuStart,
    kuEnd,
    [
      { name: 'Student', price: 150, quantity: 1000 },
      { name: 'Regular', price: 400, quantity: 400 },
      { name: 'VIP', price: 800, quantity: 150 },
    ]
  );

  // Event 9: MKU - Thika Takeover Bash 🎤 (Week 7)
  const mkuStart = new Date(week7);
  mkuStart.setHours(19, 0, 0, 0); // 7 PM
  const mkuEnd = new Date(week7);
  mkuEnd.setHours(23, 59, 0, 0); // 11:59 PM
  await createEventWithTiers(
    'Thika Takeover Bash 🎤',
    'The biggest music festival in Thika! Featuring top Kenyan artists, DJs, and campus talent. Get ready for an unforgettable night of music and energy.',
    'MKU Graduation Pavilion',
    mkuStart,
    mkuEnd,
    [
      { name: 'Early Bird', price: 300, quantity: 500 },
      { name: 'Regular', price: 500, quantity: 800 },
      { name: 'VIP', price: 1200, quantity: 200 },
    ]
  );

  // Event 10: CUEA - International Food & Culture Fest 🍲 (Week 4, different day)
  const cueaDate = addDays(week4, 4); // 4 days after Event 4
  const cueaStart = new Date(cueaDate);
  cueaStart.setHours(12, 0, 0, 0); // 12 PM
  const cueaEnd = new Date(cueaDate);
  cueaEnd.setHours(20, 0, 0, 0); // 8 PM
  await createEventWithTiers(
    'International Food & Culture Fest 🍲',
    'A culinary journey around the world! Sample authentic dishes from different countries, enjoy cultural performances, and experience global traditions.',
    'Langata Campus',
    cueaStart,
    cueaEnd,
    [
      { name: 'Student', price: 250, quantity: 600 },
      { name: 'General Admission', price: 600, quantity: 400 },
      { name: 'Family Pack (4 tickets)', price: 2000, quantity: 50 },
    ]
  );

  // Event 11: USIU-Africa - Poolside Sunset Chill 🏊 (Week 8)
  const usiuStart = new Date(week8);
  usiuStart.setHours(16, 0, 0, 0); // 4 PM
  const usiuEnd = new Date(week8);
  usiuEnd.setHours(22, 0, 0, 0); // 10 PM
  await createEventWithTiers(
    'Poolside Sunset Chill 🏊',
    'An exclusive poolside event with premium cocktails, live acoustic music, and stunning sunset views. The perfect upscale social gathering for networking and relaxation.',
    'USIU Rec Center',
    usiuStart,
    usiuEnd,
    [
      { name: 'General Admission', price: 2000, quantity: 150 },
      { name: 'VIP Lounge', price: 5000, quantity: 50 },
      { name: 'Premium Cabana', price: 15000, quantity: 10 },
    ]
  );

  console.log('\n🎉 Database seed completed successfully!');
  console.log('\n📊 Summary:');
  const allEvents = await prisma.event.findMany({
    include: {
      ticketTiers: true,
    },
    orderBy: {
      startTime: 'asc',
    },
  });

  allEvents.forEach((event) => {
    const totalTickets = event.ticketTiers.reduce((sum, tier) => sum + tier.quantity, 0);
    const devTestTier = event.ticketTiers.find((t) => t.name === 'Dev Test Pass (Team Only)');
    console.log(`  • ${event.title}`);
    console.log(`    Venue: ${event.venue}`);
    console.log(`    Date: ${event.startTime.toLocaleDateString()} ${event.startTime.toLocaleTimeString()}`);
    console.log(`    Tiers: ${event.ticketTiers.length} | Total Tickets: ${totalTickets}`);
    if (devTestTier) {
      console.log(`    ✅ Dev Test Pass: ${devTestTier.quantity} tickets @ KES ${devTestTier.price}`);
    }
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
