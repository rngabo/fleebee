// Overview "Control center": health of every component, the timers behind them, and the collapsible Recent SMS.
(() => {
  const runtimeConfig = window.FLEEBEE_CONFIG || {};
  const API_BASE = String(runtimeConfig.apiBaseUrl || window.location.origin).replace(/\/$/, "");
  const $ = (id) => document.getElementById(id);
  if (!$("controlCenter")) return;

  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const LABELS = { ok: "OK", warn: "Check", down: "Down", off: "Not set up" };

  function card(service) {
    return `
      <article class="cc-card cc-${escapeHtml(service.state)}">
        <header class="cc-card-head">
          <span class="cc-dot" aria-hidden="true"></span>
          <h3>${escapeHtml(service.title)}</h3>
          <span class="cc-state">${LABELS[service.state] || escapeHtml(service.state)}</span>
        </header>
        <p class="cc-headline">${escapeHtml(service.headline)}</p>
        <dl class="cc-details">${(service.details || []).map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("")}</dl>
        ${service.link ? `<a class="cc-link" href="${escapeHtml(service.link.href)}">${escapeHtml(service.link.label)} →</a>` : ""}
      </article>`;
  }

  function render(data) {
    const { ok, warn, down } = data.summary;
    const attention = data.services.filter((service) => service.state === "warn" || service.state === "down").map((service) => service.title);
    const summary = $("ccSummary");
    summary.textContent = attention.length
      ? `${attention.length} need${attention.length === 1 ? "s" : ""} attention: ${attention.join(", ")}.`
      : `All systems normal (${ok} running${data.summary.off ? `, ${data.summary.off} not set up` : ""}).`;
    summary.className = `mini-note cc-summary ${down ? "cc-bad" : warn ? "cc-warn" : "cc-good"}`;
    $("ccServices").innerHTML = data.services.map(card).join("");
    $("ccTimersBody").innerHTML = data.timers.map((timer) => `
      <tr>
        <td><span class="table-cell-strong">${escapeHtml(timer.name)}</span><span class="mini-note block-note">${escapeHtml(timer.does)}</span></td>
        <td>${escapeHtml(timer.every)}</td>
        <td>${escapeHtml(timer.last)}</td>
        <td>${escapeHtml(timer.next)}</td>
        <td><span class="cc-pill cc-${escapeHtml(timer.state)}">${LABELS[timer.state] || ""}</span></td>
      </tr>`).join("");
    $("ccUpdated").textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString("en-GB")}`;
  }

  async function load() {
    $("ccRefreshButton").disabled = true;
    try {
      const response = await fetch(`${API_BASE}/api/system/overview`, { credentials: "same-origin" });
      if (response.status === 401) return;                      // the main script already sends the user to the login page
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch (error) {
      $("ccSummary").textContent = `Could not read the system status (${error.message}).`;
      $("ccSummary").className = "mini-note cc-summary cc-bad";
    } finally {
      $("ccRefreshButton").disabled = false;
    }
  }

  $("ccRefreshButton").addEventListener("click", load);
  setInterval(() => { if (!document.hidden) load(); }, 30000);
  load();

  // Recent SMS stays one click away instead of taking space on the page.
  const toggle = $("recentToggleButton");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Hide recent SMS" : "Show recent SMS";
      $("recentBody").classList.toggle("hidden", !open);
    });
  }
})();
