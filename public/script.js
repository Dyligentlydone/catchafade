/* ============================================================
   CATCH A FADE CHRIS — site + booking logic
   ------------------------------------------------------------
   All business info lives in /config.json — the server reads the
   same file, so it stays the single source of truth (and later,
   it's what an admin panel edits).
   ============================================================ */
let CONFIG = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  step: 1, service: null, date: null, time: null, timeText: "",
  bookingId: null, otpShown: false,
};
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
  t._to = setTimeout(() => t.classList.remove("show"), 3200);
}
function serviceById(id) { return CONFIG.services.find(s => s.id === id); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}


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
    a.addEventListener("click", () => {
      selectService(a.dataset.bookService);
      if (state.step !== 1) goTo(1);
    });
  });
}


/* ---------- render: hours / contact / chips ---------- */
function renderInfo() {
  const today = new Date().getDay();
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
  $("#policy-note").textContent =
    `A card on file is required to book — it's never charged unless you no-show ` +
    `or cancel within ${CONFIG.noShowPolicy.window} (${CONFIG.noShowPolicy.fee} fee). ` +
    `Cards handled securely by Stripe.`;
}


/* ---------- render: stats bar / work gallery ---------- */
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


/* ---------- booking: step 4 — summary + submit ---------- */
function bookingPayload() {
  const svc = serviceById(state.service);
  const d = new Date(state.date);
  return {
    name: $("#f-name").value.trim(),
    phone: $("#f-phone").value.trim(),
    serviceId: svc.id,
    date: fmtDateShort(d),
    time: svc.request
      ? state.timeText.trim() + " (requested)"
      : fmtTime(Math.floor(state.time / 60), state.time % 60),
    notes: $("#f-notes").value.trim(),
    address: $("#f-addr")?.value.trim() || "",
  };
}

function renderSummary() {
  const svc = serviceById(state.service);
  const p = bookingPayload();
  $("#summary").innerHTML = `
    <dl>
      <div class="summary-row"><dt>Service</dt><dd>${svc.name} — $${svc.price}${svc.priceNote || ""}</dd></div>
      <div class="summary-row"><dt>When</dt><dd>${p.date} · ${p.time}</dd></div>
      <div class="summary-row"><dt>Name</dt><dd>${escapeHtml(p.name)}</dd></div>
      <div class="summary-row"><dt>Phone</dt><dd>${escapeHtml(p.phone)}</dd></div>
      ${p.address ? `<div class="summary-row"><dt>Address</dt><dd>${escapeHtml(p.address)}</dd></div>` : ""}
      ${p.notes ? `<div class="summary-row"><dt>Notes</dt><dd>${escapeHtml(p.notes)}</dd></div>` : ""}
    </dl>`;
}

function bookingMessage() {
  const svc = serviceById(state.service);
  const p = bookingPayload();
  return [
    `Booking request — ${CONFIG.shopName}`,
    `Name: ${p.name}`,
    `Phone: ${p.phone}`,
    `Service: ${svc.name} ($${svc.price}${svc.priceNote || ""}, ~${svc.mins} min)`,
    `When: ${p.date} at ${p.time}`,
    p.address ? `Address: ${p.address}` : null,
    p.notes ? `Notes: ${p.notes}` : null,
  ].filter(Boolean).join("\n");
}

function setLoading(on) {
  const btn = $("#btn-next");
  btn.disabled = on;
  btn.textContent = on ? "Working…" : (state.otpShown ? "Verify & Book" : "Confirm Booking");
}

function showOtp(devCode) {
  state.otpShown = true;
  $("#otp-box").hidden = false;
  $("#summary").classList.add("dimmed");
  const btn = $("#btn-next");
  btn.textContent = "Verify & Book";
  $("#f-code").focus();
  toast(devCode
    ? `Dev mode — your code is ${devCode}`
    : "We texted you a code — enter it to finish.");
}

function showBooked() {
  $("#summary").hidden = true;
  $("#otp-box").hidden = true;
  $("#policy-note").hidden = true;
  $("#booked").hidden = false;
  $(".book-controls").style.display = "none";
}

