import 'dotenv/config';
import { prisma } from './src/utils/pg.js';

async function main() {
  try {
    const customers = await prisma.customer.findMany();
    console.log('SUCCESS connecting to DB, customers count:', customers.length);
  } catch (err) {
    console.error('ERROR connecting to DB:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
