/* ============================================================
   CATCH A FADE CHRIS — site config + booking logic
   ------------------------------------------------------------
   ★ EDIT THIS BLOCK with Chris's real info — everything on the
     site (prices, hours, phone, booking texts) updates from here.
   ============================================================ */
const CONFIG = {
  barberName: "Chris",
  shopName: "Catch a Fade Chris",

  // Phone that receives booking texts (SMS). Digits only, with country code.
  phone: "+15550123456",
  phoneDisplay: "(555) 012-3456",

  // Home-based barber — never publish his address. Area + city chips only.
  location: "Colton, CA",
  serviceArea: "Inland Empire to Los Angeles",
  cities: [
    "San Bernardino", "Santa Clarita", "West Hollywood", "Pomona",
    "Huntington Beach", "Jurupa Valley", "Pico Rivera", "Los Angeles",
  ],
  instagram: "catch.a.fade.chris",

  stats: [
    { num: "11,012", label: "IG followers" },
    { num: "399",    label: "posts" },
    { num: "Colton, CA", label: "home-based & mobile" },
    { num: "IE → LA", label: "service area" },
  ],

  // Gallery — Instagram /embeds, biggest first. Video-friendly.
  work: [
    { url: "https://www.instagram.com/p/DfBfjwxFMKJ/",  badge: "Hero pick",      likes: "7.5K", comments: 141, note: "Cut for @n3onsingh · West Hollywood" },
    { url: "https://www.instagram.com/reel/DevpPD1pK-L/", likes: "6.8K", comments: 122 },
    { url: "https://www.instagram.com/reel/DefoG0_JVNv/", likes: "5.4K", comments: 138 },
    { url: "https://www.instagram.com/reel/Deu8Bcjvt6y/", badge: "Most commented", likes: "5.2K", comments: 169, note: "The slick-back everyone asked back for" },
    { url: "https://www.instagram.com/reel/De5zOnapHnL/", likes: "1.9K", comments: 24 },
    { url: "https://www.instagram.com/p/Deuc2RVJsws/",    likes: "1.9K", comments: 38 },
  ],



  // Hours by weekday (0 = Sunday). null = closed.
  hours: {
    0: null,                          // Sunday — closed
    1: { open: 10, close: 18 },       // Mon–Sat 10a–6p
    2: { open: 10, close: 18 },
    3: { open: 10, close: 18 },
    4: { open: 10, close: 18 },
    5: { open: 10, close: 18 },
    6: { open: 10, close: 18 },
  },

  slotMinutes: 30,        // time slots every 30 min
  daysAhead: 14,          // how far out clients can book
  minLeadMinutes: 60,     // can't book a slot starting within the hour

  // bookable:false → shown in the menu but not in the booking picker
  // request:true   → client picks a day + types a preferred time (no fixed slots)
  // needsAddress   → asks for the client's address in step 3
  services: [
    { id: "full",       name: "Full Service",           price: 50,  mins: 60, tag: "Book ahead",
      desc: "The works — cut, beard, eyebrows, goatee, mustache & design, all included." },
    { id: "walkin",     name: "Full Service · Walk-In", price: 65,  mins: 60, tag: "Walk-in", bookable: false,
      desc: "Same-day walk-in full service. No appointment — first come, first served." },
    { id: "afterhours", name: "After Hours",            price: 100, mins: 60, tag: "By request", request: true,
      desc: "Outside regular hours, by appointment only. Text Chris to lock in a time." },
    { id: "housecall",  name: "Housecall",              price: 100, mins: 60, tag: "By request", request: true, needsAddress: true, priceNote: " + gas",
      desc: "Chris pulls up to you — $100 per cut plus gas." },
  ],
};
/* ================== end of editable config ================== */


const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = { step: 1, service: null, date: null, time: null, timeText: "" };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];


