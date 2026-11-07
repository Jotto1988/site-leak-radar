// ===== Site Leak Radar — popup.js =====

let currentTabId = null;
let currentOrigin = null;
let discoveredScriptUrls = [];

function renderFindings(containerEl, findings, emptyMessage) {
  if (!findings || findings.length === 0) {
    containerEl.innerHTML = `<div class="no-leaks">${emptyMessage}</div>`;
    return;
  }
  containerEl.innerHTML = "";
  findings.forEach((f, idx) => {
    const div = document.createElement("div");
    div.className = `finding sev-${f.severity}`;
    const evidenceId = `evidence-${Math.random().toString(36).slice(2)}`;
    div.innerHTML = `
      <div><span class="finding-type">${escapeHtml(f.type)}</span><span class="finding-sev sev-${f.severity}">${f.severity}</span></div>
      <div class="finding-source">Source: ${escapeHtml(f.source)}</div>
      <div class="finding-value">${escapeHtml(f.value)}</div>
      <div class="finding-context">${escapeHtml(f.context)}</div>
      <button class="copy-btn" data-idx="${idx}">Copy evidence</button>
    `;
    containerEl.appendChild(div);

    const copyBtn = div.querySelector(".copy-btn");
    copyBtn.addEventListener("click", () => {
      const evidenceText =
        `Finding: ${f.type}\n` +
        `Severity: ${f.severity}\n` +
        `Source: ${f.source}\n` +
        `Value: ${f.value}\n` +
        `Context: ${f.context}`;
      navigator.clipboard.writeText(evidenceText).then(() => {
        copyBtn.textContent = "Copied!";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = "Copy evidence";
          copyBtn.classList.remove("copied");
        }, 1500);
      });
    });
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
    container.appendChild(a);
  });
}

// ---- 1. Page scan (content script) + footprint links ----
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
  const currentTab = tabs[0];
  currentTabId = currentTab.id;
  const url = new URL(currentTab.url);
  currentOrigin = url.origin;
  const domain = url.hostname.replace(/^www\./, "");

  document.getElementById("btn-subdomains").href = `https://crt.sh/?q=%25.${domain}`;
  document.getElementById("github-org-input").dataset.domain = domain;
  renderDorks(domain, "");

  document.getElementById("btn-rebuild-dorks").addEventListener("click", () => {
    const org = document.getElementById("github-org-input").value.trim();
    renderDorks(domain, org);
  });

  chrome.tabs.sendMessage(currentTab.id, { action: "getLeaks" }, function (response) {
    const container = document.getElementById("leak-container");
    if (chrome.runtime.lastError || !response) {
      container.innerHTML = '<div class="no-leaks">Could not scan this page (restricted or not yet loaded).</div>';
      return;
    }
    renderFindings(container, response.findings, "No obvious secrets found in rendered HTML or inline scripts.");
    discoveredScriptUrls = response.scriptUrls || [];
    document.getElementById("deep-scan-status").textContent =
      discoveredScriptUrls.length > 0
        ? `${discoveredScriptUrls.length} external script(s) detected on this page.`
        : "No external <script src> files detected on this page.";
  });
});

// ---- 2. Deep scan: fetch external scripts + source maps, scan both ----
document.getElementById("btn-deep-scan").addEventListener("click", async () => {
  const statusEl = document.getElementById("deep-scan-status");
  const resultsEl = document.getElementById("deep-scan-container");

  if (discoveredScriptUrls.length === 0) {
    statusEl.textContent = "No external scripts to scan.";
    return;
  }

  // Stay same-origin by default — safest default for program scope.
  const sameOriginUrls = discoveredScriptUrls.filter((u) => {
    try {
      return new URL(u).origin === currentOrigin;
    } catch (e) {
      return false;
    }
  });

  if (sameOriginUrls.length === 0) {
    statusEl.textContent = "Scripts found are all cross-origin (e.g. CDN) — skipped by default to stay in scope.";
    resultsEl.innerHTML = "";
    return;
  }

  statusEl.textContent = `Deep scanning 0 / ${sameOriginUrls.length} same-origin script(s)...`;
  resultsEl.innerHTML = '<div class="no-leaks" style="color:#aaa;">Working...</div>';

  let allFindings = [];
  let mapsFound = 0;

  for (let i = 0; i < sameOriginUrls.length; i++) {
    const scriptUrl = sameOriginUrls[i];
    try {
      const res = await fetch(scriptUrl, { method: "GET" });
      if (!res.ok) continue;
      const text = await res.text();
      const label = `External Bundle: ${scriptUrl}`;
      allFindings = allFindings.concat(runNamedRules(text, label));
      allFindings = allFindings.concat(runGenericDetector(text, label));

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
                allFindings = allFindings.concat(runNamedRules(src, fileLabel));
                allFindings = allFindings.concat(runGenericDetector(src, fileLabel));
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
    statusEl.textContent = `Deep scanning ${i + 1} / ${sameOriginUrls.length} same-origin script(s)...`;
  }

  allFindings = dedupeFindings(allFindings);
  statusEl.textContent =
    `Scanned ${sameOriginUrls.length} script(s), found ${mapsFound} exposed source map(s). ` +
    `${allFindings.length} finding(s) total.`;
  renderFindings(resultsEl, allFindings, "No secrets found in fetched bundles or their source maps.");
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
});
