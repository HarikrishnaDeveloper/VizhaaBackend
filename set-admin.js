const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user.update({
  where: { mobile: '7339509611' },
  data: { role: 'ADMIN' }
}).then(() => console.log('Updated to ADMIN'))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
