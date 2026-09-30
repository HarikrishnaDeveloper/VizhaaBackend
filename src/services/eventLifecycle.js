const config = require('../config');

// Event.status values. The organizer app shows these as
// Pending approval / Confirmed / In progress / Completed / Rejected.
const STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
};

// Statuses where the event has been accepted and can be tracked / staffed
const ACCEPTED = [STATUS.APPROVED, STATUS.IN_PROGRESS, STATUS.COMPLETED];

// Fixed live-tracking steps after "event created", in order. `key` is what the
// organizer app reads; `field` is the Event column holding the time.
const TRACKING_STEPS = [
  { key: 'supplier_assigned', field: 'supplierAssignedAt', label: 'Supplier Assigned' },
  { key: 'supplier_arrived', field: 'suppliersArrivedAt', label: 'Supplier Arrived' },
  { key: 'event_started', field: 'startedAt', label: 'Event Started' },
  { key: 'event_completed', field: 'completedAt', label: 'Event Completed' },
];

// Status implied by the furthest step reached
const statusForSteps = (event) => {
  if (event.completedAt) return STATUS.COMPLETED;
  if (event.startedAt) return STATUS.IN_PROGRESS;
  return STATUS.APPROVED;
};

// Share of the 5 steps (created + TRACKING_STEPS) done, 0–100
const progressFor = (event) => {
  const done = 1 + TRACKING_STEPS.filter((s) => event[s.field]).length;
  return Math.round((done / (TRACKING_STEPS.length + 1)) * 100);
};

// Enrolments that count as "assigned" staff on the organizer's screen
const ACTIVE_ENROLLMENT = ['ENROLLED', 'ATTENDED'];

const person = (name, phone, role) => (name ? { name, phone: phone || null, role } : null);

// Event as returned to its organizer: adds `tracking`, `team` and `emergencyPhone`.
// `event.eventPost.enrollments` (with supplier.user) is used when included;
// `attendedCounts` maps supplierId → events attended, for the profile sheet.
const toOrganizerEvent = (event, attendedCounts = {}) => {
  const enrollments = (event.eventPost?.enrollments || []).filter((e) => ACTIVE_ENROLLMENT.includes(e.status));
  const tracking = Object.fromEntries(
    TRACKING_STEPS.filter((s) => event[s.field]).map((s) => [s.key, event[s.field]])
  );
  const { eventPost, ...rest } = event;
  return {
    ...rest,
    eventPost: eventPost && {
      id: eventPost.id, status: eventPost.status, isPublished: eventPost.isPublished,
      enrolledMen: eventPost.enrolledMen, enrolledWomen: eventPost.enrolledWomen,
    },
    tracking,
    team: {
      manager: person(event.managerName, event.managerPhone, 'Manager'),
      supervisor: person(event.supervisorName, event.supervisorPhone, 'Supervisor'),
      suppliers: enrollments.map((e) => ({
        id: e.supplierId,
        name: e.supplier?.user?.name || 'Supplier',
        role: 'Supplier',
        phone: e.supplier?.user?.mobile || null,
        eventsCount: attendedCounts[e.supplierId] ?? null,
        status: e.status === 'ATTENDED' ? 'Attended' : 'Assigned',
      })),
    },
    emergencyPhone: config.supportPhone || null,
  };
};

module.exports = { STATUS, ACCEPTED, TRACKING_STEPS, ACTIVE_ENROLLMENT, statusForSteps, progressFor, toOrganizerEvent };
