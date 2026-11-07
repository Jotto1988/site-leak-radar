# Site Leak Radar 🕷️

Recon that happens while you're already browsing. Site Leak Radar is a Manifest V3 extension that quietly watches every page you visit and surfaces what's already lying out in the open — secrets sitting in rendered HTML, inline scripts, loaded JS bundles, and exposed source maps — then hands you report-ready evidence, footprint dorks, and a scope resolver, all from one popup.

It never probes for anything new. Every finding comes from something the target was already serving to any visitor by default: the DOM, scripts the page itself requested, and source maps those scripts reference. No endpoint guessing, no brute-forcing, no traffic beyond fetching resources the page already pointed the browser at.

## Features

* **Custom Header Injection:** Add up to 5 active headers (e.g. `X-BUG-BOUNTY: your-handle`) to all outbound browser requests, via Chrome's `declarativeNetRequest` API — no need for a separate ModHeader-style extension.
* **Passive Secret Scanner:** Scans the current page's rendered HTML and inline `<script>` contents for a broad set of named secret patterns (AWS, GCP, Stripe, GitHub/GitLab, Slack, Twilio, SendGrid, Mailgun, NPM, Shopify, Square, PayPal/Braintree, database connection strings with embedded creds, Basic-Auth-in-URL, all private-key block types, JWTs) plus a generic keyword + high-entropy detector (TruffleHog-style) that catches unnamed/custom secrets assigned to variables like `apiKey`, `secret`, `token`, `password` inside inline scripts.
* **Deep Scan — External Bundles & Source Maps:** One click fetches every same-origin `<script src>` file the page already loaded, scans it with the same rule set, and — if a bundle references a source map (`//# sourceMappingURL=`) — fetches that map too and scans its `sourcesContent` for secrets baked into the original (pre-build) source. Exposed source maps are one of the most common real-world information-disclosure findings, and this is the highest-value part of the tool.
* **Report-Ready Evidence:** Every finding shows its type, severity, source, matched value, and a surrounding context snippet, with a one-click "Copy evidence" button that produces a clean text block ready to paste under a screenshot in a report.
* **Footprint Generation:** Instantly generates targeted GitHub dork links and crt.sh subdomain queries based on the active tab's domain.
* **Bulk Scope Resolver:** Paste a list of domains/subdomains, resolve all of them (with your custom headers attached), and export resolved URL + status code to CSV.
* **Zero Dependencies:** Pure vanilla JavaScript, HTML, and CSS.

## How to Install (Unpacked)

1. Download or clone this repository to your local machine.
2. Open your Chromium-based browser (Chrome, Edge, Brave, Opera) and navigate to `chrome://extensions/` (or the equivalent for your browser).
3. Toggle on **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the folder containing these extension files.
5. Pin the extension to your toolbar for quick access.

Won't work in Firefox or Safari — they use a different extension system.

## Usage & Testing

1. Click the extension icon to open the dashboard.
2. **Detected Secrets** updates automatically as you navigate — it's scanning the page you're already on.
3. Click **Deep Scan Loaded JS Bundles** to fetch and scan every same-origin script the page loaded, and any source maps they reference. Cross-origin scripts (e.g. a third-party CDN) are skipped by default to stay inside typical program scope.
4. Under **Custom Header Injection**, enter your desired headers (e.g. Name: `X-BUG-BOUNTY`, Value: `your-handle`), check the box to enable it, and click **Save & Apply**. This header rides along on every request the browser makes — including the deep-scan fetches above.
   * *Note:* browsers hide `declarativeNetRequest`-injected headers from the local Network tab. To verify the injection is working, visit `https://httpbin.org/headers`.
5. Use **Bulk Scope Resolver** to check liveness and resolved URLs for a whole scope list at once.

## A note on scope

This tool only reads resources a target already serves to any visitor by default (rendered page, loaded scripts, referenced source maps). It does not perform authentication bypass, social engineering, or active exploitation of any kind. Whether a given finding is in-scope and reportable for a specific program is a judgment call the researcher makes per-program — this tool just removes the hours of manual digging to surface candidates.

## License

MIT License.
