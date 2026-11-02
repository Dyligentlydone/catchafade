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
let AVAIL = { booked: [], blocked: [] };


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
function dayISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function overlap(s1, e1, s2, e2) { return s1 < e2 && s2 < e1; }

// slots for a day, flagged taken by booked appointments or time-off blocks
function slotsForDay(day) {
  const svc = serviceById(state.service);
  const h = CONFIG.hours[day.getDay()];
  if (!h || !svc || svc.request) return [];
  const iso = dayISO(day);
  const isToday = day.toDateString() === new Date().toDateString();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes() + CONFIG.minLeadMinutes;
  const slots = [];
  for (let t = h.open * 60; t + svc.mins <= h.close * 60; t += CONFIG.slotMinutes) {
    let taken = isToday && t < nowMin;
    if (!taken) for (const b of AVAIL.booked) {
      if (b.dateISO === iso && overlap(t, t + svc.mins, b.timeMin, b.timeMin + b.mins)) { taken = true; break; }
    }
    if (!taken) for (const bl of AVAIL.blocked) {
      if (bl.dateISO !== iso) continue;
      if (bl.timeMin == null || overlap(t, t + svc.mins, bl.timeMin, bl.timeMin + bl.mins)) { taken = true; break; }
    }
    slots.push({ t, taken });
  }
  return slots;
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
  // the strip's disabled state depends on the service — rebuild it, and
  // drop a selected date that just became unavailable under this service
  if (state.date) {
    const day = new Date(state.date);
    const svc = serviceById(id);
    const stillFree = svc.request
      ? !AVAIL.blocked.some(b => b.dateISO === dayISO(day) && b.timeMin == null)
      : slotsForDay(day).some(s => !s.taken);
    if (!stillFree) {
      state.date = null;
      $("#time-grid").innerHTML = `<p class="hint">Pick a day first.</p>`;
    }
  }
  renderDates();
  if (state.date) renderTimes(new Date(state.date));
}


