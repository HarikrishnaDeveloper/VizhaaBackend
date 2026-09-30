// Usage: node create-admin.js <email> <password> [mobile]
// Creates (or updates) an ADMIN user who can sign in to the super-admin dashboard.
require('dotenv').config();
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const [email, password, mobile = '9999999999'] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node create-admin.js <email> <password> [mobile]');
  process.exit(1);
}

(async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  const data = { email: email.toLowerCase(), passwordHash, role: 'ADMIN' };
  const admin = await prisma.user.upsert({
    where: { mobile },
    update: data,
    create: { ...data, mobile, name: 'Super Admin' },
  });
  console.log(`Admin ready: ${admin.email} (mobile ${admin.mobile})`);
})()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
