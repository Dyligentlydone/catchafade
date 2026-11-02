/* ============================================================
   CATCH A FADE CHRIS — booking + card-on-file server
   ------------------------------------------------------------
   Serves the static site from /public plus three API routes:

     POST /api/booking/start   — new client → Stripe card setup
                                 returning client → SMS code
     POST /api/booking/verify  — confirm code → text Chris
     POST /api/stripe/webhook  — card saved → text Chris

   Card data never touches this server — Stripe holds it.
   Phone→card lookup lives in Stripe customer records (no DB).
   ============================================================ */
const path = require("path");
const fs = require("fs");
const express = require("express");

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, "public", "config.json"), "utf8")
);

const PORT = process.env.PORT || 3000;
const BARBER_PHONE = process.env.BARBER_PHONE || CONFIG.phone;
const PROD = process.env.NODE_ENV === "production";

let stripe = process.env.STRIPE_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_SECRET_KEY)
  : null;

const twilioReady = !!(
  process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM
);
const twilio = twilioReady
  ? require("twilio")(process.env.TWILIO_SID, process.env.TWILIO_TOKEN)
  : null;

const app = express();
app.set("trust proxy", 1); // Railway sits behind a proxy — needed for https URLs

// pending bookings + one-time codes (in-memory, short-lived)
const pendings = new Map(); // bookingId -> booking
const otps = new Map();     // phoneE164 -> { code, exp, tries }
const PENDING_TTL = 30 * 60 * 1000;
const OTP_TTL = 10 * 60 * 1000;
const OTP_MAX_TRIES = 5;

/* ---------- bookings store ----------
   JSON file so the admin dashboard has something to show.
   On Railway: add a Volume mounted at /data and set DATA_DIR=/data —
   before that it still works, just resets on redeploy. */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const BOOKINGS_FILE = path.join(DATA_DIR, "bookings.json");
const bookings = new Map(); // id -> booking
const blocks = [];          // {id, dateISO, timeMin|null, mins|null, label} — time off
const clients = new Map();  // phoneE164 -> {notes}
const BLOCKS_FILE = path.join(DATA_DIR, "blocks.json");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (e) { console.error(`${file} not persisted:`, e.message); }
}
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const b of loadJSON(BOOKINGS_FILE, [])) bookings.set(b.id, b);
  blocks.push(...loadJSON(BLOCKS_FILE, []));
  for (const c of loadJSON(CLIENTS_FILE, [])) clients.set(c.phone, c);
} catch { /* first run or unwritable — memory only */ }
const saveBookings = () => saveJSON(BOOKINGS_FILE, [...bookings.values()]);
const saveBlocks = () => saveJSON(BLOCKS_FILE, blocks);
const saveClients = () => saveJSON(CLIENTS_FILE, [...clients.values()]);


/* ---------- helpers ---------- */
function toE164(p) {
  const d = String(p || "").replace(/\D/g, "");
  return d.length === 10 ? "+1" + d : "+" + d;
}
function newId() {
  return "bk_" + Math.random().toString(36).slice(2, 10);
}
async function sendSms(to, body) {
  if (!twilioReady) {
    console.log(`[SMS → ${to}] ${body}`);
    return;
  }
  await twilio.messages.create({ to, from: process.env.TWILIO_FROM, body });
}
async function findOrCreateCustomer(phoneE164, name) {
  const found = await stripe.customers.search({
    query: `phone:'${phoneE164}'`,
    limit: 1,
  });
  if (found.data.length) return found.data[0];
  return stripe.customers.create({
    name,
    phone: phoneE164,
    metadata: { phone: phoneE164 },
  });
}
async function hasSavedCard(customerId) {
  const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card" });
  return pms.data.length > 0;
}
function bookingText(b, tag) {
  return [
    `Booking — ${CONFIG.shopName}`,
    `Name: ${b.name}`,
    `Phone: ${b.phone}`,
    `Service: ${b.svc.name} ($${b.svc.price}${b.svc.priceNote || ""}, ~${b.svc.mins} min)`,
    `When: ${b.date} at ${b.time}`,
    b.address ? `Address: ${b.address}` : null,
    b.notes ? `Notes: ${b.notes}` : null,
    `Card: ${tag}`,
  ].filter(Boolean).join("\n");
}
async function confirmBooking(b, tag) {
  await sendSms(BARBER_PHONE, bookingText(b, tag));
  console.log(`[booked] ${b.name} · ${b.svc.name} · ${b.date} ${b.time} · ${tag}`);
}


