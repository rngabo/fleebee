// Analysis page: one payment-habit chart set per member, chosen from a dropdown.
// Loaded before data-pages.js, which fetches /api/data/analysis and calls window.renderAnalysis(payload).
(function () {
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const PAID = "#1d55c4";      // series: what the member paid
  const DUE = "#6b7280";       // reference: what was due (neutral, dashed)
  const INK = "#1f2937";
  const MUTED = "#6b7280";
  const GRID = "#e5e7eb";
  const rwf = (value) => `RWF ${(Math.round(Number(value)) || 0).toLocaleString("en-US")}`;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const day = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
  const monthText = (key) => new Date(`${key}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  const dayNumber = (iso) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000;

  let members = [];
  let selectedId = "";

  function monthKeys(from, to) {
    const keys = [];
    let [y, m] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return keys;
  }

  // Everything the charts and figures need for one member.
  function analyse(member) {
    const payments = member.payments;
    const today = new Date().toISOString().slice(0, 10);
    const firstPayment = payments[0]?.date;
    const start = (member.startDate || firstPayment || today).slice(0, 10);
    let last = today.slice(0, 7);
    if (member.durationMonths) {
      const end = monthKeys(start.slice(0, 7), "9999-12").slice(0, member.durationMonths).pop();
      if (end < last) last = end;
    }
    const keys = monthKeys(start.slice(0, 7), last);
    const paidBy = new Map(keys.map((key) => [key, 0]));
    for (const payment of payments) {
      const key = payment.date.slice(0, 7);
      if (paidBy.has(key)) paidBy.set(key, paidBy.get(key) + payment.amountRwf);
    }
    const due = Number(member.monthlyDueRwf) || (member.weeklyDueRwf ? Math.round(member.weeklyDueRwf * 52 / 12) : 0);
    let paidTotal = 0;
    const rows = keys.map((key, index) => {
      paidTotal += paidBy.get(key);
      return { key, paid: paidBy.get(key), due, cumulativePaid: paidTotal, cumulativeDue: due * (index + 1) };
    });
    const gaps = [];
    for (let i = 1; i < payments.length; i += 1) gaps.push(dayNumber(payments[i].date) - dayNumber(payments[i - 1].date));
    const sinceLast = payments.length ? Math.max(0, Math.round(Date.now() / 86400000 - dayNumber(payments.at(-1).date))) : null;
    return {
      start, rows, due, paidTotal,
      dueToDate: rows.length ? rows.at(-1).cumulativeDue : 0,
      fullMonths: due ? rows.filter((row) => row.paid >= row.due).length : 0,
      emptyMonths: rows.filter((row) => row.paid === 0).length,
      averageGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
      longestGap: gaps.length ? Math.max(...gaps) : null,
      count: payments.length, lastDate: payments.at(-1)?.date || null, sinceLast
    };
  }

  function el(name, attrs = {}, text) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const tooltip = () => {
    let tip = $("analysisTip");
    if (!tip) { tip = document.createElement("div"); tip.id = "analysisTip"; tip.className = "chart-tip hidden"; document.body.appendChild(tip); }
    return tip;
  };
  function bindTip(target, html) {
    const tip = tooltip();
    target.addEventListener("mousemove", (event) => {
      tip.innerHTML = html; tip.classList.remove("hidden");
      tip.style.left = `${event.clientX + 14}px`; tip.style.top = `${event.clientY + 14}px`;
    });
    target.addEventListener("mouseleave", () => tip.classList.add("hidden"));
  }

  // Shared frame: width/height, y scale with "nice" ticks, x labels thinned to fit.
  function frame(host, rows, maxValue, label) {
    const width = Math.max(host.clientWidth || 640, 360);
    const height = 280;
    const pad = { left: 64, right: 16, top: 14, bottom: 34 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const step = 10 ** Math.floor(Math.log10(Math.max(maxValue, 1) / 4));
    const unit = [1, 2, 2.5, 5, 10].map((k) => k * step).find((v) => maxValue / v <= 5) || step * 10;
    const top = Math.max(unit, Math.ceil(maxValue / unit) * unit);
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height, role: "img", "aria-label": label });
    const y = (value) => pad.top + plotH - (value / top) * plotH;
    for (let value = 0; value <= top; value += unit) {
      svg.appendChild(el("line", { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), stroke: GRID, "stroke-width": 1 }));
      svg.appendChild(el("text", { x: pad.left - 8, y: y(value) + 4, "text-anchor": "end", "font-size": 11, fill: MUTED }, value >= 1000 ? `${(value / 1000).toLocaleString("en-US")}k` : String(value)));
    }
    const every = Math.ceil(rows.length / Math.max(2, Math.floor(plotW / 56)));
    const slot = plotW / Math.max(rows.length, 1);
    const x = (index) => pad.left + slot * index + slot / 2;
    rows.forEach((row, index) => {
      if (index % every === 0) svg.appendChild(el("text", { x: x(index), y: height - 10, "text-anchor": "middle", "font-size": 11, fill: MUTED }, monthText(row.key)));
    });
    return { svg, x, y, slot, pad, plotH, width, height };
  }

  // Chart 1: paid each month (bars) against the monthly amount due (dashed line).
  function monthlyChart(host, rows, due) {
    host.innerHTML = "";
    const f = frame(host, rows, Math.max(due, ...rows.map((row) => row.paid)), "Amount paid each month");
    const barW = Math.max(4, Math.min(28, f.slot * 0.62));
    rows.forEach((row, index) => {
      const h = f.y(0) - f.y(row.paid);
      if (h > 0) f.svg.appendChild(el("path", { d: `M${f.x(index) - barW / 2},${f.y(0)} V${f.y(row.paid) + 4} a4,4 0 0 1 4,-4 h${barW - 8} a4,4 0 0 1 4,4 V${f.y(0)} Z`, fill: PAID }));
      const hit = el("rect", { x: f.x(index) - f.slot / 2, y: f.pad.top, width: f.slot, height: f.plotH, fill: "transparent" });
      bindTip(hit, `<strong>${monthText(row.key)}</strong><br>Paid ${rwf(row.paid)}${due ? `<br>Due ${rwf(due)}` : ""}`);
      f.svg.appendChild(hit);
    });
    if (due) {
      f.svg.appendChild(el("line", { x1: f.pad.left, x2: f.width - f.pad.right, y1: f.y(due), y2: f.y(due), stroke: DUE, "stroke-width": 2, "stroke-dasharray": "6 4" }));
      f.svg.appendChild(el("text", { x: f.width - f.pad.right, y: f.y(due) - 6, "text-anchor": "end", "font-size": 11, fill: INK }, `Due ${rwf(due)} a month`));
    }
    host.appendChild(f.svg);
  }

  // Chart 2: running total paid against running total due; the gap between them is the arrears.
  function cumulativeChart(host, rows) {
    host.innerHTML = "";
    const f = frame(host, rows, Math.max(1, ...rows.map((row) => Math.max(row.cumulativePaid, row.cumulativeDue))), "Total paid against total due");
    const line = (key, color, dash) => {
      const d = rows.map((row, index) => `${index ? "L" : "M"}${f.x(index)},${f.y(row[key])}`).join(" ");
      f.svg.appendChild(el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", ...(dash ? { "stroke-dasharray": "6 4" } : {}) }));
    };
    if (rows.some((row) => row.cumulativeDue)) line("cumulativeDue", DUE, true);
    line("cumulativePaid", PAID, false);
    const lastIndex = rows.length - 1;
    const lastRow = rows[lastIndex];
    f.svg.appendChild(el("circle", { cx: f.x(lastIndex), cy: f.y(lastRow.cumulativePaid), r: 4, fill: PAID, stroke: "#fff", "stroke-width": 2 }));
    rows.forEach((row, index) => {
      const hit = el("rect", { x: f.x(index) - f.slot / 2, y: f.pad.top, width: f.slot, height: f.plotH, fill: "transparent" });
      const balance = row.cumulativeDue - row.cumulativePaid;
      bindTip(hit, `<strong>${monthText(row.key)}</strong><br>Total paid ${rwf(row.cumulativePaid)}${row.cumulativeDue ? `<br>Total due ${rwf(row.cumulativeDue)}<br>${balance > 0 ? `Behind by ${rwf(balance)}` : `Ahead by ${rwf(-balance)}`}` : ""}`);
      f.svg.appendChild(hit);
    });
    host.appendChild(f.svg);
  }

  function tile(label, value, note = "") {
    return `<article class="metric-card"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<small class="mini-note">${esc(note)}</small>` : ""}</article>`;
  }

  function showMember() {
    const member = members.find((item) => item.id === selectedId);
    const body = $("analysisBody");
    const badge = $("analysisStatus");
    const inactiveMember = Boolean(member) && String(member.status).toLowerCase() !== "active";
    badge.classList.toggle("hidden", !inactiveMember);
    badge.textContent = inactiveMember ? `Inactive${member.status && member.status.toLowerCase() !== "inactive" ? ` (${member.status})` : ""}` : "";
    if (!member) { body.classList.add("hidden"); return; }
    body.classList.remove("hidden");
    const a = analyse(member);
    const balance = a.dueToDate - a.paidTotal;
    $("analysisTiles").innerHTML = [
      tile("Total paid", rwf(a.paidTotal), `${a.count} payment${a.count === 1 ? "" : "s"}`),
      a.due ? tile("Due to date", rwf(a.dueToDate), `${rwf(a.due)} × ${a.rows.length} month${a.rows.length === 1 ? "" : "s"} started`) : tile("Due to date", "—", "No monthly amount in the sheet"),
      a.due ? tile(balance > 0 ? "Behind by" : "Ahead by", rwf(Math.abs(balance)), balance > 0 ? "Due minus paid" : "Paid more than due") : tile("Balance", "—"),
      a.due ? tile("Months paid in full", `${a.fullMonths} of ${a.rows.length}`, `${a.emptyMonths} month${a.emptyMonths === 1 ? "" : "s"} with no payment`) : tile("Months with no payment", String(a.emptyMonths)),
      tile("Typical gap between payments", a.averageGap === null ? "—" : `${a.averageGap.toFixed(1)} days`, a.longestGap === null ? "" : `Longest gap ${Math.round(a.longestGap)} days`),
      tile("Last payment", a.lastDate ? day(a.lastDate) : "—", a.sinceLast === null ? "No payments yet" : `${a.sinceLast} day${a.sinceLast === 1 ? "" : "s"} ago`)
    ].join("");
    const empty = !member.payments.length;
    $("analysisCharts").classList.toggle("hidden", empty);
    $("analysisEmpty").classList.toggle("hidden", !empty);
    if (!empty) {
      monthlyChart($("monthlyChart"), a.rows, a.due);
      cumulativeChart($("cumulativeChart"), a.rows);
    }
  }

  window.renderAnalysis = function (payload) {
    members = payload.members || [];
    const select = $("analysisMember");
    if (!members.length) { select.innerHTML = '<option value="">No members synchronized yet</option>'; selectedId = ""; showMember(); return; }
    const wanted = selectedId || new URLSearchParams(window.location.search).get("member") || "";
    if (!members.some((item) => item.id === wanted)) selectedId = "";
    else selectedId = wanted;
    const isActive = (item) => String(item.status).toLowerCase() === "active";
    const option = (item) => `<option value="${esc(item.id)}"${item.id === selectedId ? " selected" : ""}>${esc(item.name)}${item.plate ? ` — ${esc(item.plate)}` : ""}${isActive(item) ? "" : " (inactive)"}</option>`;
    const inactive = members.filter((item) => !isActive(item));
    select.innerHTML = `<option value="">Select a member…</option><optgroup label="Active">${members.filter(isActive).map(option).join("")}</optgroup>${inactive.length ? `<optgroup label="Inactive">${inactive.map(option).join("")}</optgroup>` : ""}`;
    showMember();
  };

  document.addEventListener("DOMContentLoaded", () => {
    $("analysisMember").addEventListener("change", (event) => { selectedId = event.target.value; showMember(); });
    let timer;
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(showMember, 150); });
  });
})();
