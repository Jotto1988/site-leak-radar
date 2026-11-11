// Site Leak Radar — content script.
// Passively scans the already-rendered page: full HTML (named patterns) and
// inline <script> contents (named patterns + generic high-entropy detector).
// Also collects external <script src> URLs so the popup can offer a deep scan
// of already-served bundles and their source maps — no new requests to
// anything the browser hasn't already been pointed at by the page itself.

// Script URL discovery is kept live (not a one-shot snapshot) because SPAs
// commonly lazy-load additional bundles (route-based code splitting, dynamic
// import()) well after initial page load. A MutationObserver catches new
// <script src> nodes as they're inserted; the Performance Resource Timing
// API catches bundles the DOM snapshot can miss entirely (e.g. a script tag
// that's inserted and then removed once it's executed). Both just widen
// which already-served URLs get offered to the popup's deep scan — neither
// causes any new request beyond what the page itself already triggered.
let discoveredScriptUrls = new Set();

function toAbsoluteUrl(src) {
  try {
    return new URL(src, window.location.href).href;
  } catch (e) {
    return null;
  }
}

function collectScriptUrls() {
  const fromDom = Array.from(document.querySelectorAll("script[src]"))
    .map((s) => s.getAttribute("src"))
    .filter(Boolean);

  let fromPerf = [];
  try {
    fromPerf = performance
      .getEntriesByType("resource")
      .filter((e) => e.initiatorType === "script" || /\.(js|mjs)(\?|#|$)/i.test(e.name))
      .map((e) => e.name);
  } catch (e) {
    // performance API unavailable in some restricted contexts — not fatal.
  }

  [...fromDom, ...fromPerf].forEach((src) => {
    const abs = toAbsoluteUrl(src);
    if (abs) discoveredScriptUrls.add(abs);
  });
}

const scriptObserver = new MutationObserver(() => collectScriptUrls());

function scanForLeaks() {
  let allFindings = [];

  // 1. Rendered page HTML — named patterns only (full HTML is too noisy for the
  //    generic entropy check, which is reserved for script contexts below).
  const pageHtml = document.documentElement.innerHTML;
  allFindings = allFindings.concat(runNamedRules(pageHtml, "Page HTML"));

  // 2. Inline <script> tags — named patterns + generic keyword/entropy detector.
  const inlineScripts = Array.from(document.querySelectorAll("script:not([src])"));
  inlineScripts.forEach((script, idx) => {
    const text = script.textContent || "";
    if (!text.trim()) return;
    const label = `Inline Script #${idx + 1}`;
    allFindings = allFindings.concat(runNamedRules(text, label));
    allFindings = allFindings.concat(runGenericDetector(text, label));
  });

  const uniqueFindings = dedupeFindings(allFindings);

  // 3. Script URL discovery (see collectScriptUrls above for why this is live).
  collectScriptUrls();

  return { findings: uniqueFindings };
}

let cachedResult = null;

function runScan() {
  cachedResult = scanForLeaks();
  try {
    scriptObserver.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {
    // documentElement not ready yet in some edge cases — harmless to skip.
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runScan);
} else {
  runScan();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getLeaks") {
    if (!cachedResult) runScan();
    collectScriptUrls(); // pick up anything loaded since the initial scan
    sendResponse({
      findings: cachedResult.findings,
      scriptUrls: [...discoveredScriptUrls],
      hostname: window.location.hostname,
      origin: window.location.origin,
    });
  }
  return true;
});

// ---- Behavior Watcher relay ----
// watcher-inject.js runs in the MAIN world and can't reach chrome.runtime
// directly, so it dispatches a CustomEvent on window (isolated-world content
// scripts share the same DOM and can hear it); this listener picks each one
// up and relays it to the background service worker, which does the actual
// baseline/diff work and storage. This script never fires a request itself —
// it only reacts to traffic the page already generated on its own.
window.addEventListener("slr:behavior-entry", (e) => {
  try {
    chrome.runtime.sendMessage({
      action: "behaviorEntry",
      entry: e.detail,
      pageUrl: window.location.href,
    });
  } catch (err) {
    // Extension context can be invalidated mid-navigation — harmless to drop.
  }
});