/* ---------- Stripe webhook (raw body — must come before express.json) ---------- */
app.post("/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(400).send("webhook not configured");
    }
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (e) {
      return res.status(400).send(`Webhook error: ${e.message}`);
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const id = session.metadata && session.metadata.bookingId;
      const b = id && pendings.get(id);
      if (b) {
        pendings.delete(id);
        b.cardSaved = true;
        bookings.set(id, b);
        saveBookings();
        await confirmBooking(b, "new client · card saved ✓");
      }
    }
    res.json({ received: true });
  }
);


app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


/* ---------- API ---------- */
app.get("/api/health", (req, res) => {
  res.json({ ok: true, stripe: !!stripe, sms: twilioReady });
});

// what the booking picker needs to gray out taken slots + time off
app.get("/api/availability", (req, res) => {
  const booked = [...bookings.values()]
    .filter(b => (b.status === "booked" || b.status === "confirmed") && b.dateISO && b.timeMin != null)
    .map(b => ({ dateISO: b.dateISO, timeMin: b.timeMin, mins: b.svc.mins }));
  res.json({ booked, blocked: blocks });
});

app.post("/api/booking/start", async (req, res) => {
  const { name, phone, serviceId, date, time, notes, address, dateISO, timeMin } = req.body || {};
  const svc = CONFIG.services.find(s => s.id === serviceId);
  const phoneE164 = toE164(phone);
  if (!name || !svc || !date || !time || phoneE164.length < 8) {
    return res.status(400).json({ error: "missing or invalid fields" });
  }

  const id = newId();
  const booking = {
    id, name, phone: phoneE164, svc, date, time, notes, address,
    dateISO: dateISO || null, timeMin: timeMin ?? null,
    status: "booked", createdAt: new Date().toISOString(),
  };

  // no Stripe keys yet — record it for the admin anyway, client texts Chris
  if (!stripe) {
    bookings.set(id, booking);
    saveBookings();
    return res.json({ status: "sms_only", bookingId: id });
  }

  try {
    const customer = await findOrCreateCustomer(phoneE164, name);
    booking.customerId = customer.id;
    pendings.set(id, booking);
    setTimeout(() => pendings.delete(id), PENDING_TTL);

    // returning client — card already on file. The client sends their own
    // booking text, which self-verifies: it comes from their real number.
    if (await hasSavedCard(customer.id)) {
      pendings.delete(id);
      bookings.set(id, booking);
      saveBookings();
      return res.json({ status: "has_card" });
    }

    // new client — Stripe Checkout saves the card (setup mode, no charge)
    const origin = `${req.protocol}://${req.get("host")}`;
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customer.id,
      payment_method_types: ["card"],
      success_url: `${origin}/?booking=card-saved`,
      cancel_url: `${origin}/?booking=cancelled`,
      metadata: { bookingId: id },
      custom_text: {
        submit: {
          message:
            `Your card is saved on file for your bookings — it's charged for ` +
            `your service after your cut, or ${CONFIG.noShowPolicy.fee} if you ` +
            `no-show or cancel within ${CONFIG.noShowPolicy.window}.`,
        },
      },
    });
    res.json({ status: "checkout", url: session.url });
  } catch (e) {
    // a Stripe problem (bad key, outage, whatever) must never kill a booking —
    // record it and let the client fall back to texting Chris directly
    console.error("stripe path failed, falling back to sms_only:", e.message);
    pendings.delete(id);
    bookings.set(id, booking);
    saveBookings();
    res.json({ status: "sms_only", bookingId: id });
  }
});