/* ---------- booking: step 2 — dates & times ---------- */
function renderDates() {
  const strip = $("#date-strip");
  const svc = serviceById(state.service);
  const days = [];
  const d = new Date();
  for (let i = 0; days.length < CONFIG.daysAhead && i < 45; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    if (CONFIG.hours[day.getDay()]) days.push(day);
  }
  strip.innerHTML = days.map(day => {
    const key = day.toDateString();
    const full = svc
      ? (svc.request
          ? AVAIL.blocked.some(b => b.dateISO === dayISO(day) && b.timeMin == null)
          : !slotsForDay(day).some(s => !s.taken))
      : false;
    return `<button type="button" class="date-btn ${state.date === key ? "is-selected" : ""}"
      data-date="${key}" ${full ? "disabled" : ""}>
      <span class="date-dow">${DOW[day.getDay()]}</span>
      <span class="date-num">${day.getDate()}</span>
      <span class="date-mon">${MON[day.getMonth()]}</span>
    </button>`;
  }).join("");

  $$("#date-strip .date-btn:not(:disabled)").forEach(b => {
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

  const slots = slotsForDay(day);
  grid.innerHTML = slots.map(({ t, taken }) => {
    const label = fmtTime(Math.floor(t / 60), t % 60);
    return `<button type="button" class="time-btn ${state.time === t ? "is-selected" : ""}"
      data-time="${t}" ${taken ? "disabled" : ""}>${label}</button>`;
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
    dateISO: dayISO(d),
    timeMin: svc.request ? null : state.time,
    time: svc.request
      ? state.timeText.trim() + " (requested)"
      : fmtTime(Math.floor(state.time / 60), state.time % 60),
    notes: $("#f-notes").value.trim(),
    address: $("#f-addr")?.value.trim() || "",
  };
}

function renderSummary() {
  const svc = serviceById(state.service);
  if (!svc) return;
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
    `NEW BOOKING — ${CONFIG.shopName}`,
    ``,
    `WHEN:    ${p.date} · ${p.time}`,
    `SERVICE: ${svc.name} · $${svc.price}${svc.priceNote || ""}`,
    `CLIENT:  ${p.name}`,
    `PHONE:   ${p.phone}`,
    p.notes ? `NOTES:   ${p.notes}` : null,
    p.address ? `ADDR:    ${p.address}` : null,
  ].filter(Boolean).join("\n");
}

function setLoading(on) {
  const btn = $("#btn-next");
  btn.disabled = on;
  btn.textContent = on ? "Working…" : (state.otpShown ? "Verify & Book" : "Send Booking");
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
  $("#sms-final").hidden = true;
  $(".book-controls").style.display = "";
  $("#f-notes").value = "";
  $("#f-addr").value = "";
  renderDates();
  $("#time-grid").innerHTML = `<p class="hint">Pick a day first.</p>`;
  goTo(1);
}

// Booking goes out as a text from the client's own phone — free, no accounts,
// and Chris gets a real number he can reply to directly.
function fallbackSmsBook() {
  const url = `sms:${CONFIG.phone}?&body=${encodeURIComponent(bookingMessage())}`;
  window.location.href = url;
  toast("Opening your messages — just press send.");
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
      // stash the finished booking text — the page reloads after Stripe
      // redirects back, so we rebuild the sms: link from storage
      localStorage.setItem("cafc_sms", bookingMessage());
      toast("One quick step — add a card (never charged), then your booking text goes out.");
      location.href = data.url;
    } else {
      // card already on file or SMS-only — mark the slot taken + go to the text
      const p = bookingPayload();
      if (p.timeMin != null) {
        AVAIL.booked.push({ dateISO: p.dateISO, timeMin: p.timeMin, mins: serviceById(state.service).mins });
      }
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
  $("#btn-next").textContent = step === 4 ? "Send Booking" : "Continue";
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


/* ---------- intro video → logo handoff ---------- */
// the video sits in the logo's exact slot above a black veil; when it ends
// both fade out together so the video blends seamlessly into the real logo.
(function introHandoff() {
  const veil = $("#intro-veil"), vid = $("#intro-video");
  if (!veil || !vid) return;
  const skip = sessionStorage.getItem("cafc_intro") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (skip) { veil.remove(); vid.remove(); return; }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    veil.classList.add("out");
    vid.classList.add("out");
    sessionStorage.setItem("cafc_intro", "1");
    setTimeout(() => { veil.remove(); vid.remove(); }, 900);
  };
  vid.playbackRate = 1.85;
  vid.addEventListener("ended", finish);
  vid.addEventListener("error", finish);
  setTimeout(finish, 5000); // hard cap — never trap the visitor
  vid.play().catch(finish);
})();


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
function showSendSms(url) {
  // jump straight to panel 4's success state with a send-text button
  $$(".panel").forEach(p => p.classList.toggle("is-active", +p.dataset.panel === 4));
  $$(".step").forEach(s => {
    const n = +s.dataset.stepDot;
    s.classList.toggle("is-active", n === 4);
    s.classList.toggle("is-done", n < 4);
  });
  $("#summary").hidden = true;
  $("#policy-note").hidden = true;
  $("#otp-box").hidden = true;
  const bk = $("#booked");
  bk.hidden = false;
  bk.querySelector(".booked-title").textContent = "Card saved ✓";
  bk.querySelector(".hint").textContent = "Last step — send Chris your booking text.";
  const a = $("#sms-final");
  a.href = url;
  a.hidden = false;
  $(".book-controls").style.display = "none";
  document.getElementById("book").scrollIntoView({ behavior: "smooth" });
  // on touch devices, offer the messages app immediately too
  if (matchMedia("(pointer: coarse)").matches) location.href = url;
}

function handleReturnParams() {
  const p = new URLSearchParams(location.search);
  const b = p.get("booking");
  if (!b) return;
  history.replaceState(null, "", location.pathname);
  if (b === "card-saved") {
    const msg = localStorage.getItem("cafc_sms");
    localStorage.removeItem("cafc_sms");
    if (msg) {
      showSendSms(`sms:${CONFIG.phone}?&body=${encodeURIComponent(msg)}`);
    } else {
      toast("Card saved ✓ — send your booking text to finish.");
      document.getElementById("book").scrollIntoView({ behavior: "smooth" });
    }
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
    // taken slots + time off — the picker grays them out (fail-open if unavailable)
    fetch("/api/availability").then(r => r.json()).then(a => {
      AVAIL = a;
      renderDates();
    }).catch(() => {});
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
