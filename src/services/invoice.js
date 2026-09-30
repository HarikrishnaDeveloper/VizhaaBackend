const PDFDocument = require('pdfkit');

// Brand + print-friendly palette
// Darker shade of the app's #38BDF8 so white text stays legible in print
const PRIMARY = '#0284C7';
const TEXT = '#111827';
const MUTED = '#6B7280';
const LINE = '#E5E7EB';
const FILL = '#F9FAFB';

const PAGE_MARGIN = 50;

// The built-in PDF fonts have no ₹ glyph, so amounts use "Rs."
const money = (n) =>
  `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

const formatDateTime = (d) =>
  `${formatDate(d)}, ${new Date(d).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  })} IST`;

// "white_tshirt" → "White T-Shirt", "nil" → "Nil"
const labelize = (s) =>
  String(s || '').toLowerCase()
    .replace(/tshirt/gi, 't-shirt')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.replace(/(^|-)([a-z])/g, (_, p, c) => p + c.toUpperCase()))
    .join(' ');

// INV-20260928-AB12CD — stable for a given payment
const invoiceNumber = (payment) => {
  const d = new Date(payment.createdAt);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `INV-${ymd}-${payment.id.slice(-6).toUpperCase()}`;
};

/**
 * Streams an A4 invoice PDF for one payment into `stream`.
 * `payment` must include `event` with `user` and `payments`.
 */
const writeInvoicePdf = (payment, stream) => {
  const { event } = payment;
  const user = event.user;
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, info: { Title: `Invoice ${invoiceNumber(payment)}` } });
  doc.pipe(stream);

  const left = PAGE_MARGIN;
  const right = doc.page.width - PAGE_MARGIN;
  const width = right - left;

  // ── Header ──────────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 8).fill(PRIMARY);
  doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(26).text('Vizhaa', left, 40);
  doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Event staffing, simplified', left, 70);

  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(18).text('PAYMENT INVOICE', left, 40, { width, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  doc.text(`Invoice No: ${invoiceNumber(payment)}`, left, 64, { width, align: 'right' });
  doc.text(`Date: ${formatDate(payment.createdAt)}`, { width, align: 'right' });

  const statusLabel = payment.isTest ? 'TEST PAYMENT' : String(payment.status || 'captured').toUpperCase() === 'REFUNDED' ? 'REFUNDED' : 'PAID';
  const statusColor = statusLabel === 'PAID' ? '#059669' : '#DC2626';
  doc.font('Helvetica-Bold').fontSize(11).fillColor(statusColor).text(statusLabel, left, 94, { width, align: 'right' });

  doc.moveTo(left, 120).lineTo(right, 120).strokeColor(LINE).lineWidth(1).stroke();

  // ── Billed to / Event ───────────────────────────────────────────────────
  const colW = width / 2 - 10;
  const blockTop = 136;
  const section = (title, x, y) =>
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text(title.toUpperCase(), x, y, { width: colW, characterSpacing: 0.5 });

  section('Billed to', left, blockTop);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(12)
    .text(user.businessName || user.companyName || user.name || 'Organizer', left, blockTop + 16, { width: colW });
  doc.font('Helvetica').fontSize(10).fillColor(TEXT);
  [
    user.businessName && user.name ? user.name : null,
    user.mobile ? `+91 ${user.mobile.replace(/^\+?91/, '')}` : null,
    user.email,
    [user.address, user.city].filter(Boolean).join(', ') || null,
    user.gst ? `GSTIN: ${user.gst}` : null,
  ].filter(Boolean).forEach((line) => doc.text(line, { width: colW }));
  const billedBottom = doc.y;

  const ex = left + width / 2 + 10;
  section('Event', ex, blockTop);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(12).text(event.name, ex, blockTop + 16, { width: colW });
  doc.font('Helvetica').fontSize(10).fillColor(TEXT);
  [
    labelize(event.type),
    `${event.date}  |  ${event.inTime} - ${event.outTime}`,
    event.locationName || event.location,
    [event.city, event.state, event.pincode].filter(Boolean).join(', ') || null,
  ].filter(Boolean).forEach((line) => doc.text(line, ex, doc.y, { width: colW }));

  let y = Math.max(billedBottom, doc.y) + 24;

  // ── Line items ──────────────────────────────────────────────────────────
  const cols = [
    { label: 'Description', w: width * 0.5, align: 'left' },
    { label: 'Qty', w: width * 0.12, align: 'center' },
    { label: 'Rate', w: width * 0.19, align: 'right' },
    { label: 'Amount', w: width * 0.19, align: 'right' },
  ];
  const row = (cells, top, opts = {}) => {
    let x = left;
    cells.forEach((cell, i) => {
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10).fillColor(opts.color || TEXT)
        .text(cell, x + 8, top, { width: cols[i].w - 16, align: cols[i].align });
      x += cols[i].w;
    });
  };

  doc.rect(left, y, width, 26).fill(PRIMARY);
  row(cols.map((c) => c.label), y + 8, { bold: true, color: '#FFFFFF', size: 9 });
  y += 26;

  const items = [
    [
      `Event staffing - ${event.name}\nDress code: ${labelize(event.dressCode) || '-'}` +
        (event.services?.length ? `\nServices: ${event.services.map(labelize).join(', ')}` : ''),
      String(event.suppliers),
      money(event.costPerHead),
      money(event.totalCost),
    ],
  ];
  items.forEach((cells) => {
    doc.font('Helvetica').fontSize(10);
    const h = doc.heightOfString(cells[0], { width: cols[0].w - 16 }) + 20;
    doc.rect(left, y, width, h).fill(FILL);
    row(cells, y + 10);
    y += h;
  });
  doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();

  // ── Totals ──────────────────────────────────────────────────────────────
  const paidToDate = (event.payments || [])
    .filter((p) => p.status !== 'refunded' && new Date(p.createdAt) <= new Date(payment.createdAt))
    .reduce((sum, p) => sum + p.amount, 0);
  const balance = Math.max(0, event.totalCost - paidToDate);

  y += 14;
  const tl = left + width * 0.5;
  const tw = width * 0.5;
  const totalLine = (label, value, opts = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10).fillColor(opts.color || TEXT);
    doc.text(label, tl + 8, y, { width: tw * 0.55 });
    doc.text(value, tl + tw * 0.45, y, { width: tw * 0.55 - 8, align: 'right' });
    y += (opts.size || 10) + 10;
  };
  totalLine('Total event cost', money(event.totalCost));
  totalLine(`Paid previously`, money(paidToDate - payment.amount), { color: MUTED });
  doc.rect(tl, y - 4, tw, 28).fill(PRIMARY);
  y += 4;
  totalLine(`This payment (${labelize(payment.purpose)})`, money(payment.amount), { bold: true, color: '#FFFFFF', size: 11 });
  y += 4;
  totalLine('Balance due', money(balance), { bold: true });

  // ── Payment details ─────────────────────────────────────────────────────
  y += 16;
  doc.rect(left, y, width, 74).lineWidth(1).strokeColor(LINE).stroke();
  section('Payment details', left + 12, y + 12);
  doc.font('Helvetica').fontSize(10).fillColor(TEXT);
  doc.text(`Transaction ID: ${payment.razorpayPaymentId}`, left + 12, y + 28);
  doc.text(`Order ID: ${payment.razorpayOrderId || '-'}`, left + 12, y + 42);
  doc.text(`Paid on: ${formatDateTime(payment.createdAt)}  |  via Razorpay`, left + 12, y + 56);

  // ── Footer ──────────────────────────────────────────────────────────────
  const footerY = doc.page.height - PAGE_MARGIN - 30;
  doc.moveTo(left, footerY).lineTo(right, footerY).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text('This is a computer-generated invoice and does not require a signature.', left, footerY + 10, { width, align: 'center' })
    .text('Thank you for choosing Vizhaa.', { width, align: 'center' });

  doc.end();
};

module.exports = { writeInvoicePdf, invoiceNumber };