app.post("/api/booking/verify", async (req, res) => {
  const { bookingId, code } = req.body || {};
  const b = pendings.get(bookingId);
  if (!b) return res.status(410).json({ error: "booking expired — start over" });

  const rec = otps.get(b.phone);
  if (!rec || rec.exp < Date.now()) {
    return res.status(410).json({ error: "code expired — hit Confirm again for a new one" });
  }
  if (++rec.tries > OTP_MAX_TRIES) {
    otps.delete(b.phone);
    return res.status(429).json({ error: "too many tries — request a new code" });
  }
  if (rec.code !== String(code || "").trim()) {
    return res.status(400).json({ error: "wrong code — check the text and try again" });
  }

  otps.delete(b.phone);
  pendings.delete(b.id);
  await confirmBooking(b, "returning client · card on file ✓");
  res.json({ ok: true });
});


/* ---------- admin ----------
   Chris's charge dashboard at /admin — one password (ADMIN_KEY env),
   sent as x-admin-key on every request from the admin page. */
function adminAuth(req, res, next) {
  if (!process.env.ADMIN_KEY) {
    return res.status(503).json({ error: "admin not configured — set ADMIN_KEY" });
  }
  if (req.headers["x-admin-key"] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "wrong password" });
  }
  next();
}

app.get("/admin", (req, res) =>
  res.sendFile(path.join(__dirname, "admin", "index.html")));

const ACTIVE_STATUSES = ["booked", "confirmed", "charged", "paid", "refunded", "no_show", "cancelled"];

app.get("/api/admin/bookings", adminAuth, (req, res) => {
  const now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week0 = new Date(day0); week0.setDate(week0.getDate() - week0.getDay());
  const todayISO = now.toISOString().slice(0, 10);
  const collected = b => (b.status === "charged" || b.status === "no_show" ? b.chargedCents || 0
                        : b.status === "paid" ? b.paidCents || 0 : 0);
  const paidAt = b => b.chargedAt || b.paidAt || b.createdAt;
  const earned = since => [...bookings.values()]
    .filter(b => collected(b) && new Date(paidAt(b)) >= since)
    .reduce((s, b) => s + collected(b), 0) / 100;
  const bookedValue = [...bookings.values()]
    .filter(b => (b.status === "booked" || b.status === "confirmed") &&
                 (!b.dateISO || b.dateISO >= todayISO))
    .reduce((s, b) => s + b.svc.price, 0);
  res.json({
    bookings: [...bookings.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    noShowFee: CONFIG.noShowPolicy.fee,
    stripe: !!stripe,
    stats: { today: earned(day0), week: earned(week0), bookedValue },
  });
});

app.post("/api/admin/charge", adminAuth, async (req, res) => {
  const { bookingId, amount } = req.body || {};
  const b = bookings.get(bookingId);
  if (!b) return res.status(404).json({ error: "booking not found" });
  const cents = Math.round(Number(amount) * 100);
  if (!cents || cents < 50) return res.status(400).json({ error: "invalid amount" });
  if (!stripe || !b.customerId) {
    return res.status(400).json({ error: "no card on file for this booking" });
  }
  try {
    const pms = await stripe.paymentMethods.list({ customer: b.customerId, type: "card" });
    if (!pms.data.length) return res.status(400).json({ error: "no card on file" });
    const pi = await stripe.paymentIntents.create({
      amount: cents,
      currency: "usd",
      customer: b.customerId,
      payment_method: pms.data[0].id,
      off_session: true,
      confirm: true,
      description: `${b.svc.name} — ${CONFIG.shopName}`,
      metadata: { bookingId: b.id },
    });
    b.status = "charged";
    b.chargedCents = cents;
    b.chargedAt = new Date().toISOString();
    b.paymentIntent = pi.id;
    bookings.set(b.id, b);
    saveBookings();
    res.json({ ok: true, charged: cents });
  } catch (e) {
    console.error("charge failed:", e.code || e.message);
    res.status(402).json({
      error: e.code === "card_declined" || e.type === "StripeCardError"
        ? "card declined — collect in person"
        : "charge failed — try again or use the Stripe dashboard",
    });
  }
});

app.post("/api/admin/status", adminAuth, (req, res) => {
  const { bookingId, status } = req.body || {};
  const b = bookings.get(bookingId);
  if (!b) return res.status(404).json({ error: "booking not found" });
  if (!ACTIVE_STATUSES.includes(status)) {
    return res.status(400).json({ error: "bad status" });
  }
  b.status = status;
  bookings.set(b.id, b);
  saveBookings();
  res.json({ ok: true });
});

// paid outside Stripe (cash, Zelle, etc.) — counts toward revenue, nothing to refund
app.post("/api/admin/paid", adminAuth, (req, res) => {
  const { bookingId, amount } = req.body || {};
  const b = bookings.get(bookingId);
  if (!b) return res.status(404).json({ error: "booking not found" });
  const cents = Math.round(parseFloat(amount) * 100);
  if (!cents || cents <= 0) return res.status(400).json({ error: "bad amount" });
  b.status = "paid";
  b.paidCents = cents;
  b.paidAt = new Date().toISOString();
  bookings.set(b.id, b);
  saveBookings();
  res.json({ ok: true });
});

app.post("/api/admin/refund", adminAuth, async (req, res) => {
  const { bookingId } = req.body || {};
  const b = bookings.get(bookingId);
  if (!b || !b.paymentIntent) return res.status(400).json({ error: "nothing to refund" });
  if (!stripe) return res.status(503).json({ error: "stripe not configured" });
  try {
    await stripe.refunds.create({ payment_intent: b.paymentIntent });
    b.status = "refunded";
    bookings.set(b.id, b);
    saveBookings();
    res.json({ ok: true });
  } catch (e) {
    console.error("refund failed:", e.message);
    res.status(500).json({ error: "refund failed — try the Stripe dashboard" });
  }
});

// time-off blocks
app.get("/api/admin/blocks", adminAuth, (req, res) => res.json({ blocks }));
app.post("/api/admin/blocks", adminAuth, (req, res) => {
  const { dateISO, timeMin, mins, label } = req.body || {};
  if (!dateISO) return res.status(400).json({ error: "need a date" });
  blocks.push({
    id: newId(), dateISO,
    timeMin: timeMin ?? null, mins: mins ?? null, label: label || "",
  });
  saveBlocks();
  res.json({ ok: true });
});
app.delete("/api/admin/blocks/:id", adminAuth, (req, res) => {
  const i = blocks.findIndex(b => b.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "not found" });
  blocks.splice(i, 1);
  saveBlocks();
  res.json({ ok: true });
});

