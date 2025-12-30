import { PrismaClient, EventCategory } from '@prisma/client';
import { Prisma } from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

/**
 * Database seed script for AccessKE
 * Populates Events and TicketTiers with comprehensive mock data
 * Includes 25+ events across 5 categories (UNIVERSITY, CONCERT, CLUB, SOCIAL, HOLIDAY)
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
  // Order matters due to foreign key constraints
  console.log('🧹 Cleaning existing data...');
  await prisma.ticket.deleteMany({});
  await prisma.paymentLog.deleteMany({});
  await prisma.booking.deleteMany({});
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
    category: EventCategory,
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
        category,
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

    console.log(`✅ Created [${category}]: ${event.title} (${event.ticketTiers.length} tiers)`);
    return event;
  };

  // Calculate base date (today)
  const now = new Date();
  
  // Spread events over 12 weeks (84 days) to accommodate all events
  const week1 = addDays(now, 7);
  const week2 = addDays(now, 14);
  const week3 = addDays(now, 21);
  const week4 = addDays(now, 28);
  const week5 = addDays(now, 35);
  const week6 = addDays(now, 42);
  const week7 = addDays(now, 49);
  const week8 = addDays(now, 56);
  const week9 = addDays(now, 63);
  const week10 = addDays(now, 70);
  const week11 = addDays(now, 77);
  const week12 = addDays(now, 84);

  // ============================================
  // UNIVERSITY EVENTS (5+ events)
  // ============================================

  // UoN Freshers' Night
  const freshersStart = new Date(week1);
  freshersStart.setHours(19, 0, 0, 0);
  const freshersEnd = new Date(week1);
  freshersEnd.setHours(23, 59, 0, 0);
  await createEventWithTiers(
    "Freshers' Night: The Awakening",
    'A chaotic, high-energy welcome party for first-years. Experience the ultimate campus initiation with live DJs, performances, and unforgettable memories.',
    'UoN Grounds',
    freshersStart,
    freshersEnd,
    EventCategory.UNIVERSITY,
    [
      { name: 'Student ID', price: 500, quantity: 1000 },
      { name: 'Outsider', price: 1500, quantity: 200 },
    ]
  );

  // JKUAT Tech Expo
  const jkuatStart = new Date(week2);
  jkuatStart.setHours(10, 0, 0, 0);
  const jkuatEnd = new Date(week2);
  jkuatEnd.setHours(18, 0, 0, 0);
  await createEventWithTiers(
    'Tech & Innovation Expo 🤖',
    'Showcase of cutting-edge technology, robotics, and innovation projects from JKUAT students. Network with tech leaders and explore the future of engineering.',
    'JKUAT Main Campus (Juja)',
    jkuatStart,
    jkuatEnd,
    EventCategory.UNIVERSITY,
    [
      { name: 'Student', price: 200, quantity: 800 },
      { name: 'General Admission', price: 500, quantity: 300 },
      { name: 'Industry Professional', price: 1500, quantity: 100 },
    ]
  );

  // KU Cultural Week
  const kuStart = new Date(week3);
  kuStart.setHours(17, 0, 0, 0);
  const kuEnd = new Date(week3);
  kuEnd.setHours(22, 0, 0, 0);
  await createEventWithTiers(
    'Cultural Week Grand Finale 🎭',
    'Celebrate Kenya\'s rich cultural diversity with traditional performances, music, dance, and food from all regions. A vibrant showcase of our heritage.',
    'The Amphitheatre',
    kuStart,
    kuEnd,
    EventCategory.UNIVERSITY,
    [
      { name: 'Comrade', price: 150, quantity: 1000 },
      { name: 'Regular', price: 400, quantity: 400 },
      { name: 'VIP', price: 800, quantity: 150 },
    ]
  );

  // MKU Thika Bash
  const mkuStart = new Date(week4);
  mkuStart.setHours(19, 0, 0, 0);
  const mkuEnd = new Date(week4);
  mkuEnd.setHours(23, 59, 0, 0);
  await createEventWithTiers(
    'Thika Takeover Bash 🎤',
    'The biggest music festival in Thika! Featuring top Kenyan artists, DJs, and campus talent. Get ready for an unforgettable night of music and energy.',
    'MKU Graduation Pavilion',
    mkuStart,
    mkuEnd,
    EventCategory.UNIVERSITY,
    [
      { name: 'Regular', price: 500, quantity: 800 },
      { name: 'VIP', price: 1200, quantity: 200 },
    ]
  );

  // CUEA Food Fest
  const cueaStart = new Date(week5);
  cueaStart.setHours(12, 0, 0, 0);
  const cueaEnd = new Date(week5);
  cueaEnd.setHours(20, 0, 0, 0);
  await createEventWithTiers(
    'International Food & Culture Fest 🍲',
    'A culinary journey around the world! Sample authentic dishes from different countries, enjoy cultural performances, and experience global traditions.',
    'Langata Campus',
    cueaStart,
    cueaEnd,
    EventCategory.UNIVERSITY,
    [
      { name: 'Entry', price: 250, quantity: 600 },
      { name: 'General Admission', price: 600, quantity: 400 },
      { name: 'Family Pack (4 tickets)', price: 2000, quantity: 50 },
    ]
  );

  // Mr. & Miss Campus Grand Finale
  const campusStart = new Date(week6);
  campusStart.setHours(18, 0, 0, 0);
  const campusEnd = new Date(week6);
  campusEnd.setHours(22, 0, 0, 0);
  await createEventWithTiers(
    "Mr. & Miss Campus Grand Finale",
    'A prestigious fashion and talent show showcasing the best of campus. High demand for VIP seats with exclusive access to judges and performers.',
    'UoN Taifa Hall',
    campusStart,
    campusEnd,
    EventCategory.UNIVERSITY,
    [
      { name: 'Regular', price: 300, quantity: 500 },
      { name: 'VIP', price: 1000, quantity: 100 },
      { name: 'Judges Circle', price: 3000, quantity: 10 },
    ]
  );

  // ============================================
  // SOCIAL EVENTS (5+ events)
  // ============================================

  // Finalists Dinner
  const finalistsStart = new Date(week1);
  finalistsStart.setHours(19, 0, 0, 0);
  const finalistsEnd = new Date(week1);
  finalistsEnd.setHours(23, 0, 0, 0);
  await createEventWithTiers(
    'The Finalists Dinner (Black Tie)',
    'An exclusive, elegant dinner for the graduating class. Celebrate your achievements in style with fine dining and networking opportunities.',
    'UoN Graduation Hall',
    finalistsStart,
    finalistsEnd,
    EventCategory.SOCIAL,
    [
      { name: 'Single Ticket', price: 2500, quantity: 150 },
      { name: 'Couples Table', price: 4500, quantity: 50 },
    ]
  );

  // Gaming Championship
  const gamingStart = new Date(week2);
  gamingStart.setHours(14, 0, 0, 0);
  const gamingEnd = new Date(week2);
  gamingEnd.setHours(20, 0, 0, 0);
  await createEventWithTiers(
    'Inter-Uni Gaming Championship',
    'E-sports tournament featuring the best gamers from universities across Kenya. Watch intense competitions or compete yourself!',
    'Strathmore Student Center',
    gamingStart,
    gamingEnd,
    EventCategory.SOCIAL,
    [
      { name: 'Gamer', price: 1000, quantity: 32 },
      { name: 'Spectator', price: 100, quantity: 300 },
    ]
  );

  // Rooftop Jazz
  const jazzDate = addDays(week3, 2);
  const jazzStart = new Date(jazzDate);
  jazzStart.setHours(17, 0, 0, 0);
  const jazzEnd = new Date(jazzDate);
  jazzEnd.setHours(22, 0, 0, 0);
  await createEventWithTiers(
    'Sunset & Sips: Rooftop Jazz',
    'An intimate evening of smooth jazz, cocktails, and stunning city views. Perfect for a romantic date or networking event.',
    'GTC Rooftop, Westlands',
    jazzStart,
    jazzEnd,
    EventCategory.SOCIAL,
    [
      { name: 'General Admission', price: 3000, quantity: 40 },
      { name: 'Table', price: 10000, quantity: 5 },
    ]
  );

  // Nairobi Tech Meetup
  const techStart = new Date(week4);
  techStart.setHours(18, 0, 0, 0);
  const techEnd = new Date(week4);
  techEnd.setHours(21, 0, 0, 0);
  await createEventWithTiers(
    'Nairobi Tech Meetup',
    'Connect with fellow developers, entrepreneurs, and tech enthusiasts. Lightning talks, networking, and refreshments included.',
    'iHub Nairobi',
    techStart,
    techEnd,
    EventCategory.SOCIAL,
    [
      { name: 'Free', price: 0, quantity: 100 },
      { name: 'Sponsor', price: 5000, quantity: 20 },
    ]
  );

  // Speed Dating Night
  const speedDateStart = new Date(week5);
  speedDateStart.setHours(19, 0, 0, 0);
  const speedDateEnd = new Date(week5);
  speedDateEnd.setHours(22, 0, 0, 0);
  await createEventWithTiers(
    'Speed Dating Night',
    'Meet new people in a fun, relaxed environment. Multiple rounds of quick conversations with potential matches. Age 21+.',
    'The Alchemist Bar',
    speedDateStart,
    speedDateEnd,
    EventCategory.SOCIAL,
    [
      { name: 'Entry', price: 1500, quantity: 50 },
    ]
  );

  // USIU Poolside
  const usiuStart = new Date(week6);
  usiuStart.setHours(16, 0, 0, 0);
  const usiuEnd = new Date(week6);
  usiuEnd.setHours(22, 0, 0, 0);
  await createEventWithTiers(
    'Poolside Sunset Chill 🏊',
    'An exclusive poolside event with premium cocktails, live acoustic music, and stunning sunset views. The perfect upscale social gathering for networking and relaxation.',
    'USIU Rec Center',
    usiuStart,
    usiuEnd,
    EventCategory.SOCIAL,
    [
      { name: 'General Admission', price: 2000, quantity: 150 },
      { name: 'VIP Lounge', price: 5000, quantity: 50 },
      { name: 'Premium Cabana', price: 15000, quantity: 10 },
    ]
  );

  // ============================================
  // CLUB EVENTS (5 events)
  // ============================================

  // Westlands Friday Chaos
  const chaosStart = new Date(week1);
  chaosStart.setHours(22, 0, 0, 0);
  const chaosEnd = new Date(addDays(week1, 1));
  chaosEnd.setHours(4, 0, 0, 0);
  await createEventWithTiers(
    'Westlands Friday Chaos',
    'The wildest Friday night in Westlands! Top DJs, premium drinks, and non-stop energy. Dress to impress.',
    'The Alchemist',
    chaosStart,
    chaosEnd,
    EventCategory.CLUB,
    [
      { name: 'Entry', price: 1000, quantity: 500 },
    ]
  );

  // Amapiano Sundays
  const amapianoStart = new Date(week2);
  amapianoStart.setHours(20, 0, 0, 0);
  const amapianoEnd = new Date(addDays(week2, 1));
  amapianoEnd.setHours(2, 0, 0, 0);
  await createEventWithTiers(
    'Amapiano Sundays',
    'The hottest Amapiano vibes every Sunday! Dance to the latest South African beats with Nairobi\'s best DJs.',
    '1824',
    amapianoStart,
    amapianoEnd,
    EventCategory.CLUB,
    [
      { name: 'Entry', price: 500, quantity: 300 },
    ]
  );

  // Reggae Vibes
  const reggaeStart = new Date(week3);
  reggaeStart.setHours(21, 0, 0, 0);
  const reggaeEnd = new Date(addDays(week3, 1));
  reggaeEnd.setHours(3, 0, 0, 0);
  await createEventWithTiers(
    'Reggae Vibes',
    'One love, one vibe! Classic reggae and dancehall all night long. Free entry before 11 PM.',
    'K1 Clubhouse',
    reggaeStart,
    reggaeEnd,
    EventCategory.CLUB,
    [
      { name: 'Free Entry', price: 0, quantity: 200 },
    ]
  );

  // Afro-Beats Night
  const afroStart = new Date(week4);
  afroStart.setHours(22, 0, 0, 0);
  const afroEnd = new Date(addDays(week4, 1));
  afroEnd.setHours(5, 0, 0, 0);
  await createEventWithTiers(
    'Afro-Beats Night',
    'The ultimate Afro-beats experience! Burna Boy, Wizkid, Davido vibes all night. VIP bottle service available.',
    '40Forty',
    afroStart,
    afroEnd,
    EventCategory.CLUB,
    [
      { name: 'VIP', price: 2000, quantity: 150 },
    ]
  );

  // Milan Lounge All-White Party
  const milanStart = new Date(week5);
  milanStart.setHours(20, 0, 0, 0);
  const milanEnd = new Date(addDays(week5, 1));
  milanEnd.setHours(4, 0, 0, 0);
  await createEventWithTiers(
    'Milan Lounge All-White Party',
    'Dress code: ALL WHITE! Sophisticated party atmosphere with premium cocktails and top-tier DJs.',
    'Milan Lounge',
    milanStart,
    milanEnd,
    EventCategory.CLUB,
    [
      { name: 'Regular', price: 1500, quantity: 200 },
    ]
  );

  // ============================================
  // CONCERT EVENTS (5 events)
  // ============================================

  // Sauti Sol Tribute
  const sautiStart = new Date(week7);
  sautiStart.setHours(18, 0, 0, 0);
  const sautiEnd = new Date(week7);
  sautiEnd.setHours(23, 0, 0, 0);
  await createEventWithTiers(
    'Sauti Sol Tribute',
    'A special tribute concert celebrating Kenya\'s most iconic band. Live performances, special guests, and unforgettable memories.',
    'Carnivore Grounds',
    sautiStart,
    sautiEnd,
    EventCategory.CONCERT,
    [
      { name: 'Regular', price: 2000, quantity: 2000 },
      { name: 'VIP', price: 5000, quantity: 500 },
    ]
  );

  // Blankets & Wine
  const blanketsStart = new Date(week8);
  blanketsStart.setHours(14, 0, 0, 0);
  const blanketsEnd = new Date(week8);
  blanketsEnd.setHours(22, 0, 0, 0);
  await createEventWithTiers(
    'Blankets & Wine',
    'Kenya\'s premier music festival experience. Bring your blanket, enjoy wine, and discover amazing local and international artists.',
    'Laureate Gardens',
    blanketsStart,
    blanketsEnd,
    EventCategory.CONCERT,
    [
      { name: 'Early Bird', price: 3000, quantity: 1000 },
    ]
  );

  // Oktobafest
  const oktoStart = new Date(week9);
  oktoStart.setHours(12, 0, 0, 0);
  const oktoEnd = new Date(week9);
  oktoEnd.setHours(20, 0, 0, 0);
  await createEventWithTiers(
    'Oktobafest',
    'The biggest Oktoberfest celebration in Nairobi! German beer, live bands, and festive atmosphere. Prost!',
    'Ngong Racecourse',
    oktoStart,
    oktoEnd,
    EventCategory.CONCERT,
    [
      { name: 'Regular', price: 1000, quantity: 3000 },
    ]
  );

  // Sol Fest
  const solStart = new Date(week10);
  solStart.setHours(16, 0, 0, 0);
  const solEnd = new Date(week10);
  solEnd.setHours(23, 0, 0, 0);
  await createEventWithTiers(
    'Sol Fest',
    'A multi-stage music festival featuring Kenya\'s top artists. Food vendors, art installations, and non-stop entertainment.',
    'Uhuru Gardens',
    solStart,
    solEnd,
    EventCategory.CONCERT,
    [
      { name: 'Fan', price: 2500, quantity: 1500 },
      { name: 'VIP', price: 8000, quantity: 300 },
    ]
  );

  // Jazz in the Park
  const jazzParkStart = new Date(week11);
  jazzParkStart.setHours(15, 0, 0, 0);
  const jazzParkEnd = new Date(week11);
  jazzParkEnd.setHours(20, 0, 0, 0);
  await createEventWithTiers(
    'Jazz in the Park',
    'An afternoon of smooth jazz in the beautiful Arboretum. Bring a picnic, relax, and enjoy world-class performances.',
    'Arboretum',
    jazzParkStart,
    jazzParkEnd,
    EventCategory.CONCERT,
    [
      { name: 'Entry', price: 500, quantity: 500 },
    ]
  );

  // ============================================
  // HOLIDAY EVENTS (5 events)
  // ============================================

  // Nairobi NYE Glow Fest
  const nyeDate = new Date(week12);
  if (nyeDate.getMonth() !== 11) {
    nyeDate.setMonth(11); // December
    nyeDate.setDate(31);
  } else {
    nyeDate.setDate(31);
  }
  const nyeStart = new Date(nyeDate);
  nyeStart.setHours(18, 0, 0, 0);
  const nyeEnd = new Date(nyeDate);
  nyeEnd.setDate(nyeEnd.getDate() + 1);
  nyeEnd.setHours(6, 0, 0, 0);
  await createEventWithTiers(
    'Nairobi NYE Glow Fest 🎆',
    'Ring in the New Year with the most spectacular celebration in Nairobi! Live performances, fireworks, and unforgettable memories.',
    'KICC Grounds',
    nyeStart,
    nyeEnd,
    EventCategory.HOLIDAY,
    [
      { name: 'Regular', price: 2500, quantity: 2000 },
      { name: 'VIP', price: 8000, quantity: 500 },
    ]
  );

  // Valentines Dinner
  const valDate = addDays(week1, 10);
  valDate.setMonth(1); // February
  valDate.setDate(14);
  const valStart = new Date(valDate);
  valStart.setHours(19, 0, 0, 0);
  const valEnd = new Date(valDate);
  valEnd.setHours(23, 0, 0, 0);
  await createEventWithTiers(
    'Valentines Dinner Under Stars',
    'A romantic evening under the stars with fine dining, live music, and intimate atmosphere. Perfect for couples.',
    'Tribe Hotel Rooftop',
    valStart,
    valEnd,
    EventCategory.HOLIDAY,
    [
      { name: 'Couple', price: 10000, quantity: 50 },
    ]
  );

  // Easter Egg Hunt
  const easterDate = addDays(week2, 15);
  easterDate.setMonth(3); // April
  easterDate.setDate(15);
  const easterStart = new Date(easterDate);
  easterStart.setHours(10, 0, 0, 0);
  const easterEnd = new Date(easterDate);
  easterEnd.setHours(16, 0, 0, 0);
  await createEventWithTiers(
    'Easter Egg Hunt',
    'Family-friendly Easter celebration with egg hunts, games, face painting, and treats for kids. Fun for all ages!',
    'Nairobi National Park Picnic Area',
    easterStart,
    easterEnd,
    EventCategory.HOLIDAY,
    [
      { name: 'Family', price: 1000, quantity: 200 },
    ]
  );

  // Halloween Spookfest
  const halloweenDate = addDays(week3, 20);
  halloweenDate.setMonth(9); // October
  halloweenDate.setDate(31);
  const halloweenStart = new Date(halloweenDate);
  halloweenStart.setHours(19, 0, 0, 0);
  const halloweenEnd = new Date(halloweenDate);
  halloweenEnd.setHours(23, 59, 0, 0);
  await createEventWithTiers(
    'Halloween Spookfest',
    'The spookiest night of the year! Costume contest, haunted house, themed cocktails, and DJ sets. Dress to scare!',
    'The Alchemist',
    halloweenStart,
    halloweenEnd,
    EventCategory.HOLIDAY,
    [
      { name: 'Entry', price: 1500, quantity: 400 },
    ]
  );

  // Jamhuri Day Live
  const jamhuriDate = addDays(week4, 25);
  jamhuriDate.setMonth(11); // December
  jamhuriDate.setDate(12);
  const jamhuriStart = new Date(jamhuriDate);
  jamhuriStart.setHours(14, 0, 0, 0);
  const jamhuriEnd = new Date(jamhuriDate);
  jamhuriEnd.setHours(22, 0, 0, 0);
  await createEventWithTiers(
    'Jamhuri Day Live',
    'Celebrate Kenya\'s independence with live music, cultural performances, and national pride. Free for Kenyan citizens.',
    'Uhuru Park',
    jamhuriStart,
    jamhuriEnd,
    EventCategory.HOLIDAY,
    [
      { name: 'Citizen', price: 500, quantity: 5000 },
    ]
  );

  console.log('\n🎉 Database seed completed successfully!');
  console.log('\n📊 Summary by Category:');
  
  const categories = Object.values(EventCategory);
  for (const category of categories) {
    const events = await prisma.event.findMany({
      where: { category },
      include: { ticketTiers: true },
      orderBy: { startTime: 'asc' },
    });
    console.log(`\n${category} (${events.length} events):`);
    events.forEach((event) => {
      const totalTickets = event.ticketTiers.reduce((sum, tier) => sum + tier.quantity, 0);
      console.log(`  • ${event.title}`);
      console.log(`    Venue: ${event.venue} | Date: ${event.startTime.toLocaleDateString()}`);
      console.log(`    Tiers: ${event.ticketTiers.length} | Total Tickets: ${totalTickets}`);
    });
  }
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
