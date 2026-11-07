const secretPatterns = {
    "AWS Access Key": /AKIA[0-9A-Z]{16}/g,
    "Google API Key": /AIza[0-9A-Za-z\-_]{35}/g,
    "Stripe API Key": /sk_live_[0-9a-zA-Z]{24}/g,
    "JSON Web Token (JWT)": /eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/g,
    "RSA Private Key": /-----BEGIN RSA PRIVATE KEY-----/g,
    "Slack Token": /xox[baprs]-[0-9a-zA-Z]{10,48}/g
};

function scanForLeaks() {
    const pageContent = document.documentElement.innerHTML;
    let foundLeaks = [];

    for (const [name, regex] of Object.entries(secretPatterns)) {
        const matches = pageContent.match(regex);
        if (matches) {
            // Deduplicate matches
            const uniqueMatches = [...new Set(matches)];
            uniqueMatches.forEach(match => {
                foundLeaks.push({ type: name, value: match });
            });
        }
    }

    // Send findings to the popup if requested
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "getLeaks") {
            sendResponse({ leaks: foundLeaks, hostname: window.location.hostname });
        }
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanForLeaks);
} else {
    scanForLeaks();
}
