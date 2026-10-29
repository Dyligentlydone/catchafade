# Catch a Fade Chris

Booking site for a Colton, CA barber — dark vintage design, Instagram work
gallery, and card-on-file booking via Stripe (no-show protection). No client
accounts; returning clients verify with a text code.

## Structure

- `public/` — the site (HTML/CSS/JS). All business info lives in
  `public/config.json` — edit services, prices, hours, gallery links there.
- `server.js` — Express: serves `public/` + booking API (Stripe + Twilio).

## Run locally

```bash
npm install
npm start          # http://localhost:3000
```

Without env keys the site works but bookings fall back to plain SMS.

## Deploy (Railway)

Push to GitHub — Railway detects Node, runs `npm start`. Set env vars from
`.env.example` in the Railway Variables tab.

## Stripe setup (one-time)

1. Create a Stripe account for Chris → get `sk_live_` (or `sk_test_` first).
2. Enable **Customer Search** is automatic; card-on-file needs nothing extra —
   Checkout `setup` mode saves cards off-session-ready.
3. Add a webhook: Dashboard → Developers → Webhooks → endpoint
   `https://YOUR-DOMAIN/api/stripe/webhook`, event `checkout.session.completed`
   → copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. To charge a no-show fee: Stripe Dashboard → Customers → search the phone
   number → Create payment → pick their saved card.

## Twilio setup (one-time)

Free trial account works — grab SID, token, and a phone number, set the env
vars. Without Twilio, verification codes are logged to the server console and
returned in the API response when `NODE_ENV` isn't `production`.

## Env vars

See `.env.example`.
