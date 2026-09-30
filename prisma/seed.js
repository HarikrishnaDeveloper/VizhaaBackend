require('dotenv').config();
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding...');

  // Super-admin dashboard login. Credentials come from .env (ADMIN_EMAIL / ADMIN_PASSWORD);
  // the password is stored only as a bcrypt hash.
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const mobile = process.env.ADMIN_MOBILE || '9999999999';
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env to seed the admin user');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { mobile },
    update: { role: 'ADMIN', email, passwordHash },
    create: { mobile, name: 'Super Admin', role: 'ADMIN', email, passwordHash },
  });
  console.log('Admin user ready:', admin.email, '| mobile:', admin.mobile, '| role:', admin.role);

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
