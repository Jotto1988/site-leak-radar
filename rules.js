// ===== Site Leak Radar — shared passive secret detection rules =====
// Loaded both by the content script (scans the live page) and by popup.js (scans
// fetched external bundles / source maps during a deep scan). Keep this file
// dependency-free — no DOM access — so it works in both contexts.

const NAMED_RULES = [
  { id: "AWS Access Key ID", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: "High" },
  { id: "AWS Secret Access Key (contextual)", regex: /aws_secret_access_key\s*[:=]\s*['"]?([A-Za-z0-9\/+=]{40})['"]?/gi, severity: "High" },
  { id: "Google API Key", regex: /AIza[0-9A-Za-z\-_]{35}/g, severity: "High" },
  { id: "Google OAuth Client ID", regex: /[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com/g, severity: "Medium" },
  { id: "Firebase Legacy Server Key", regex: /AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/g, severity: "High" },
  { id: "Stripe Live Secret Key", regex: /sk_live_[0-9a-zA-Z]{24,}/g, severity: "High" },
  { id: "Stripe Restricted Key", regex: /rk_live_[0-9a-zA-Z]{24,}/g, severity: "High" },
  { id: "Stripe Publishable Key", regex: /pk_live_[0-9a-zA-Z]{24,}/g, severity: "Low" },
  { id: "GitHub Personal Access Token", regex: /ghp_[A-Za-z0-9]{36}\b/g, severity: "High" },
  { id: "GitHub Fine-Grained PAT", regex: /github_pat_[A-Za-z0-9_]{22,}/g, severity: "High" },
  { id: "GitHub OAuth Token", regex: /gho_[A-Za-z0-9]{36}\b/g, severity: "High" },
  { id: "GitLab Personal Access Token", regex: /glpat-[A-Za-z0-9\-_]{20}\b/g, severity: "High" },
  { id: "Slack Token", regex: /xox[baprs]-[0-9A-Za-z-]{10,48}/g, severity: "High" },
  { id: "Slack Webhook URL", regex: /https:\/\/hooks\.slack\.com\/services\/T[0-9A-Za-z_]{8,}\/B[0-9A-Za-z_]{8,}\/[0-9A-Za-z_]{24}/g, severity: "High" },
  { id: "Twilio API Key", regex: /SK[0-9a-fA-F]{32}\b/g, severity: "High" },
  { id: "SendGrid API Key", regex: /SG\.[A-Za-z0-9_\-\.]{60,}/g, severity: "High" },
  { id: "Mailgun API Key", regex: /key-[0-9a-zA-Z]{32}\b/g, severity: "Medium" },
  { id: "Mailchimp API Key", regex: /[0-9a-f]{32}-us[0-9]{1,2}\b/g, severity: "Medium" },
  { id: "NPM Access Token", regex: /npm_[A-Za-z0-9]{36}\b/g, severity: "High" },
  { id: "Shopify Access Token", regex: /shpat_[0-9a-fA-F]{32}\b/g, severity: "High" },
  { id: "Shopify Custom App Token", regex: /shpca_[0-9a-fA-F]{32}\b/g, severity: "High" },
  { id: "Shopify Private App Password", regex: /shppa_[0-9a-fA-F]{32}\b/g, severity: "High" },
  { id: "Square Access Token", regex: /sq0atp-[0-9A-Za-z\-_]{22}\b/g, severity: "High" },
  { id: "Square OAuth Secret", regex: /sq0csp-[0-9A-Za-z\-_]{43}\b/g, severity: "High" },
  { id: "PayPal/Braintree Access Token", regex: /access_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}/g, severity: "High" },
  { id: "Database Connection String (with creds)", regex: /(?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?|redis):\/\/[^\s'"<>]+:[^\s'"<>]+@[^\s'"<>]+/gi, severity: "High" },
  { id: "Basic Auth Credentials in URL", regex: /https?:\/\/[^\s'"<>\/]+:[^\s'"<>\/]+@[^\s'"<>]+/g, severity: "High" },
  { id: "Private Key Block", regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |)PRIVATE KEY-----/g, severity: "High" },
  { id: "PGP Private Key Block", regex: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g, severity: "High" },
  { id: "JSON Web Token (JWT)", regex: /eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/g, severity: "Medium" },

  // ---- Added for broader surface coverage ----
  { id: "Azure Storage Account Key", regex: /DefaultEndpointsProtocol=https?;AccountName=[A-Za-z0-9]+;AccountKey=[A-Za-z0-9+\/=]{86,88}/g, severity: "High" },
  { id: "Azure Client Secret (contextual)", regex: /azure[_-]?client[_-]?secret\s*[:=]\s*['"]?([A-Za-z0-9_\-~\.]{32,44})['"]?/gi, severity: "High" },
  { id: "Algolia Admin API Key (contextual)", regex: /algolia[_-]?(?:admin[_-]?)?api[_-]?key\s*[:=]\s*['"]?([a-f0-9]{32})['"]?/gi, severity: "Medium" },
  { id: "Datadog API Key (contextual)", regex: /dd[_-]?api[_-]?key\s*[:=]\s*['"]?([a-f0-9]{32})['"]?/gi, severity: "Medium" },
  { id: "New Relic Browser License Key", regex: /NRJS-[a-f0-9]{19}\b/g, severity: "Low" },
  { id: "Auth0 Client Secret (contextual)", regex: /auth0[_-]?client[_-]?secret\s*[:=]\s*['"]?([A-Za-z0-9_\-]{48,64})['"]?/gi, severity: "High" },
  { id: "Okta API Token (contextual)", regex: /okta[_-]?api[_-]?token\s*[:=]\s*['"]?([A-Za-z0-9_\-]{40,42})['"]?/gi, severity: "High" },
  { id: "Discord Bot Token", regex: /\b[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27}\b/g, severity: "High" },
  { id: "Telegram Bot Token", regex: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, severity: "High" },
  { id: "Bearer Token (contextual)", regex: /Authorization['"]?\s*[:=]\s*['"]Bearer\s+([A-Za-z0-9\-_\.]{20,})['"]/gi, severity: "Medium" },
  { id: "Heroku API Key (contextual)", regex: /heroku[_-]?api[_-]?key\s*[:=]\s*['"]?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})['"]?/gi, severity: "High" },
];

// Rule IDs whose matches are commonly exposed on purpose (public-by-design
// credentials, or ambiguous formats that need live testing to confirm impact).
// Shown as a verify-before-reporting note on the finding card rather than
// silently hidden, so the researcher still sees it but isn't fooled by it.
const VERIFY_NOTES = {
  "Stripe Publishable Key": "Publishable by design, not a secret on its own — check for a paired live secret key before treating this as a finding.",
  "Google OAuth Client ID": "Public half of the OAuth handshake by design — only the paired client secret is sensitive.",
  "Google API Key": "Ambiguous format — could be a restricted public web key (Maps/Firebase) or an unrestricted key. Needs a live API test before it's a finding.",
  "New Relic Browser License Key": "Browser agent license keys are meant to ship client-side — not a finding on its own.",
};

// Generic keyword + high-entropy detector — catches unnamed/custom secrets, TruffleHog-style.
const GENERIC_KEYWORD_REGEX = /\b(api[_-]?key|apikey|secret|token|auth[_-]?token|client[_-]?secret|private[_-]?key|access[_-]?key|password|passwd)\b\s*[:=]\s*['"]([A-Za-z0-9+\/_\-\.]{16,100})['"]/gi;
const MIN_ENTROPY = 3.3; // Shannon entropy threshold — filters out low-randomness strings (words, paths, repeated chars)

function shannonEntropy(str) {
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  let entropy = 0;
  const len = str.length;
  for (const ch in freq) {
    const p = freq[ch] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function contextSnippet(fullText, matchIndex, matchLength, pad = 40) {
  const start = Math.max(0, matchIndex - pad);
  const end = Math.min(fullText.length, matchIndex + matchLength + pad);
  let snippet = fullText.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < fullText.length) snippet = snippet + "…";
  return snippet;
}

function runNamedRules(text, source) {
  const found = [];
  for (const rule of NAMED_RULES) {
    rule.regex.lastIndex = 0;
    let m;
    const seen = new Set();
    while ((m = rule.regex.exec(text)) !== null) {
      const value = m[1] || m[0];
      if (seen.has(value)) continue;
      seen.add(value);
      found.push({
        type: rule.id,
        severity: rule.severity,
        value: value,
        context: contextSnippet(text, m.index, m[0].length),
        source: source,
        verifyNote: VERIFY_NOTES[rule.id] || null,
      });
      if (m[0].length === 0) rule.regex.lastIndex++; // avoid infinite loop on zero-length matches
    }
  }
  return found;
}

function runGenericDetector(text, source) {
  const found = [];
  const seen = new Set();
  let m;
  GENERIC_KEYWORD_REGEX.lastIndex = 0;
  while ((m = GENERIC_KEYWORD_REGEX.exec(text)) !== null) {
    const keyword = m[1];
    const value = m[2];
    if (seen.has(value)) continue;
    const entropy = shannonEntropy(value);
    if (entropy >= MIN_ENTROPY) {
      seen.add(value);
      found.push({
        type: `Generic High-Entropy Secret (keyword: ${keyword})`,
        severity: "Medium",
        value: value,
        context: contextSnippet(text, m.index, m[0].length),
        source: source,
        verifyNote: null,
      });
    }
  }
  return found;
}

function dedupeFindings(findings) {
  const seen = new Set();
  const out = [];
  findings.forEach((f) => {
    const key = f.type + "::" + f.value;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  });
  return out;
}

// Node/content-script (CommonJS-free) export shim — harmless in both browser contexts.
if (typeof module !== "undefined") {
  module.exports = { NAMED_RULES, VERIFY_NOTES, runNamedRules, runGenericDetector, dedupeFindings, shannonEntropy, contextSnippet };
}
