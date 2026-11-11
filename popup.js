// ===== Site Leak Radar — popup.js =====

// Extension pages block inline <script> via CSP, so the standalone-mode body
// class has to be set here rather than with an inline snippet in popup.html.
if (new URLSearchParams(window.location.search).get("standalone") === "1") {
  document.body.classList.add("standalone");
}

let currentTabId = null;
let currentOrigin = null;
let currentDomain = null;
let discoveredScriptUrls = [];

// ---- Session Log / Steps-to-Reproduce ----
// Every meaningful action (header set, scan run, request sent, sweep run,
// resolver run, footprint link opened) gets timestamped here. The point:
// this tool should feel like a procedure someone else could rerun and land
// on the same result, not just a one-off scan — this log is the record of
// exactly what was done, in order, with exact URLs/payloads/headers, ready
// to paste into a report's "Steps to Reproduce" field.
let sessionLog = [];
const stepDone = { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false };

function logEvent(step, text) {
  sessionLog.push({ time: new Date(), step, text });
  stepDone[step] = true;
  renderSessionLog();
  markStepUI(step);
}

function markStepUI(step) {
  const dot = document.querySelector(`.step-dot[data-step="${step}"]`);
  if (dot) dot.classList.add("done");
  const badge = document.getElementById(`badge-${step}`);
  if (badge) badge.classList.add("done");
}

function renderSessionLog() {
  const container = document.getElementById("session-log");
  if (sessionLog.length === 0) {
    container.innerHTML = '<div class="log-empty">No actions logged yet this session.</div>';
    return;
  }
  container.innerHTML = "";
  sessionLog.forEach((entry) => {
    const div = document.createElement("div");
    div.className = "log-entry";
    div.innerHTML = `<span class="log-time">${entry.time.toLocaleTimeString()}</span><span class="log-step">STEP ${entry.step}</span>${escapeHtml(entry.text)}`;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

async function buildReproText() {
  const { customHeaders } = await chrome.storage.local.get(["customHeaders"]);
  const activeHeaders = (customHeaders || []).filter((h) => h.active && h.name && h.value);
  const headerLine =
    activeHeaders.length > 0
      ? `Attribution header used throughout: ${activeHeaders.map((h) => `${h.name}: ${h.value}`).join(", ")}`
      : "No attribution header was set during this session.";

  const header = `Steps to Reproduce — ${currentDomain || "(no target)"} — ${new Date().toLocaleString()}\n\n${headerLine}\n`;

  if (sessionLog.length === 0) {
    return header + "\n(No actions logged yet.)";
  }

  const steps = sessionLog
    .map((entry, idx) => `${idx + 1}. [${entry.time.toLocaleTimeString()}] ${entry.text}`)
    .join("\n");

  return header + "\n" + steps;
}

document.getElementById("btn-copy-repro").addEventListener("click", async () => {
  const text = await buildReproText();
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("btn-copy-repro");
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = original), 1500);
  });
});

document.getElementById("btn-clear-log").addEventListener("click", () => {
  sessionLog = [];
  renderSessionLog();
});

// ---- Status bar ----
function setTargetPill(text) {
  const el = document.getElementById("status-target-pill");
  if (el) el.textContent = text;
}

async function refreshHeaderPill() {
  const { customHeaders } = await chrome.storage.local.get(["customHeaders"]);
  const activeHeaders = (customHeaders || []).filter((h) => h.active && h.name && h.value);
  const pill = document.getElementById("status-header-pill");
  if (!pill) return;
  if (activeHeaders.length > 0) {
    pill.textContent = activeHeaders.length === 1 ? activeHeaders[0].name.toUpperCase() + " ON" : `${activeHeaders.length} HEADERS ON`;
    pill.className = "on";
  } else {
    pill.textContent = "HEADER OFF";
    pill.className = "off";
  }
}

function extractUrlFromSource(source) {
  const m = (source || "").match(/https?:\/\/[^\s)]+/);
  return m ? m[0] : null;
}