function resetBooking() {
  Object.assign(state, { step: 1, service: null, date: null, time: null,
    timeText: "", bookingId: null, otpShown: false });
  $$("#service-picker .pick").forEach(b => b.classList.remove("is-selected"));
  $("#summary").hidden = false;
  $("#summary").classList.remove("dimmed");
  $("#policy-note").hidden = false;
  $("#booked").hidden = true;
  $(".book-controls").style.display = "";
  $("#f-notes").value = "";
  $("#f-addr").value = "";
  renderDates();
  $("#time-grid").innerHTML = `<p class="hint">Pick a day first.</p>`;
  goTo(1);
}

// Fallback when the booking API is unreachable — old text-it-yourself flow
function fallbackSmsBook() {
  const url = `sms:${CONFIG.phone}?&body=${encodeURIComponent(bookingMessage())}`;
  window.location.href = url;
  toast("Couldn't reach the booking system — sending as a text instead.");
}

async function submitBooking() {
  setLoading(true);
  try {
    const r = await fetch("/api/booking/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bookingPayload()),
    });
    const data = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) {
      if (r.status === 503) { fallbackSmsBook(); return; }
      toast(data.error || "Something went wrong — try again.");
      return;
    }
    if (data.status === "checkout") {
      toast("Opening secure card setup — your booking continues right after.");
      location.href = data.url;
    } else if (data.status === "otp_required") {
      state.bookingId = data.bookingId;
      showOtp(data.devCode);
    } else {
      fallbackSmsBook();
    }
  } catch {
    setLoading(false);
    fallbackSmsBook();
  }
}

async function verifyCode() {
  const code = $("#f-code").value.trim();
  if (code.length < 4) { toast("Enter the 6-digit code from the text."); return; }
  setLoading(true);
  try {
    const r = await fetch("/api/booking/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: state.bookingId, code }),
    });
    const data = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) {
      toast(data.error || "Couldn't verify — try again.");
      if (r.status === 410) { state.otpShown = false; $("#otp-box").hidden = true; $("#summary").classList.remove("dimmed"); $("#btn-next").textContent = "Confirm Booking"; }
      return;
    }
    showBooked();
  } catch {
    setLoading(false);
    toast("Couldn't reach the booking system — try again.");
  }
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
  $("#btn-next").textContent = step === 4 ? "Confirm Booking" : "Continue";
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


/* ---------- events ---------- */
$("#btn-next").addEventListener("click", () => {
  if (state.step === 4) {
    state.otpShown ? verifyCode() : submitBooking();
    return;
  }
  if (!validateStep()) return;
  goTo(state.step + 1);
});
$("#btn-back").addEventListener("click", () => {
  if (state.step > 1) goTo(state.step - 1);
});
$("#btn-again").addEventListener("click", resetBooking);
$("#btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(bookingMessage());
    toast("Booking details copied — paste them in a text to Chris.");
  } catch {
    toast("Couldn't copy — take a screenshot of the summary instead.");
  }
});
["f-name", "f-phone", "f-addr", "f-code"].forEach(id => {
  $("#" + id).addEventListener("input", e => e.target.classList.remove("is-error"));
});
// re-render summary live if fields change on step 4
$$(".field input").forEach(i => i.addEventListener("input", () => {
  if (state.step === 4) renderSummary();
}));


/* ---------- landing back from Stripe ---------- */
function handleReturnParams() {
  const p = new URLSearchParams(location.search);
  const b = p.get("booking");
  if (!b) return;
  history.replaceState(null, "", location.pathname);
  if (b === "card-saved") {
    toast("Card saved ✓ You're booked — Chris will text you to confirm.");
  } else if (b === "cancelled") {
    toast("Card setup was cancelled — your booking isn't confirmed yet.");
    document.getElementById("book").scrollIntoView({ behavior: "smooth" });
  }
}


/* ---------- boot ---------- */
fetch("config.json")
  .then(r => r.json())
  .then(cfg => {
    CONFIG = cfg;
    renderServices();
    renderInfo();
    renderStats();
    renderWork();
    renderServicePicker();
    renderDates();
    observeReveals();
    handleReturnParams();
  })
  .catch(() => toast("Site failed to load — refresh the page."));
