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

const stripe = process.env.STRIPE_SECRET_KEY
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

app.post("/api/booking/start", async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "payments not configured" });

  const { name, phone, serviceId, date, time, notes, address } = req.body || {};
  const svc = CONFIG.services.find(s => s.id === serviceId);
  const phoneE164 = toE164(phone);
  if (!name || !svc || !date || !time || phoneE164.length < 8) {
    return res.status(400).json({ error: "missing or invalid fields" });
  }

  const id = newId();
  const booking = { id, name, phone: phoneE164, svc, date, time, notes, address };

  try {
    const customer = await findOrCreateCustomer(phoneE164, name);
    booking.customerId = customer.id;
    pendings.set(id, booking);
    setTimeout(() => pendings.delete(id), PENDING_TTL);

    // returning client — card already on file, verify by text code
    if (await hasSavedCard(customer.id)) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      otps.set(phoneE164, { code, exp: Date.now() + OTP_TTL, tries: 0 });
      await sendSms(phoneE164,
        `${CONFIG.shopName} — your booking code is ${code} (expires in 10 min)`);
      return res.json({
        status: "otp_required",
        bookingId: id,
        // lets you test the flow locally without Twilio
        devCode: PROD ? undefined : code,
      });
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
            `Your card is saved for no-show protection — it's only charged ` +
            `${CONFIG.noShowPolicy.fee} if you miss your appointment or cancel ` +
            `within ${CONFIG.noShowPolicy.window}.`,
        },
      },
    });
    res.json({ status: "checkout", url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "booking failed — try again" });
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


app.listen(PORT, () => {
  console.log(`Catch a Fade Chris — http://localhost:${PORT}`);
  console.log(`  stripe: ${stripe ? "configured" : "NOT SET (503 on /api/booking)"}`);
  console.log(`  twilio: ${twilioReady ? "configured" : "NOT SET (codes logged to console)"}`);
});
