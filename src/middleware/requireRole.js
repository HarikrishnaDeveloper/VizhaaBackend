const prisma = require('../lib/prisma');

const requireRole = (...roles) => async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { role: true },
    });
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    req.userRole = user.role;
    next();
  } catch {
    res.status(500).json({ success: false, message: 'Authorization check failed' });
  }
};

module.exports = requireRole;