// client profiles — derived from booking history + stored notes
app.get("/api/admin/clients", adminAuth, (req, res) => {
  const out = {};
  for (const b of bookings.values()) {
    const c = out[b.phone] || (out[b.phone] = {
      name: b.name, phone: b.phone, booked: 0, visits: 0, noShows: 0,
      lastAt: "", services: {}, card: false,
    });
    c.booked++;
    c.name = b.name || c.name;
    if (b.status === "charged" || b.status === "paid") c.visits++;
    if (b.status === "no_show") c.noShows++;
    if (b.customerId || b.cardSaved || b.chargedCents) c.card = true;
    if (b.createdAt > c.lastAt) c.lastAt = b.createdAt;
    c.services[b.svc.name] = (c.services[b.svc.name] || 0) + 1;
  }
  res.json({
    clients: Object.values(out).map(c => ({
      ...c,
      notes: clients.get(c.phone)?.notes || "",
      usual: Object.entries(c.services).sort((a, x) => x[1] - a[1])[0]?.[0] || "",
    })).sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
  });
});
app.post("/api/admin/client", adminAuth, (req, res) => {
  const { phone, notes } = req.body || {};
  if (!phone) return res.status(400).json({ error: "need phone" });
  clients.set(phone, { phone, notes: notes || "" });
  saveClients();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Catch a Fade Chris — http://localhost:${PORT}`);
  console.log(`  stripe: ${stripe ? "configured" : "NOT SET (SMS-only mode)"}`);
  console.log(`  twilio: ${twilioReady ? "configured" : "NOT SET (codes logged to console)"}`);
  // validate the key once — a bad key disables card-on-file rather than
  // failing on every booking
  if (stripe) {
    stripe.customers.list({ limit: 1 })
      .then(() => console.log("  stripe key: valid"))
      .catch(e => {
        console.error(`  stripe key INVALID (${e.message}) — running SMS-only`);
        stripe = null;
      });
  }
});