/* ---------- helpers ---------- */
function fmtTime(h, m) {
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return m ? `${hr}:${String(m).padStart(2, "0")} ${ampm}` : `${hr} ${ampm}`;
}
function fmtHourRange(h) {
  if (!h) return "Closed";
  return `${fmtTime(h.open, 0)} – ${fmtTime(h.close, 0)}`;
}
function fmtDateShort(d) {
  return `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._to);
  t._to = setTimeout(() => t.classList.remove("show"), 2600);
}
function serviceById(id) { return CONFIG.services.find(s => s.id === id); }


/* ---------- render: services section ---------- */
function renderServices() {
  $("#services-grid").innerHTML = CONFIG.services.map(s => `
    <article class="service-card reveal">
      <div class="service-top">
        <h3 class="service-name">${s.name}</h3>
        <span class="service-price">$${s.price}${s.priceNote ? `<small class="price-note">${s.priceNote}</small>` : ""}</span>
      </div>
      <p class="service-desc">${s.desc}</p>
      <div class="service-meta">
        <span class="service-time">${s.mins} min</span>
        ${s.bookable === false
          ? `<span class="service-tag">${s.tag}</span>`
          : `<a href="#book" class="service-book" data-book-service="${s.id}">Book this →</a>`}
      </div>
    </article>`).join("");

  $$("[data-book-service]").forEach(a => {
    a.addEventListener("click", () => selectService(a.dataset.bookService));
  });
}


/* ---------- render: hours / contact / chips ---------- */
function renderInfo() {
  const today = new Date().getDay();
  // order the list starting Monday
  const order = [1, 2, 3, 4, 5, 6, 0];
  $("#hours-list").innerHTML = order.map(d => {
    const h = CONFIG.hours[d];
    return `<li class="${h ? "" : "closed"} ${d === today ? "is-today" : ""}">
      <span>${DOW_FULL[d]}</span><span>${fmtHourRange(h)}</span>
    </li>`;
  }).join("");

  $("#visit-area").textContent = `${CONFIG.location}-based · ${CONFIG.serviceArea}`;
  $("#city-chips").innerHTML = CONFIG.cities.map(c => `<span class="chip chip-sm">${c}</span>`).join("");
  $("#phone-link").href = "sms:" + CONFIG.phone;
  $("#phone-link").textContent = "Text " + CONFIG.phoneDisplay;
  $("#copy-phone").textContent = CONFIG.phoneDisplay;
  $("#ig-link").href = "https://instagram.com/" + CONFIG.instagram;
  $("#ig-link").textContent = "@" + CONFIG.instagram;
  $("#ig-more").href = "https://instagram.com/" + CONFIG.instagram;
  $("#chip-location").textContent = CONFIG.location + " · home-based & mobile";
  const openDays = Object.keys(CONFIG.hours).map(Number)
    .filter(d => CONFIG.hours[d]).sort((a, b) => a - b);
  const contiguous = openDays.every((d, i) => i === 0 || d === openDays[i - 1] + 1);
  $("#chip-hours").textContent = "Open " + (contiguous
    ? `${DOW[openDays[0]]}–${DOW[openDays[openDays.length - 1]]}`
    : openDays.map(d => DOW[d]).join(" · "));
  const walkin = CONFIG.services.find(s => s.bookable === false);
  if (walkin) $("#chip-walkin").textContent = `Walk-ins welcome · $${walkin.price}`;
}


/* ---------- render: stats bar / work gallery / clientele ---------- */
function renderStats() {
  $("#stats-bar").innerHTML = CONFIG.stats.map(s => `
    <div class="stat"><b>${s.num}</b><span>${s.label}</span></div>`).join("");
}

function renderWork() {
  $("#work-scroll").innerHTML = CONFIG.work.map(w => `
    <figure class="work-card">
      <div class="work-frame">
        <iframe src="${w.url}embed" loading="lazy" scrolling="no" title="Instagram post by @${CONFIG.instagram}"></iframe>
      </div>
      <figcaption class="work-caption">
        ${w.badge ? `<span class="work-badge">${w.badge}</span>` : ""}
        <span class="work-likes">♥ ${w.likes} · ${w.comments} comments</span>
        ${w.note ? `<span class="work-note">${w.note}</span>` : ""}
        <a class="work-link" href="${w.url}" target="_blank" rel="noopener">Watch ↗</a>
      </figcaption>
    </figure>`).join("");
}

/* ---------- booking: step 1 — service picker ---------- */
function renderServicePicker() {
  $("#service-picker").innerHTML = CONFIG.services
    .filter(s => s.bookable !== false)
    .map(s => `
    <button type="button" class="pick" data-service="${s.id}">
      <span class="pick-name">${s.name}</span>
      <span class="pick-meta"><span>$${s.price}${s.priceNote || ""}</span><span>${s.request ? s.tag : s.mins + " min"}</span></span>
    </button>`).join("");

  $$("#service-picker .pick").forEach(b => {
    b.addEventListener("click", () => selectService(b.dataset.service));
  });
}
function selectService(id) {
  if (state.service !== id) state.time = null;
  state.service = id;
  $$("#service-picker .pick").forEach(b =>
    b.classList.toggle("is-selected", b.dataset.service === id));
}


/* ---------- booking: step 2 — dates & times ---------- */
function renderDates() {
  const strip = $("#date-strip");
  const days = [];
  const d = new Date();
  for (let i = 0; days.length < CONFIG.daysAhead && i < 40; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    if (CONFIG.hours[day.getDay()]) days.push(day);
  }
  strip.innerHTML = days.map(day => {
    const key = day.toDateString();
    return `<button type="button" class="date-btn ${state.date === key ? "is-selected" : ""}" data-date="${key}">
      <span class="date-dow">${DOW[day.getDay()]}</span>
      <span class="date-num">${day.getDate()}</span>
      <span class="date-mon">${MON[day.getMonth()]}</span>
    </button>`;
  }).join("");

  $$("#date-strip .date-btn").forEach(b => {
    b.addEventListener("click", () => {
      state.date = b.dataset.date;
      state.time = null;
      $$("#date-strip .date-btn").forEach(x =>
        x.classList.toggle("is-selected", x === b));
      renderTimes(new Date(state.date));
    });
  });
}

function renderTimes(day) {
  const grid = $("#time-grid");
  const svc = serviceById(state.service);
  const h = CONFIG.hours[day.getDay()];
  if (!h || !svc) { grid.innerHTML = `<p class="hint">Pick a day first.</p>`; return; }

  // after-hours / housecall: no fixed slots — client requests a preferred time
  if (svc.request) {
    grid.innerHTML = `
      <label class="field field-full pref-time">
        <span>Preferred time</span>
        <input type="text" id="f-pref-time" placeholder="e.g. 7:30 PM" value="${escapeHtml(state.timeText)}" />
      </label>
      <p class="hint field-full">${svc.needsAddress
        ? "Chris confirms timing and the gas total by text."
        : "Chris confirms your after-hours slot by text."}</p>`;
    $("#f-pref-time").addEventListener("input", e => { state.timeText = e.target.value; });
    return;
  }

  const isToday = day.toDateString() === new Date().toDateString();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes() + CONFIG.minLeadMinutes;

  const slots = [];
  for (let t = h.open * 60; t + svc.mins <= h.close * 60; t += CONFIG.slotMinutes) {
    slots.push(t);
  }

  grid.innerHTML = slots.map(t => {
    const label = fmtTime(Math.floor(t / 60), t % 60);
    const past = isToday && t < nowMin;
    return `<button type="button" class="time-btn ${state.time === t ? "is-selected" : ""}"
      data-time="${t}" ${past ? "disabled" : ""}>${label}</button>`;
  }).join("") || `<p class="hint">No slots left this day — try another.</p>`;

  $$("#time-grid .time-btn").forEach(b => {
    b.addEventListener("click", () => {
      state.time = +b.dataset.time;
      $$("#time-grid .time-btn").forEach(x =>
        x.classList.toggle("is-selected", x === b));
    });
  });
}


/* ---------- booking: step 4 — summary + SMS ---------- */
function renderSummary() {
  const svc = serviceById(state.service);
  const d = new Date(state.date);
  const when = svc.request
    ? `${fmtDateShort(d)} · ${state.timeText.trim()} (requested)`
    : `${fmtDateShort(d)} · ${fmtTime(Math.floor(state.time / 60), state.time % 60)}`;
  const notes = $("#f-notes").value.trim();
  const addr = $("#f-addr")?.value.trim();

  $("#summary").innerHTML = `
    <dl>
      <div class="summary-row"><dt>Service</dt><dd>${svc.name} — $${svc.price}${svc.priceNote || ""}</dd></div>
      <div class="summary-row"><dt>When</dt><dd>${when}</dd></div>
      <div class="summary-row"><dt>Name</dt><dd>${escapeHtml($("#f-name").value.trim())}</dd></div>
      <div class="summary-row"><dt>Phone</dt><dd>${escapeHtml($("#f-phone").value.trim())}</dd></div>
      ${addr ? `<div class="summary-row"><dt>Address</dt><dd>${escapeHtml(addr)}</dd></div>` : ""}
      ${notes ? `<div class="summary-row"><dt>Notes</dt><dd>${escapeHtml(notes)}</dd></div>` : ""}
    </dl>`;
}

function bookingMessage() {
  const svc = serviceById(state.service);
  const d = new Date(state.date);
  const when = svc.request
    ? `${fmtDateShort(d)} at ${state.timeText.trim()} (requested)`
    : `${fmtDateShort(d)} at ${fmtTime(Math.floor(state.time / 60), state.time % 60)}`;
  const notes = $("#f-notes").value.trim();
  const addr = $("#f-addr")?.value.trim();
  return [
    `Booking request — ${CONFIG.shopName}`,
    `Name: ${$("#f-name").value.trim()}`,
    `Phone: ${$("#f-phone").value.trim()}`,
    `Service: ${svc.name} ($${svc.price}${svc.priceNote || ""}, ~${svc.mins} min)`,
    `When: ${when}`,
    addr ? `Address: ${addr}` : null,
    notes ? `Notes: ${notes}` : null,
  ].filter(Boolean).join("\n");
}

function sendBookingText() {
  // sms: deep link — "?&body=" keeps both iOS and Android happy
  const url = `sms:${CONFIG.phone}?&body=${encodeURIComponent(bookingMessage())}`;
  window.location.href = url;
  toast("Opening your messages — just press send.");
}

$("#btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(bookingMessage());
    toast("Booking details copied — paste them in a text to Chris.");
  } catch {
    toast("Couldn't copy — take a screenshot of the summary instead.");
  }
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}


/* ---------- step machine ---------- */
function goTo(step) {
  state.step = step;
  $$(".panel").forEach(p => p.classList.toggle("is-active", +p.dataset.panel === step));
  $$(".step").forEach(s => {
    const n = +s.dataset.stepDot;
    s.classList.toggle("is-active", n === step);
    s.classList.toggle("is-done", n < step);
  });
  $("#btn-back").disabled = step === 1;
  $("#btn-next").textContent = step === 4 ? "Text Chris to Book" : "Continue";
  if (step === 2 && state.date) renderTimes(new Date(state.date));
  if (step === 3) {
    $("#f-addr-wrap").hidden = !serviceById(state.service)?.needsAddress;
  }
  if (step === 4) renderSummary();
}

function validateStep() {
  if (state.step === 1 && !state.service) {
    toast("Pick a service first.");
    return false;
  }
  if (state.step === 2) {
    const svc = serviceById(state.service);
    const needsTime = svc?.request ? !state.timeText.trim() : state.time == null;
    if (state.date == null || needsTime) {
      toast(svc?.request ? "Pick a day and a preferred time." : "Pick a day and a time.");
      return false;
    }
  }
  if (state.step === 3) {
    const name = $("#f-name"), phone = $("#f-phone"), addr = $("#f-addr");
    const svc = serviceById(state.service);
    let ok = true;
    if (!name.value.trim()) { name.classList.add("is-error"); ok = false; }
    if (!phone.value.trim() || phone.value.replace(/\D/g, "").length < 7) {
      phone.classList.add("is-error"); ok = false;
    }
    if (svc?.needsAddress && !addr.value.trim()) { addr.classList.add("is-error"); ok = false; }
    if (!ok) { toast("Fill in the required fields."); return false; }
  }
  return true;
}

$("#btn-next").addEventListener("click", () => {
  if (!validateStep()) return;
  if (state.step < 4) goTo(state.step + 1);
  else sendBookingText();
});
$("#btn-back").addEventListener("click", () => {
  if (state.step > 1) goTo(state.step - 1);
});
["f-name", "f-phone", "f-addr"].forEach(id => {
  $("#" + id).addEventListener("input", e => e.target.classList.remove("is-error"));
});
// re-render summary live if fields change on step 4
$$(".field input").forEach(i => i.addEventListener("input", () => {
  if (state.step === 4) renderSummary();
}));


/* ---------- chrome: nav, reveal, misc ---------- */
const nav = $("#nav");
addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 10), { passive: true });

const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  });
}, { threshold: 0.12 });

function observeReveals() {
  $$(".reveal:not(.in)").forEach(el => io.observe(el));
}

$("#year").textContent = new Date().getFullYear();


/* ---------- boot ---------- */
renderServices();
renderInfo();
renderStats();
renderWork();
renderServicePicker();
renderDates();
observeReveals();
