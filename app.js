"use strict";

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = n => n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN");
const k = n => n == null ? "" : (n >= 100000 ? Math.round(n / 1000) : (n / 1000).toFixed(1).replace(/\.0$/, "")) + "k";
const D = s => new Date(s.length === 10 ? s + "T00:00:00" : s);
const fmtDay = s => D(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtDate = s => D(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = s => D(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dur = m => m ? `${Math.floor(m / 60)}h ${m % 60}m` : "";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SERIES = ["--s1", "--s2", "--s3"];
const RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281"];

function ago(s) {
  const m = Math.round((Date.now() - D(s).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const airport = c => (DATA.config.airports || {})[c] || c;

// ---------- state ----------
let DATA = null;
const S = { tab: "home", city: "ALL", nights: "best", month: null, logKind: "searches", logFilter: "all" };

async function load(manual) {
  const btn = $("#refresh");
  btn.classList.add("spin");
  try {
    const r = await fetch("data/data.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
    if (S.month == null) S.month = firstInterestingMonth();
    render(!!manual);
  } catch (e) {
    $("#status").textContent = DATA ? "Offline — showing last data" : "Couldn't load data";
    if (!DATA) $("#view").innerHTML = `<div class="empty-state">Couldn't load tracker data.<br>Check your connection and tap ⟳.</div>`;
  } finally {
    btn.classList.remove("spin");
  }
}

function firstInterestingMonth() {
  const now = new Date();
  const y = Number(DATA.config.from.slice(0, 4));
  return now.getFullYear() === y ? now.getMonth() : 0;
}

// ---------- data shaping ----------
function optionsFor(day) {
  // all options (origin + nights) for a date, respecting filters
  const out = [];
  for (const o of DATA.config.origins) {
    if (S.city !== "ALL" && S.city !== o) continue;
    for (const opt of (DATA.calendar[o][day] || [])) {
      if (S.nights !== "best" && String(opt.n) !== String(S.nights)) continue;
      out.push({ ...opt, origin: o });
    }
  }
  return out;
}

function dayState(day) {
  const opts = optionsFor(day);
  if (!opts.length) return { state: "blank" };
  const priced = opts.filter(o => o.p != null).sort((a, b) => a.p - b.p);
  if (priced.length) return { state: "ok", best: priced[0], opts };
  const order = ["past", "not_on_sale", "retry", "queued", "none"];
  for (const s of order) if (opts.some(o => o.state === s)) return { state: s, opts };
  return { state: "queued", opts };
}

function allPrices() {
  const ps = [];
  for (const o of DATA.config.origins) {
    if (S.city !== "ALL" && S.city !== o) continue;
    for (const [day, opts] of Object.entries(DATA.calendar[o])) {
      const best = opts.filter(x => x.p != null && (S.nights === "best" || String(x.n) === String(S.nights)));
      if (best.length) ps.push(Math.min(...best.map(x => x.p)));
    }
  }
  return ps.sort((a, b) => a - b);
}

function colorFor(p, lo, hi) {
  const t = Math.min(Math.max((p - lo) / Math.max(hi - lo, 1), 0), 1);
  const i = RAMP.length - 1 - Math.round(t * (RAMP.length - 1));   // darker = cheaper
  return { bg: RAMP[i], fg: i >= 7 ? "#fff" : "#0b0b0b" };
}

// ---------- header ----------
function renderStatus() {
  const g = DATA.generated, c = DATA.coverage;
  const live = DATA.running && (Date.now() - D(g).getTime()) < 40 * 60000;
  $("#status").innerHTML = `${live ? '<span class="live"></span>Searching now · ' : ""}Updated ${ago(g)} · ${c.fresh}/${c.onSale} dates priced`;
}

// ---------- HOME ----------
function typeBadge(t) {
  if (t.stops === 0) return `<span class="badge ns">Nonstop</span>`;
  const via = (t.route || "").split("-").slice(1, -1).join(", ");
  return `<span class="badge">1 stop${via ? " · " + esc(via) : ""}</span>` + (t.st ? ` <span class="badge st">Self-transfer</span>` : "");
}

function dealCard(t, i) {
  const hit = t.p <= DATA.config.alert;
  return `<div class="card deal">
    <div class="rank">#${i + 1}</div>
    <div class="row"><div class="big">${inr(t.p)}</div>${hit ? '<span class="badge hit">Under target</span>' : ""}</div>
    <div class="small muted">all-in per head · fare ${inr(t.fare)}</div>
    <div class="route-line">${esc(airport(t.origin))} <span class="arrow">→</span> ${esc(t.destName || airport(t.dest))}</div>
    <div class="small t2">${esc(t.origin)} → ${esc(t.dest)} · ${fmtDay(t.depart)} → ${fmtDay(t.ret)} · ${t.n} nights</div>
    <div style="margin-top:8px">${typeBadge(t)}</div>
    <div class="meta">
      <div><b>Airline</b>${esc(t.air)}</div>
      <div><b>Flights (outbound)</b>${esc(t.flights)}</div>
      <div><b>Departs</b>${esc(t.time)} · ${dur(t.dur)}</div>
      <div><b>Route</b>${esc(t.route)}</div>
      <div style="grid-column:1/-1"><b>Cost breakdown</b>${esc(t.breakdown)}</div>
    </div>
    <a class="btn" href="${esc(t.url)}" target="_blank" rel="noopener">Open in Google Flights</a>
    <div class="tiny muted" style="margin-top:6px">Checked ${ago(t.checked)}</div>
  </div>`;
}

function renderHome() {
  const cfg = DATA.config;
  const seen = new Set();
  const top = DATA.top.filter(t => {
    const key = [t.origin, t.depart, t.route, t.flights].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
  const best = top[0];
  const gap = best ? best.p - cfg.target : null;
  const pct = best ? Math.min(100, Math.round(cfg.target / best.p * 100)) : 0;

  const cities = cfg.origins.map(o => {
    const b = DATA.best[o];
    return `<a class="card" href="${esc(b?.url || "#")}" target="_blank" rel="noopener">
      <div class="small muted">From ${esc(o)}</div>
      <div class="p num">${b ? inr(b.p) : "—"}</div>
      <div class="tiny t2">${b ? `${fmtDay(b.depart)} · ${b.n}n<br>${esc(b.route)}${b.st ? " · self-transfer" : ""}` : "not priced yet"}</div>
    </a>`;
  }).join("");

  const ns = DATA.bestNonstop;
  $("#view").innerHTML = `
    <div class="scene" aria-hidden="true">
      <div class="layer" data-depth="6"><svg viewBox="0 0 720 150" preserveAspectRatio="xMidYMax slice">
        <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb37a"/><stop offset=".55" stop-color="#ffd9b8"/><stop offset="1" stop-color="#fdeee2"/></linearGradient></defs>
        <rect width="720" height="150" fill="url(#sky)"/>
        <circle class="sun" cx="520" cy="62" r="34" fill="#d62828" opacity=".9"/>
        <g class="cloud" fill="#fff" opacity=".85"><ellipse cx="80" cy="40" rx="46" ry="11"/><ellipse cx="110" cy="33" rx="28" ry="10"/></g>
        <g class="cloud c2" fill="#fff"><ellipse cx="300" cy="24" rx="38" ry="9"/><ellipse cx="322" cy="18" rx="22" ry="8"/></g>
      </svg></div>
      <div class="layer" data-depth="14"><svg viewBox="0 0 720 150" preserveAspectRatio="xMidYMax slice">
        <path d="M150 150 L330 46 Q360 30 390 46 L590 150 Z" fill="#40618f"/>
        <path d="M300 64 L330 46 Q360 30 390 46 L420 64 L398 72 L380 62 L360 76 L342 62 L322 72 Z" fill="#fff"/>
        <path d="M0 150 L90 108 L180 130 L260 112 L380 140 L520 104 L620 126 L720 110 L720 150 Z" fill="#1c3f6e"/>
      </svg></div>
      <div class="layer" data-depth="22"><svg viewBox="0 0 720 150" preserveAspectRatio="xMidYMax slice">
        <g class="plane"><path d="M0 0 L18 -3 L24 -10 L28 -10 L25 -2 L34 -1 L38 -6 L41 -6 L39 0 L41 6 L38 6 L34 1 L25 2 L28 10 L24 10 L18 3 Z" fill="#0d366b"/></g>
      </svg></div>
    </div>
    <div class="hero-wrap"><div class="card hero">
      <div class="small t2">Target · round trip, all-in, per head</div>
      <div class="row between"><div class="big">${inr(cfg.target)}</div>
        <div style="text-align:right"><div class="small t2">Best right now</div><div style="font-weight:700;font-size:18px" class="count" data-to="${best ? best.p : ""}">${best ? inr(best.p) : "—"}</div></div></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="small t2" style="margin-top:8px">${gap == null ? "Waiting for first prices…" : gap <= 0 ? "🎉 Target hit!" : `${inr(gap)} above target · push alert at ≤ ${inr(cfg.alert)}`}</div>
    </div></div>

    <h2>Top 5 cheapest right now</h2>
    <div class="stack enter">${top.length ? top.map(dealCard).join("") : '<div class="card empty-state">No prices yet — the first search run is in progress.</div>'}</div>

    <h2>Best by departure city</h2>
    <div class="mini enter">${cities}</div>

    <h2>Best nonstop</h2>
    <div class="card">${ns ? `<div class="row between"><div><div style="font-weight:700;font-size:18px">${inr(ns.p)}</div>
      <div class="small t2">${esc(ns.origin)} · ${fmtDay(ns.depart)} → ${fmtDay(ns.ret)} · ${ns.n} nights</div></div>
      <a class="btn ghost" style="margin:0" href="${esc(ns.url)}" target="_blank" rel="noopener">Open</a></div>` : '<span class="muted">None found yet</span>'}</div>

    <h2>What's tracked</h2>
    <div class="card small t2">
      ${cfg.origins.join(" / ")} → ${cfg.dests.join(" / ")}<br>
      Round trip · ${cfg.nights.join(" & ")} nights · max ${cfg.maxStops} stop each way · ${cfg.selfTransfer ? "self-transfer included" : "no self-transfer"}<br>
      Every on-sale date re-priced every ~${cfg.recheckHours} h. Airlines open sales ~${cfg.horizonDays} days ahead (currently up to ${fmtDate(cfg.horizon)}).<br>
      Alerts: 🎯 ≤ ${inr(cfg.alert)} · 📉 drop ≥ ${cfg.dropPct}% and ≤ ${inr(cfg.dropCeiling)} · ✅ each full pass · 🗾 daily summary.
    </div>`;
}

// ---------- CALENDAR ----------
function seg(name, opts, cur) {
  return `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(cur) ? "on" : ""}">${l}</button>`).join("")}</div>`;
}

function monthSummary(y, m) {
  let min = null, off = 0, opens = null, total = 0;
  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const day = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const st = dayState(day);
    if (st.state === "blank") continue;
    total++;
    if (st.state === "ok" && (min == null || st.best.p < min)) min = st.best.p;
    if (st.state === "not_on_sale") {
      off++;
      const o = st.opts.map(x => x.opens).filter(Boolean).sort()[0];
      if (o && (!opens || o < opens)) opens = o;
    }
  }
  return { min, off, opens, total };
}

function renderCalendar() {
  const cfg = DATA.config;
  const y = Number(cfg.from.slice(0, 4));
  const ps = allPrices();
  const lo = ps[0] ?? 0, hi = ps[Math.max(0, Math.floor(ps.length * 0.9) - 1)] ?? lo + 1;
  const m = S.month;

  const chips = MONTHS.map((name, i) => {
    const sm = monthSummary(y, i);
    const v = sm.min != null ? inr(sm.min).replace("₹", "₹") : sm.off === sm.total && sm.opens ? "opens " + D(sm.opens).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : sm.off ? "partly on sale" : "—";
    return `<button data-m="${i}" class="${i === m ? "on" : ""}"><div class="m">${name}</div><div class="v">${esc(v)}</div></button>`;
  }).join("");

  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;   // Monday first
  let cells = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => `<div class="dow">${d}</div>`).join("");
  cells += `<div class="day blank"></div>`.repeat(lead);
  for (let d = 1; d <= days; d++) {
    const day = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const st = dayState(day);
    if (st.state === "ok") {
      const c = colorFor(st.best.p, lo, hi);
      const hit = st.best.p <= cfg.alert ? " hit" : "";
      cells += `<button class="day${hit}" data-day="${day}" style="--i:${d};background:${c.bg};color:${c.fg}"><span class="d">${d}</span><span class="p">${k(st.best.p)}</span></button>`;
    } else {
      const cls = { past: "past", not_on_sale: "off", queued: "queued", retry: "retry", none: "none", blank: "blank" }[st.state];
      const sym = { past: "", not_on_sale: "–", queued: "…", retry: "!", none: "✕", blank: "" }[st.state];
      cells += `<button class="day ${cls}" style="--i:${d}" data-day="${day}" ${st.state === "past" || st.state === "blank" ? "disabled" : ""}><span class="d">${d}</span><span class="p">${sym}</span></button>`;
    }
  }

  const sm = monthSummary(y, m);
  let note = "";
  if (sm.off === sm.total && sm.total) {
    note = `<div class="note">🔒 <b>${MONTHS[m]} ${y} isn't on sale yet.</b> Airlines open these dates around <b>${fmtDate(sm.opens)}</b>. The tracker starts pricing them automatically on that day.</div>`;
  } else if (sm.off) {
    note = `<div class="note">🔒 ${sm.off} date${sm.off > 1 ? "s" : ""} late in ${MONTHS[m]} aren't on sale yet (trips must return by ${fmtDate(cfg.horizon)}). They open from ${fmtDate(sm.opens)}.</div>`;
  } else if (sm.min != null) {
    note = `<div class="note">Cheapest in ${MONTHS[m]}: <b>${inr(sm.min)}</b> all-in. Tap a date for flights and links.</div>`;
  }

  const ramp = RAMP.map(c => `<span class="sw" style="background:${c};margin:0;border-radius:2px;width:9px"></span>`).join("");
  $("#view").innerHTML = `
    <div class="controls">
      ${seg("city", [["ALL", "Any city"], ...cfg.origins.map(o => [o, o])], S.city)}
      ${seg("nights", [["best", "Best"], ...cfg.nights.map(n => [n, n + " nights"])], S.nights)}
    </div>
    <div class="months" id="months">${chips}</div>
    <div class="mhead">
      <button class="icon-btn" data-step="-1" ${m === 0 ? "disabled" : ""}>‹</button>
      <div class="name">${MONTHS[m]} ${y}</div>
      <button class="icon-btn" data-step="1" ${m === 11 ? "disabled" : ""}>›</button>
    </div>
    ${note}
    <div class="cal ${S.slide || ""}">${cells}</div>
    <div class="legend">
      <span>All-in per head: ${inr(hi)}+<span class="ramp">${ramp}</span>${inr(lo)}</span>
      <span><span class="sw" style="outline:2.5px solid var(--accent);outline-offset:-2px"></span>≤ ${inr(cfg.alert)}</span>
      <span><span class="sw" style="background:repeating-linear-gradient(135deg,var(--empty) 0 3px,transparent 3px 6px)"></span>– not on sale yet</span>
      <span>… queued</span><span>! retrying</span><span>✕ no flights</span>
    </div>`;
  S.slide = "";
  const chip = $(`#months button[data-m="${m}"]`);
  if (chip) chip.parentElement.scrollTo({ left: chip.offsetLeft - chip.parentElement.clientWidth / 2 + chip.clientWidth / 2, behavior: "smooth" });
}

function openDay(day) {
  const st = dayState(day);
  const opts = (st.opts || []).slice().sort((a, b) => (a.p ?? 1e9) - (b.p ?? 1e9));
  const rows = opts.map(o => {
    const head = `<div class="row between"><div><b>${esc(o.origin)}</b> → Japan · ${o.n} nights</div>${o.p != null ? `<div style="font-weight:700">${inr(o.p)}</div>` : ""}</div>`;
    if (o.p == null) {
      const msg = { not_on_sale: `Not on sale yet — opens around ${fmtDate(o.opens)}`, queued: "Queued — will be priced in the next run", retry: "Last search failed — retrying soon", none: "No flights found with max 1 stop", past: "Date has passed" }[o.state] || o.state;
      return `<div class="card">${head}<div class="small t2" style="margin-top:4px">Return ${fmtDay(o.ret)} · ${esc(msg)}</div></div>`;
    }
    const change = o.prev ? Math.round((o.p - o.prev) / o.prev * 100) : null;
    return `<div class="card">${head}
      <div class="small t2" style="margin-top:4px">${fmtDay(day)} → ${fmtDay(o.ret)} · fare ${inr(o.fare)}${change ? ` · ${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% vs last check` : ""}</div>
      <div style="margin-top:6px">${esc(o.route)} · ${esc(o.air)} ${o.st ? '<span class="badge st">Self-transfer</span>' : ""}</div>
      ${o.ns ? `<div class="small t2" style="margin-top:4px">Cheapest nonstop: ${inr(o.ns)}</div>` : ""}
      <div class="tiny muted" style="margin-top:4px">Checked ${o.checked ? ago(o.checked) : "—"}</div>
      <a class="btn" href="${esc(o.url)}" target="_blank" rel="noopener">Open in Google Flights</a></div>`;
  }).join("");
  openSheet(`<div class="grab"></div><div style="font-weight:700;font-size:18px;margin:0 2px 10px">${fmtDay(day)} 2027</div><div class="stack">${rows || '<div class="muted">Nothing tracked for this date.</div>'}</div>`);
}

function openSheet(html) {
  const sh = $("#sheet");
  sh.innerHTML = html;
  sh.hidden = false; $("#sheetBg").hidden = false;
  sh.scrollTop = 0;
}
function closeSheet() { $("#sheet").hidden = true; $("#sheetBg").hidden = true; }

// ---------- HISTORY ----------
function lineChart(series, target) {
  const W = 680, H = 260, L = 44, R = 46, T = 14, B = 26;
  const days = [...new Set(series.flatMap(s => s.points.map(p => p.day)))].sort();
  if (!days.length) return `<div class="empty-state">History builds up as the tracker runs each day.</div>`;
  const vals = series.flatMap(s => s.points.map(p => p.p)).concat([target]);
  const lo = Math.floor(Math.min(...vals) / 5000) * 5000, hi = Math.ceil(Math.max(...vals) / 5000) * 5000;
  const x = i => days.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (days.length - 1);
  const yv = v => T + (hi - v) * (H - T - B) / Math.max(hi - lo, 1);
  let g = "";
  for (let v = lo; v <= hi; v += Math.max(5000, Math.round((hi - lo) / 4 / 5000) * 5000)) {
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yv(v)}" y2="${yv(v)}"/><text x="${L - 6}" y="${yv(v) + 4}" text-anchor="end">${k(v)}</text>`;
  }
  g += `<line class="target" x1="${L}" x2="${W - R}" y1="${yv(target)}" y2="${yv(target)}"/><text x="${W - R + 4}" y="${yv(target) + 4}" style="fill:var(--accent)">target</text>`;
  const ticks = days.length <= 6 ? days.map((d, i) => i) : [0, Math.floor(days.length / 2), days.length - 1];
  for (const i of ticks) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${D(days[i]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</text>`;
  series.forEach((s, si) => {
    const pts = s.points.map(p => [x(days.indexOf(p.day)), yv(p.p)]);
    if (pts.length > 1) g += `<polyline class="series" stroke="var(${SERIES[si]})" points="${pts.map(p => p.join(",")).join(" ")}"/>`;
    for (const [px, py] of pts) g += `<circle cx="${px}" cy="${py}" r="4" fill="var(${SERIES[si]})" stroke="var(--surface)" stroke-width="2"/>`;
    const last = pts[pts.length - 1];
    if (last) g += `<text class="lbl" x="${last[0] + 8}" y="${last[1] + 4}">${esc(s.name)}</text>`;
  });
  g += `<line class="xhair" id="xh" y1="${T}" y2="${H - B}" visibility="hidden"/><rect id="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>`;
  lineChart.meta = { days, series, x, L, R, W };
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily best all-in price per departure city">${g}</svg>`;
}

function bindChart() {
  const svg = $(".chart"), hit = $("#hit"), tip = $("#tip");
  if (!svg || !hit) return;
  const m = lineChart.meta;
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (m.W / r.width);
    let best = 0, bd = 1e9;
    m.days.forEach((d, i) => { const dd = Math.abs(m.x(i) - px); if (dd < bd) { bd = dd; best = i; } });
    const day = m.days[best];
    const xh = $("#xh"); xh.setAttribute("x1", m.x(best)); xh.setAttribute("x2", m.x(best)); xh.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${fmtDate(day)}</b><br>` + m.series.map((s, si) => {
      const p = s.points.find(q => q.day === day);
      return `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(${SERIES[si]});margin-right:5px"></span>${esc(s.name)}: <b>${p ? inr(p.p) : "—"}</b>${p ? ` <span class="muted">(${fmtDay(p.depart)})</span>` : ""}`;
    }).join("<br>");
    tip.hidden = false;
    tip.style.left = Math.min(ev.clientX + 12, innerWidth - 250) + "px";
    tip.style.top = (ev.clientY - 70) + "px";
  };
  const leave = () => { tip.hidden = true; const xh = $("#xh"); if (xh) xh.setAttribute("visibility", "hidden"); };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", leave);
}

function renderHistory() {
  const cfg = DATA.config;
  const series = cfg.origins.map(o => ({ name: o, points: DATA.history.filter(h => h.origin === o) }));
  const y = Number(cfg.from.slice(0, 4));
  // cheapest per month per city
  const rows = MONTHS.map((name, mi) => {
    const cells = cfg.origins.map(o => {
      let min = null;
      for (const [day, opts] of Object.entries(DATA.calendar[o])) {
        if (Number(day.slice(5, 7)) !== mi + 1 || Number(day.slice(0, 4)) !== y) continue;
        for (const x of opts) if (x.p != null && (min == null || x.p < min)) min = x.p;
      }
      return `<td class="r">${min != null ? inr(min) : '<span class="muted">—</span>'}</td>`;
    }).join("");
    return `<tr><td>${name}</td>${cells}</tr>`;
  }).join("");

  const changes = [];
  for (const o of cfg.origins) for (const [day, opts] of Object.entries(DATA.calendar[o]))
    for (const x of opts) if (x.p != null && x.prev && x.prev !== x.p) changes.push({ o, day, ...x, d: x.p - x.prev });
  changes.sort((a, b) => a.d - b.d);
  const drops = changes.filter(c => c.d < 0).slice(0, 8);
  const ups = changes.filter(c => c.d > 0).sort((a, b) => b.d - a.d).slice(0, 5);
  const chRow = c => `<div class="log"><div class="ic ${c.d < 0 ? "ok" : "error"}">${c.d < 0 ? "▼" : "▲"}</div><div class="body">
      <div><b>${esc(c.o)}</b> ${fmtDay(c.day)} · ${c.n}n · ${inr(c.prev)} → <b>${inr(c.p)}</b></div>
      <div class="small t2">${c.d < 0 ? "−" : "+"}${inr(Math.abs(c.d))} (${Math.round(c.d / c.prev * 100)}%) · ${esc(c.route)}</div></div></div>`;

  $("#view").innerHTML = `
    <h2>Best all-in price, by day tracked</h2>
    <div class="card">${lineChart(series, cfg.target)}
      <div class="key">${cfg.origins.map((o, i) => `<span><i style="background:var(${SERIES[i]})"></i>${o}</span>`).join("")}<span><i style="background:var(--accent)"></i>Target</span></div></div>
    <h2>Cheapest by travel month</h2>
    <div class="card tablewrap"><table><tr><th>Month</th>${cfg.origins.map(o => `<th class="r">${o}</th>`).join("")}</tr>${rows}</table></div>
    <h2>Biggest drops since last check</h2>
    <div class="card">${drops.length ? drops.map(chRow).join("") : '<div class="muted small">No drops yet. Each date is compared with its previous check.</div>'}</div>
    <h2>Biggest rises</h2>
    <div class="card">${ups.length ? ups.map(chRow).join("") : '<div class="muted small">No rises yet.</div>'}</div>`;
  bindChart();
}

// ---------- LOGS ----------
function renderLogs() {
  const kinds = [["searches", "Searches"], ["runs", "Runs"], ["notifications", "Notifications"]];
  let body = "";
  if (S.logKind === "searches") {
    const f = S.logFilter;
    const list = DATA.searches.filter(s => f === "all" || s.status === f);
    const counts = st => DATA.searches.filter(s => s.status === st).length;
    body = `<div class="chips">${[["all", `All (${DATA.searches.length})`], ["ok", `Priced (${counts("ok")})`], ["none", `No flights (${counts("none")})`], ["error", `Errors (${counts("error")})`]]
      .map(([v, l]) => `<button data-filter="${v}" class="${f === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="card">${list.length ? list.map(s => `<div class="log">
        <div class="ic ${s.status}">${{ ok: "✓", none: "–", error: "!" }[s.status] || "?"}</div>
        <div class="body"><div class="row between"><b>${esc(s.origin)} · ${fmtDay(s.depart)} · ${s.n}n</b><span class="when">${fmtTime(s.ts)}</span></div>
        <div class="small t2">${s.status === "ok" ? `${inr(s.p)} · ${esc(s.route)} · ${esc(s.air)} · ${s.options} options` : esc(s.note || s.status)}</div></div></div>`).join("")
      : '<div class="muted small">Nothing here yet — logs appear as searches run.</div>'}</div>
      <div class="tiny muted" style="margin:8px 4px">Latest ${DATA.searches.length} searches. Full log stays on the PC (logs/tracker.log, logs/prices.csv).</div>`;
  } else if (S.logKind === "runs") {
    body = `<div class="card">${DATA.runs.length ? DATA.runs.map(r => {
      const mins = r.finished ? Math.round((D(r.finished) - D(r.started)) / 60000) : null;
      const ic = r.failed > r.queries / 2 ? "error" : "ok";
      return `<div class="log"><div class="ic ${ic}">${ic === "ok" ? "✓" : "!"}</div><div class="body">
        <div class="row between"><b>${fmtTime(r.started)}</b><span class="when">${mins != null ? mins + " min" : ""}</span></div>
        <div class="small t2">${r.queries} searches · ${r.ok} priced · ${r.empty} no flights · ${r.failed} failed${r.note ? " · " + esc(r.note) : ""}</div></div></div>`;
    }).join("") : '<div class="muted small">No runs recorded yet.</div>'}</div>`;
  } else {
    body = `<div class="card">${DATA.notifications.length ? DATA.notifications.map(n => `<div class="log">
        <div class="ic ${n.ok ? "ok" : "error"}">${n.ok ? "🔔" : "!"}</div>
        <div class="body"><div class="row between"><b>${esc(n.title)}</b><span class="when">${fmtTime(n.ts)}</span></div>
        <pre>${esc(n.body)}</pre>${n.url ? `<a class="small" href="${esc(n.url)}" target="_blank" rel="noopener">Open flight ↗</a>` : ""}</div></div>`).join("")
      : '<div class="muted small">No notifications recorded yet.</div>'}</div>
      <div class="tiny muted" style="margin:8px 4px">Push notifications arrive through the ntfy app on your phone.</div>`;
  }
  $("#view").innerHTML = `<div class="controls">${seg("logKind", kinds, S.logKind)}</div>${body}`;
}

// ---------- routing & events ----------
function render(animate) {
  if (!DATA) return;
  const go = () => {
    renderStatus();
    ({ home: renderHome, calendar: renderCalendar, history: renderHistory, logs: renderLogs })[S.tab]();
    afterRender();
  };
  if (animate && document.startViewTransition) document.startViewTransition(go); else go();
}

function afterRender() {
  // count-up on the headline price
  document.querySelectorAll(".count[data-to]").forEach(el => {
    const to = Number(el.dataset.to); if (!to) return;
    const t0 = performance.now(), from = to * 1.25;
    const step = now => {
      const t = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - t, 3);
      el.textContent = inr(Math.round(from + (to - from) * e));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// 3D tilt + parallax: follows the phone's motion (or the mouse on desktop)
function tilt(x, y) {   // x, y in -1..1
  const hero = $(".hero");
  if (hero) {
    hero.style.setProperty("--rx", (-y * 6).toFixed(2) + "deg");
    hero.style.setProperty("--ry", (x * 8).toFixed(2) + "deg");
    hero.style.setProperty("--gx", (50 + x * 40) + "%");
    hero.style.setProperty("--gy", (y * 40) + "%");
  }
  document.querySelectorAll(".scene .layer").forEach(l => {
    const d = Number(l.dataset.depth);
    l.style.transform = `translate3d(${(-x * d).toFixed(1)}px, ${(-y * d * 0.4).toFixed(1)}px, 0)`;
  });
}
window.addEventListener("pointermove", e => {
  if (e.pointerType === "mouse") tilt(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1);
});
window.addEventListener("deviceorientation", e => {
  if (e.gamma == null) return;
  tilt(Math.max(-1, Math.min(1, e.gamma / 25)), Math.max(-1, Math.min(1, (e.beta - 45) / 25)));
});
// iOS asks permission for motion; request it on the first tap
document.addEventListener("click", () => {
  if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission && !tilt.asked) {
    tilt.asked = true; DeviceOrientationEvent.requestPermission().catch(() => {});
  }
}, { once: false });

document.addEventListener("click", ev => {
  const t = ev.target.closest("button, .sheet-bg");
  if (!t) return;
  if (t.matches(".tabs button")) {
    S.tab = t.dataset.tab;
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b === t));
    $("#tip").hidden = true;
    render(true); window.scrollTo({ top: 0, behavior: "smooth" }); return;
  }
  if (t.id === "refresh") return load(true);
  if (t.id === "sheetBg") return closeSheet();
  const segEl = t.closest("[data-seg]");
  if (segEl) {
    const key = segEl.dataset.seg;
    S[key] = t.dataset.v;
    if (key === "logKind") S.logFilter = "all";
    return render();
  }
  if (t.dataset.m != null) { const n = Number(t.dataset.m); S.slide = n > S.month ? "slide-l" : n < S.month ? "slide-r" : ""; S.month = n; return render(); }
  if (t.dataset.step) { const st = Number(t.dataset.step); S.slide = st > 0 ? "slide-l" : "slide-r"; S.month = Math.min(11, Math.max(0, S.month + st)); return render(); }
  if (t.dataset.day && !t.disabled) return openDay(t.dataset.day);
  if (t.dataset.filter) { S.logFilter = t.dataset.filter; return render(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

// swipe between months on the calendar
let sx = null;
document.addEventListener("touchstart", e => { if (S.tab === "calendar" && e.target.closest(".cal")) sx = e.touches[0].clientX; }, { passive: true });
document.addEventListener("touchend", e => {
  if (sx == null) return;
  const dx = e.changedTouches[0].clientX - sx; sx = null;
  if (Math.abs(dx) > 60) { S.slide = dx < 0 ? "slide-l" : "slide-r"; S.month = Math.min(11, Math.max(0, S.month + (dx < 0 ? 1 : -1))); render(); }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
load();
setInterval(() => load(false), 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