function renderFindings(containerEl, findings, emptyMessage) {
  if (!findings || findings.length === 0) {
    containerEl.innerHTML = `<div class="no-leaks">${emptyMessage}</div>`;
    return;
  }
  containerEl.innerHTML = "";
  findings.forEach((f, idx) => {
    const div = document.createElement("div");
    div.className = `finding sev-${f.severity}`;
    const sourceUrl = extractUrlFromSource(f.source);
    div.innerHTML = `
      <div>
        <span class="finding-type">${escapeHtml(f.type)}</span>
        <span class="finding-sev sev-${f.severity}">${f.severity}</span>
        ${f.crossOrigin ? '<span class="finding-badge">CROSS-ORIGIN</span>' : ""}
      </div>
      <div class="finding-source">Source: ${escapeHtml(f.source)}</div>
      <div class="finding-value">${escapeHtml(f.value)}</div>
      <div class="finding-context">${escapeHtml(f.context)}</div>
      ${f.verifyNote ? `<div class="finding-verify">${escapeHtml(f.verifyNote)}</div>` : ""}
      ${f.aiNote ? `<div class="finding-ai">${escapeHtml(f.aiNote)}</div>` : ""}
      <button class="copy-btn" data-idx="${idx}">Copy evidence</button>
      ${sourceUrl ? `<button class="repeater-send-btn" data-url="${escapeHtml(sourceUrl)}">↗ Send URL to Repeater</button>` : ""}
    `;
    containerEl.appendChild(div);

    const copyBtn = div.querySelector(".copy-btn");
    copyBtn.addEventListener("click", () => {
      const evidenceText =
        `Finding: ${f.type}\n` +
        `Severity: ${f.severity}\n` +
        `Source: ${f.source}\n` +
        `Value: ${f.value}\n` +
        `Context: ${f.context}` +
        (f.crossOrigin ? `\nNOTE: CROSS-ORIGIN — verify ownership before reporting.` : "") +
        (f.verifyNote ? `\nVerify: ${f.verifyNote}` : "");
      navigator.clipboard.writeText(evidenceText).then(() => {
        copyBtn.textContent = "Copied!";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = "Copy evidence";
          copyBtn.classList.remove("copied");
        }, 1500);
      });
    });

    const repeaterBtn = div.querySelector(".repeater-send-btn");
    if (repeaterBtn) {
      repeaterBtn.addEventListener("click", () => {
        document.getElementById("lab-url").value = repeaterBtn.dataset.url;
        document.getElementById("request-lab").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- GitHub dork generation ----
// A bare "domain.com" code search is mostly noise (donate buttons, READMEs).
// Build targeted dorks instead: org-scoped secret hunts (if an org is given),
// plus domain + secret-shaped keyword/filename combinations.
function buildDorks(domain, org) {
  const dorks = [];

  if (org) {
    dorks.push({
      label: `Org "${org}": secret keywords`,
      query: `org:${org} ("api_key" OR "apikey" OR "secret" OR "password" OR "access_token" OR "private_key")`,
    });
    dorks.push({
      label: `Org "${org}": .env files`,
      query: `org:${org} extension:env`,
    });
    dorks.push({
      label: `Org "${org}": config/credentials files`,
      query: `org:${org} (filename:application.properties OR filename:config.json OR filename:settings.py OR filename:docker-compose.yml OR filename:credentials.json)`,
    });
  }

  dorks.push({
    label: `"${domain}" + secret keywords`,
    query: `"${domain}" ("client_secret" OR "api_key" OR "Authorization: Bearer" OR "private_key" OR "access_token")`,
  });
  dorks.push({
    label: `"${domain}" + .env files`,
    query: `"${domain}" extension:env`,
  });
  dorks.push({
    label: `"${domain}" + config/credentials files`,
    query: `"${domain}" (filename:config.json OR filename:application.properties OR filename:settings.py OR filename:docker-compose.yml)`,
  });
  dorks.push({
    label: `Internal hostname guess`,
    query: `"internal.${domain}"`,
  });

  return dorks;
}

function renderDorks(domain, org) {
  const container = document.getElementById("github-dorks-container");
  container.innerHTML = "";
  const dorks = buildDorks(domain, org);
  dorks.forEach((d) => {
    const a = document.createElement("a");
    a.className = "dork-link";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.href = `https://github.com/search?q=${encodeURIComponent(d.query)}&type=code`;
    a.innerHTML = `<span class="dork-label">${escapeHtml(d.label)}</span><span class="dork-query">${escapeHtml(d.query)}</span>`;
    a.addEventListener("click", () => logEvent(6, `Opened GitHub dork — ${d.label}: ${d.query}`));
    container.appendChild(a);
  });
}

// ---- 1. Page scan (content script) + footprint links ----
// Two modes:
//  - Normal popup (click the toolbar icon): always targets whatever tab is
//    active in the current window, and closes the moment focus leaves it.
//  - Standalone window (opened via "Open in Window"): stays open regardless
//    of what you click elsewhere, and keeps scanning one *pinned* tab —
//    identified by ?tabId=<id> in its own URL — until you hit "Retarget".

const urlParams = new URLSearchParams(window.location.search);
const isStandalone = urlParams.get("standalone") === "1";
let targetTabId = urlParams.has("tabId") ? parseInt(urlParams.get("tabId"), 10) : null;

function getTargetTab(callback) {
  if (targetTabId !== null) {
    chrome.tabs.get(targetTabId, (tab) => {
      callback(chrome.runtime.lastError ? null : tab);
    });
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => callback(tabs[0] || null));
  }
}

async function loadTargetTab(tab) {
  const targetLabel = document.getElementById("target-label");

  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    document.getElementById("leak-container").innerHTML =
      '<div class="no-leaks" style="color:#ff6666;">No valid target page (closed, or a restricted chrome:// page). Use Retarget to pick an active tab.</div>';
    document.getElementById("deep-scan-status").textContent = "";
    if (targetLabel) targetLabel.textContent = "No target";
    setTargetPill("No target");
    return;
  }

  currentTabId = tab.id;
  targetTabId = tab.id;
  const url = new URL(tab.url);
  currentOrigin = url.origin;
  const domain = url.hostname.replace(/^www\./, "");
  currentDomain = domain;

  if (targetLabel) targetLabel.textContent = tab.url;
  setTargetPill(domain);

  document.getElementById("btn-subdomains").href = `https://crt.sh/?q=%25.${domain}`;
  const org = document.getElementById("github-org-input").value.trim();
  renderDorks(domain, org);

  chrome.tabs.sendMessage(tab.id, { action: "getLeaks" }, async function (response) {
    const container = document.getElementById("leak-container");
    if (chrome.runtime.lastError || !response) {
      container.innerHTML = '<div class="no-leaks">Could not scan this page (restricted or not yet loaded).</div>';
      return;
    }
    const classified = await classifyFindings(response.findings || []);
    renderFindings(container, classified, "No obvious secrets found in rendered HTML or inline scripts.");
    discoveredScriptUrls = response.scriptUrls || [];
    document.getElementById("deep-scan-status").textContent =
      discoveredScriptUrls.length > 0
        ? `${discoveredScriptUrls.length} external script(s) detected on this page.`
        : "No external <script src> files detected on this page.";
    logEvent(2, `Passive scan of ${tab.url} — ${classified.length} finding(s) in rendered HTML/inline scripts, ${discoveredScriptUrls.length} external script(s) detected.`);
  });
}

getTargetTab(loadTargetTab);
refreshHeaderPill();

document.getElementById("btn-rebuild-dorks").addEventListener("click", () => {
  getTargetTab((tab) => {
    if (!tab || !tab.url) return;
    const domain = new URL(tab.url).hostname.replace(/^www\./, "");
    const org = document.getElementById("github-org-input").value.trim();
    renderDorks(domain, org);
  });
});

document.getElementById("btn-subdomains").addEventListener("click", () => {
  if (currentDomain) logEvent(6, `Opened crt.sh subdomain search for %.${currentDomain}`);
});

// ---- Standalone-window controls ----
const windowControls = document.getElementById("window-controls");
const openWindowBtn = document.getElementById("btn-open-window");

if (isStandalone) {
  if (windowControls) windowControls.style.display = "flex";
  if (openWindowBtn) openWindowBtn.style.display = "none";

  // Auto-refresh when the pinned tab finishes loading a new page.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === targetTabId && changeInfo.status === "complete") {
      loadTargetTab(tab);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === targetTabId) {
      loadTargetTab(null);
    }
  });

  const retargetBtn = document.getElementById("btn-retarget");
  if (retargetBtn) {
    retargetBtn.addEventListener("click", () => {
      chrome.windows.getLastFocused({ windowTypes: ["normal"], populate: true }, (win) => {
        const activeTab = win && win.tabs ? win.tabs.find((t) => t.active) : null;
        if (activeTab) loadTargetTab(activeTab);
      });
    });
  }
} else if (openWindowBtn) {
  openWindowBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) return;
      chrome.windows.create({
        url: chrome.runtime.getURL(`popup.html?standalone=1&tabId=${tab.id}`),
        type: "popup",
        width: 540,
        height: 720,
      });
      window.close();
    });
  });
}

