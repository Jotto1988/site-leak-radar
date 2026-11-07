# Site Leak Radar 📡

A Manifest V3 browser extension that passively detects leaked secrets in the DOM, generates external footprint dorks, and dynamically injects custom HTTP headers (like bug bounty tracking headers) into all network requests.

Because this relies on Chrome's `declarativeNetRequest` API, it completely replaces the need for heavy extensions like ModHeader while simultaneously scanning for exposed keys.

## Features
* **Custom Header Injection:** Add up to 5 active headers (e.g., `X-BUG-BOUNTY: forgevertical`) to all outbound browser requests. 
* **Passive Secret Scanner:** Automatically parses the current page's HTML for exposed AWS Keys, Google API Keys, Stripe Tokens, RSA Private Keys, and JWTs.
* **Footprint Generation:** Instantly generates targeted GitHub dork links and crt.sh subdomain queries based on the active tab's domain.
* **Zero Dependencies:** Pure vanilla JavaScript, HTML, and CSS.

## How to Install (Unpacked)
1. Download or clone this repository to your local machine.
2. Open your Chromium-based browser (Brave, Chrome, Edge) and navigate to `brave://extensions/` (or `chrome://extensions/`).
3. Toggle on **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the folder containing these extension files.
5. Pin the extension to your toolbar for quick access.

## Usage & Testing
1. Click the extension icon to open the dashboard.
2. Under **Custom Header Injection**, enter your desired headers (e.g., Name: `X-BUG-BOUNTY`, Value: `your-handle`), check the box to enable it, and click **Save & Apply**.
3. *Note on Headers:* Browsers hide `declarativeNetRequest` headers from the local Network tab. To verify your injection is working, visit `https://httpbin.org/headers`.
4. The **Detected Secrets** panel automatically updates as you navigate across web applications. 

## License
MIT License.
