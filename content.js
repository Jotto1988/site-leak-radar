// Site Leak Radar — content script.
// Passively scans the already-rendered page: full HTML (named patterns) and
// inline <script> contents (named patterns + generic high-entropy detector).
// Also collects external <script src> URLs so the popup can offer a deep scan
// of already-served bundles and their source maps — no new requests to
// anything the browser hasn't already been pointed at by the page itself.

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

  // 3. Collect external <script src> URLs for popup-triggered deep scan.
  const scriptUrls = Array.from(document.querySelectorAll("script[src]"))
    .map((s) => s.getAttribute("src"))
    .filter(Boolean)
    .map((src) => {
      try {
        return new URL(src, window.location.href).href;
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);

  return { findings: uniqueFindings, scriptUrls: [...new Set(scriptUrls)] };
}

let cachedResult = null;

function runScan() {
  cachedResult = scanForLeaks();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runScan);
} else {
  runScan();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getLeaks") {
    if (!cachedResult) runScan();
    sendResponse({
      findings: cachedResult.findings,
      scriptUrls: cachedResult.scriptUrls,
      hostname: window.location.hostname,
      origin: window.location.origin,
    });
  }
  return true;
});