// ---- 2. Deep scan: fetch external scripts + source maps, scan both ----
document.getElementById("btn-deep-scan").addEventListener("click", async () => {
  const statusEl = document.getElementById("deep-scan-status");
  const resultsEl = document.getElementById("deep-scan-container");
  const corsOverride = document.getElementById("cors-override").checked;

  if (discoveredScriptUrls.length === 0) {
    statusEl.textContent = "No external scripts to scan.";
    return;
  }

  // Same-origin by default — safest default for program scope. With the
  // override checked, cross-origin scripts are scanned too, but every
  // finding that comes from one is tagged CROSS-ORIGIN (see render below) so
  // it can never slip into a report as first-party by accident.
  const sameOriginUrls = discoveredScriptUrls.filter((u) => {
    try {
      return new URL(u).origin === currentOrigin;
    } catch (e) {
      return false;
    }
  });
  const crossOriginUrls = corsOverride
    ? discoveredScriptUrls.filter((u) => !sameOriginUrls.includes(u))
    : [];
  const urlsToScan = [...sameOriginUrls, ...crossOriginUrls];

  if (urlsToScan.length === 0) {
    statusEl.textContent = "Scripts found are all cross-origin (e.g. CDN) — skipped by default to stay in scope. Check the override above to scan them anyway.";
    resultsEl.innerHTML = "";
    return;
  }

  statusEl.textContent = `Deep scanning 0 / ${urlsToScan.length} script(s)...`;
  resultsEl.innerHTML = '<div class="no-leaks" style="color:#aaa;">Working...</div>';

  let allFindings = [];
  let mapsFound = 0;

  for (let i = 0; i < urlsToScan.length; i++) {
    const scriptUrl = urlsToScan[i];
    let isCrossOrigin = false;
    try {
      isCrossOrigin = new URL(scriptUrl).origin !== currentOrigin;
    } catch (e) {
      isCrossOrigin = false;
    }

    try {
      const res = await fetch(scriptUrl, { method: "GET" });
      if (!res.ok) continue;
      const text = await res.text();
      const label = `External Bundle: ${scriptUrl}`;
      const tag = (f) => ({ ...f, crossOrigin: isCrossOrigin });
      allFindings = allFindings.concat(runNamedRules(text, label).map(tag));
      allFindings = allFindings.concat(runGenericDetector(text, label).map(tag));

      // Check for a trailing source map reference.
      const mapMatch = text.match(/\/\/[#@]\s*sourceMappingURL=([^\s]+)/);
      if (mapMatch) {
        try {
          const mapUrl = new URL(mapMatch[1], scriptUrl).href;
          const mapRes = await fetch(mapUrl, { method: "GET" });
          if (mapRes.ok) {
            const mapJson = await mapRes.json();
            mapsFound++;
            const mapLabel = `Source Map: ${mapUrl}`;
            if (Array.isArray(mapJson.sourcesContent)) {
              mapJson.sourcesContent.forEach((src, idx) => {
                if (!src) return;
                const fileLabel = `${mapLabel} (${(mapJson.sources && mapJson.sources[idx]) || "source #" + idx})`;
                allFindings = allFindings.concat(runNamedRules(src, fileLabel).map(tag));
                allFindings = allFindings.concat(runGenericDetector(src, fileLabel).map(tag));
              });
            }
          }
        } catch (mapErr) {
          // Map fetch/parsing failed — not fatal, continue.
        }
      }
    } catch (err) {
      // Fetch failed (CORS, network, etc.) — skip this file.
    }
    statusEl.textContent = `Deep scanning ${i + 1} / ${urlsToScan.length} script(s)...`;
  }

  allFindings = dedupeFindings(allFindings);
  allFindings = await classifyFindings(allFindings);

  statusEl.textContent =
    `Scanned ${urlsToScan.length} script(s) (${crossOriginUrls.length} cross-origin), found ${mapsFound} exposed source map(s). ` +
    `${allFindings.length} finding(s) total.`;
  renderFindings(resultsEl, allFindings, "No secrets found in fetched bundles or their source maps.");

  const urlListForLog = urlsToScan.length > 10
    ? urlsToScan.slice(0, 10).join(", ") + ` (+${urlsToScan.length - 10} more)`
    : urlsToScan.join(", ");
  logEvent(3, `Deep scan — ${urlsToScan.length} script(s) (${crossOriginUrls.length} cross-origin), ${mapsFound} source map(s), ${allFindings.length} finding(s). URLs: ${urlListForLog}`);
});

// ---- 3. Header Manager Logic ----
const headersContainer = document.getElementById("headers-container");

function createRow(index, active = false, name = "", value = "") {
  const row = document.createElement("div");
  row.className = "header-row";
  row.innerHTML = `
        <input type="checkbox" id="cb-${index}" title="Toggle Header" ${active ? "checked" : ""}>
        <input type="text" id="name-${index}" placeholder="Header-Name" value="${name}">
        <input type="text" id="val-${index}" placeholder="Value" value="${value}">
    `;
  headersContainer.appendChild(row);
}

chrome.storage.local.get(["customHeaders"], (result) => {
  const saved = result.customHeaders || [];
  for (let i = 0; i < 5; i++) {
    const data = saved[i] || { active: false, name: "", value: "" };
    createRow(i, data.active, data.name, data.value);
  }
});

document.getElementById("save-headers").addEventListener("click", () => {
  const customHeaders = [];
  for (let i = 0; i < 5; i++) {
    customHeaders.push({
      active: document.getElementById(`cb-${i}`).checked,
      name: document.getElementById(`name-${i}`).value.trim(),
      value: document.getElementById(`val-${i}`).value.trim(),
    });
  }

  chrome.storage.local.set({ customHeaders }, () => {
    const status = document.getElementById("save-status");
    status.innerText = "Headers saved and applied globally!";
    setTimeout(() => (status.innerText = ""), 2500);
    refreshHeaderPill();

    const active = customHeaders.filter((h) => h.active && h.name && h.value);
    logEvent(
      1,
      active.length > 0
        ? `Attribution header set: ${active.map((h) => `${h.name}: ${h.value}`).join(", ")}`
        : "Attribution header cleared/disabled."
    );
  });
});

// ---- 4. Bulk Scope Resolver Logic ----
document.getElementById("btn-resolve").addEventListener("click", async () => {
  const input = document.getElementById("scope-input").value;
  const domains = input.split("\n").map((d) => d.trim()).filter((d) => d.length > 0);

  if (domains.length === 0) return;

  const statusEl = document.getElementById("resolve-status");
  const csvBtn = document.getElementById("btn-download-csv");

  statusEl.innerText = `Resolving 0 / ${domains.length}... (Keep this popup open)`;
  csvBtn.style.display = "none";

  const { customHeaders } = await chrome.storage.local.get(["customHeaders"]);
  const activeHeaders = (customHeaders || []).filter((h) => h.active && h.name && h.value);
  let fetchHeaders = {};
  activeHeaders.forEach((h) => (fetchHeaders[h.name] = h.value));

  let results = [];

  for (let i = 0; i < domains.length; i++) {
    let target = domains[i];
    if (!target.startsWith("http")) target = "https://" + target;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(target, {
        method: "GET",
        headers: fetchHeaders,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      results.push({ domain: domains[i], resolved_url: response.url, status: response.status });
    } catch (error) {
      results.push({ domain: domains[i], resolved_url: target, status: "Timeout/Error" });
    }

    statusEl.innerText = `Resolving ${i + 1} / ${domains.length}...`;
  }

  statusEl.innerText = `Finished resolving ${domains.length} targets.`;

  let csvContent = "data:text/csv;charset=utf-8,Original Domain,Resolved URL,Status Code\n";
  results.forEach((r) => {
    csvContent += `${r.domain},${r.resolved_url},${r.status}\n`;
  });

  csvBtn.style.display = "block";
  csvBtn.onclick = () => {
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "live_scope_results.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const liveCount = results.filter((r) => typeof r.status === "number" && r.status < 400).length;
  logEvent(5, `Scope resolver — ${domains.length} domain(s) resolved (${liveCount} live) with header(s): ${Object.keys(fetchHeaders).join(", ") || "none"}.`);
});

// ---- 5. Request Lab — Repeater / Intruder ----
// Manual-entry request replay. Fetches run from the extension's own context,
// which — same as the Bulk Scope Resolver above — carries host_permissions
// (<all_urls>) past ordinary CORS restrictions, and the saved custom header
// (declarativeNetRequest rule) rides along automatically on every request,
// same as it does everywhere else in the tool.
//
// Known limitation worth remembering: this is NOT the same network stack as
// the page itself. Strict/Lax SameSite session cookies tied to a real
// top-level navigation won't necessarily ride along on a fetch initiated
// from the extension's own origin — fine for header/param/WAF-response
// testing, not a substitute for testing authenticated, cookie-gated flows.

const PAYLOAD_MARKER = "§payload§";

function parseHeaderLines(text) {
  const headers = {};
  (text || "").split("\n").forEach((line) => {
    const idx = line.indexOf(":");
    if (idx === -1) return;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (name) headers[name] = value;
  });
  return headers;
}

function substitutePayload(text, payload) {
  return (text || "").split(PAYLOAD_MARKER).join(payload);
}

async function fireRequest(method, url, headers, body) {
  const start = performance.now();
  const opts = { method, headers };
  if (body && !["GET", "HEAD"].includes(method)) opts.body = body;
  let status = null;
  let text = "";
  let error = null;
  try {
    const res = await fetch(url, opts);
    status = res.status;
    text = await res.text();
  } catch (err) {
    error = err.message || String(err);
  }
  const time = Math.round(performance.now() - start);
  return { status, text, error, time };
}

document.getElementById("btn-lab-send").addEventListener("click", async () => {
  const statusEl = document.getElementById("lab-status");
  const responseEl = document.getElementById("lab-response");
  document.getElementById("lab-sweep-table").style.display = "none";

  const method = document.getElementById("lab-method").value;
  const url = document.getElementById("lab-url").value.trim();
  if (!url) {
    statusEl.textContent = "Enter a URL first.";
    return;
  }
  const headers = parseHeaderLines(document.getElementById("lab-headers").value);
  const body = document.getElementById("lab-body").value;

  statusEl.textContent = "Sending...";
  responseEl.style.display = "none";

  const result = await fireRequest(method, url, headers, body);

  if (result.error) {
    statusEl.textContent = `Request failed: ${result.error}`;
    logEvent(4, `${method} ${url} → failed: ${result.error}`);
    return;
  }

  statusEl.textContent = `${result.status} — ${result.text.length} bytes — ${result.time}ms`;
  responseEl.style.display = "block";
  responseEl.textContent = result.text.slice(0, 5000) + (result.text.length > 5000 ? "\n…(truncated)" : "");

  logEvent(4, `${method} ${url} → ${result.status}, ${result.text.length} bytes, ${result.time}ms${Object.keys(headers).length ? ` (headers: ${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join(", ")})` : ""}`);
});

document.getElementById("btn-lab-sweep").addEventListener("click", async () => {
  const statusEl = document.getElementById("lab-status");
  const responseEl = document.getElementById("lab-response");
  const table = document.getElementById("lab-sweep-table");
  const tbody = document.getElementById("lab-sweep-tbody");
  responseEl.style.display = "none";

  const method = document.getElementById("lab-method").value;
  const urlTemplate = document.getElementById("lab-url").value.trim();
  const headersTemplate = document.getElementById("lab-headers").value;
  const bodyTemplate = document.getElementById("lab-body").value;
  const payloads = document.getElementById("lab-payloads").value
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (!urlTemplate) {
    statusEl.textContent = "Enter a URL (with §payload§ where it should be substituted) first.";
    return;
  }
  if (payloads.length === 0) {
    statusEl.textContent = "Add at least one payload line.";
    return;
  }

  tbody.innerHTML = "";
  table.style.display = "table";
  statusEl.textContent = `Sweeping 0 / ${payloads.length}...`;

  // Baseline (first payload) used only to flag anomalies by response length —
  // a quick visual cue, not a verdict. Sequential, not parallel, to respect
  // program rate limits.
  let baselineLength = null;

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    const url = substitutePayload(urlTemplate, payload);
    const headers = parseHeaderLines(substitutePayload(headersTemplate, payload));
    const body = substitutePayload(bodyTemplate, payload);

    const result = await fireRequest(method, url, headers, body);
    const length = result.error ? 0 : result.text.length;
    if (baselineLength === null && !result.error) baselineLength = length;

    const row = document.createElement("tr");
    const isAnomaly = baselineLength !== null && Math.abs(length - baselineLength) > Math.max(20, baselineLength * 0.1);
    if (isAnomaly) row.classList.add("anomaly");
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(payload)}</td>
      <td>${result.error ? "ERR" : result.status}</td>
      <td>${length}</td>
      <td>${result.time}</td>
    `;
    tbody.appendChild(row);

    statusEl.textContent = `Sweeping ${i + 1} / ${payloads.length}...`;
  }

  statusEl.textContent = `Finished sweeping ${payloads.length} payload(s). Rows flagged in red differ from the baseline response length by >10% — worth a manual look, not an automatic finding.`;

  logEvent(4, `Payload sweep — ${method} ${urlTemplate} — ${payloads.length} payload(s) tried: [${payloads.join(", ")}], baseline response length ${baselineLength ?? "n/a"} bytes.`);
});

// ---- 6. Behavior Watcher — flagged irregularities ----
// Nothing here fires a request. watcher-inject.js + content.js have already
// been logging your own normal browsing in the background; this just reads
// back whatever watcher-store.js (in the background service worker) flagged
// as inconsistent with that endpoint's own established baseline.
function renderBehaviorAnomalies(anomalies) {
  const container = document.getElementById("behavior-container");
  const statusEl = document.getElementById("behavior-status");
  if (statusEl) {
    statusEl.textContent = `${anomalies.length} flagged irregularit${anomalies.length === 1 ? "y" : "ies"}.`;
  }

  if (!container) return;

  if (anomalies.length === 0) {
    container.innerHTML = '<div class="no-leaks">Nothing inconsistent flagged yet — keep browsing normally, then hit Refresh.</div>';
    return;
  }

  container.innerHTML = "";
  anomalies.forEach((a) => {
    const div = document.createElement("div");
    div.className = "finding sev-High";
    const kinds = a.anomalies.map((x) => x.kind).join(", ");
    const details = a.anomalies.map((x) => `• ${escapeHtml(x.detail)}`).join("<br>");
    div.innerHTML = `
      <div><span class="finding-type">${escapeHtml(kinds)}</span></div>
      <div class="finding-source">Endpoint: ${escapeHtml(a.key)}</div>
      <div class="finding-source">Seen on: ${escapeHtml(a.pageUrl || "")}</div>
      <div class="finding-context">${details}</div>
      <div class="finding-value">Latest call: ${a.entry.status} — ${a.entry.time ?? "?"}ms — ${new Date(a.at).toLocaleString()}</div>
      <button class="copy-btn" data-key="${escapeHtml(a.key)}">Copy evidence</button>
    `;
    container.appendChild(div);

    div.querySelector(".copy-btn").addEventListener("click", () => {
      const text =
        `Behavior Watcher — flagged irregularity\n` +
        `Endpoint: ${a.key}\n` +
        `Observed on: ${a.pageUrl}\n` +
        `Flags: ${kinds}\n` +
        a.anomalies.map((x) => `- ${x.detail}`).join("\n") +
        `\nLatest call: ${a.entry.method} ${a.entry.url} → ${a.entry.status}, ${a.entry.time ?? "?"}ms\n` +
        `Timestamp: ${new Date(a.at).toLocaleString()}`;
      navigator.clipboard.writeText(text).then(() => {
        const btn = div.querySelector(".copy-btn");
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copy evidence";
          btn.classList.remove("copied");
        }, 1500);
      });
    });
  });
}

function refreshBehaviorAnomalies() {
  chrome.runtime.sendMessage({ action: "getBehaviorAnomalies", limit: 100 }, (res) => {
    renderBehaviorAnomalies((res && res.anomalies) || []);
  });
}

const btnRefreshBehavior = document.getElementById("btn-refresh-behavior");
const btnClearBehavior = document.getElementById("btn-clear-behavior");
if (btnRefreshBehavior) btnRefreshBehavior.addEventListener("click", refreshBehaviorAnomalies);
if (btnClearBehavior) {
  btnClearBehavior.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "clearBehaviorAnomalies" }, () => refreshBehaviorAnomalies());
  });
}
refreshBehaviorAnomalies();
