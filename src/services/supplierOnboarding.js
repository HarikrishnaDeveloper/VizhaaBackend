// Supplier onboarding state: which lifecycle status a profile is in and which
// screen the supplier app should show next.

const STATUSES = ['DRAFT', 'KYC_PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'];
const BUSINESS_TYPES = ['Individual', 'Staffing Agency', 'Catering', 'Event Services', 'Other'];
const GENDERS = ['Male', 'Female', 'Other'];

// Individuals work under their own name; any other business type needs a business name
const hasBasicDetails = (p) =>
  Boolean(p.ownerName && p.email && p.gender && p.dob && p.businessType &&
    (p.businessType === 'Individual' || p.businessName));

const hasAddress = (p) =>
  Boolean(p.address && p.city && p.state && p.pincode && p.latitude != null && p.longitude != null);

const isProfileComplete = (p) => hasBasicDetails(p) && hasAddress(p);

// PROFILE → LOCATION → KYC → PENDING_REVIEW → DASHBOARD (or SUSPENDED)
const nextStep = (p) => {
  if (!p) return 'PROFILE';
  if (p.status === 'SUSPENDED') return 'SUSPENDED';
  if (p.status === 'APPROVED') return 'DASHBOARD';
  if (!hasBasicDetails(p)) return 'PROFILE';
  if (!hasAddress(p)) return 'LOCATION';
  if (p.status === 'UNDER_REVIEW') return 'PENDING_REVIEW';
  return 'KYC'; // KYC_PENDING, or REJECTED and needs to resubmit
};

// Fields the supplier app may read about its own profile (no internal ids beyond `id`)
const publicProfile = (p) =>
  p && {
    id: p.id,
    status: p.status,
    statusReason: p.statusReason,
    ownerName: p.ownerName,
    email: p.email,
    phone: p.phone,
    gender: p.gender,
    dob: p.dob,
    businessName: p.businessName,
    businessType: p.businessType,
    address: p.address,
    city: p.city,
    state: p.state,
    pincode: p.pincode,
    latitude: p.latitude,
    longitude: p.longitude,
    transportMode: p.transportMode,
    kycStatus: p.kycStatus,
    kycSubmittedAt: p.kycSubmittedAt,
    kycRejectionReason: p.kycRejectionReason,
    walletBalance: p.walletBalance,
    createdAt: p.createdAt,
  };

module.exports = { STATUSES, BUSINESS_TYPES, GENDERS, isProfileComplete, nextStep, publicProfile };
