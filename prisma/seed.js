const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding...');

  // Create admin user — change mobile to your actual admin mobile number
  const admin = await prisma.user.upsert({
    where: { mobile: '9999999999' },
    update: { role: 'ADMIN', name: 'Super Admin' },
    create: { mobile: '9999999999', name: 'Super Admin', role: 'ADMIN' },
  });
  console.log('Admin user created:', admin.mobile, '| role:', admin.role);

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
