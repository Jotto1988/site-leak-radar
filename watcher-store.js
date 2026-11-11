// Site Leak Radar — Behavior Watcher storage + baseline/diff engine.
// Lives in IndexedDB (not chrome.storage) because this log is meant to grow
// across an entire session, possibly across days if a target tab is left
// open. Observations are grouped by a normalized endpoint key (method + path
// shape, with IDs/UUIDs collapsed to {id}, so /api/orders/482 and
// /api/orders/991 count as "the same endpoint" for baseline purposes). A
// running baseline is built per key, and anything that contradicts it gets
// flagged — not anything new, just anything inconsistent.

const SLR_DB_NAME = "slr-behavior-watcher";
const SLR_DB_VERSION = 1;
const MIN_SAMPLES_BEFORE_FLAGGING = 3;
const LATENCY_HISTORY_CAP = 50;

function slrOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SLR_DB_NAME, SLR_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("baselines")) {
        db.createObjectStore("baselines", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("anomalies")) {
        const store = db.createObjectStore("anomalies", { keyPath: "id", autoIncrement: true });
        store.createIndex("by_time", "at");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Collapses numeric IDs, UUIDs, and long opaque tokens in a path to {id} so
// differently-targeted calls to the same route key the same baseline.
function slrNormalizePath(pathname) {
  return pathname
    .split("/")
    .map((seg) => {
      if (/^[0-9]+$/.test(seg)) return "{id}";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return "{id}";
      if (/^[A-Za-z0-9_-]{20,}$/.test(seg)) return "{id}";
      return seg;
    })
    .join("/");
}

function slrEndpointKey(method, urlStr) {
  try {
    const u = new URL(urlStr);
    const paramNames = [...u.searchParams.keys()].sort().join(",");
    return `${method} ${u.origin}${slrNormalizePath(u.pathname)}${paramNames ? "?" + paramNames : ""}`;
  } catch (e) {
    return `${method} ${urlStr}`;
  }
}

function slrTopLevelKeys(bodySnippet) {
  try {
    const parsed = JSON.parse(bodySnippet);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed);
    }
  } catch (e) {
    // Not JSON, or truncated mid-object — not scored for field drift.
  }
  return null;
}

const SLR_ERROR_PATTERNS = [
  /Traceback \(most recent call last\)/i,
  /at \S+\.\S+ \(\S+:\d+:\d+\)/, // JS stack frame shape
  /Exception in thread/i,
  /\/(home|var|usr|opt)\/[\w./-]+/, // leaked server filesystem path
  /org\.(springframework|apache|hibernate)\./, // Java framework internals
  /System\.(Web|Data)\./, // .NET internals
];

function slrLooksLikeVerboseError(bodySnippet) {
  return SLR_ERROR_PATTERNS.some((re) => re.test(bodySnippet || ""));
}

async function slrRecordObservation(entry, pageUrl) {
  if (!entry || !entry.url) return;
  const key = slrEndpointKey(entry.method, entry.url);
  const db = await slrOpenDb();

  const tx = db.transaction(["baselines", "anomalies"], "readwrite");
  const baselineStore = tx.objectStore("baselines");
  const anomalyStore = tx.objectStore("anomalies");

  const existing = await new Promise((resolve) => {
    const r = baselineStore.get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => resolve(null);
  });

  const fieldKeys = slrTopLevelKeys(entry.bodySnippet);
  const verboseError = slrLooksLikeVerboseError(entry.bodySnippet);

  if (!existing) {
    baselineStore.put({
      key,
      sampleCount: 1,
      statusSet: [entry.status],
      fieldUnion: fieldKeys || [],
      latencies: entry.time != null ? [entry.time] : [],
      sawVerboseError: verboseError,
      lastSeen: entry.at,
    });
    return; // first sample — nothing to diff against yet.
  }

  const anomalies = [];

  if (existing.sampleCount >= MIN_SAMPLES_BEFORE_FLAGGING) {
    // Status drift: same endpoint shape, success/failure class disagrees.
    const priorClasses = new Set(existing.statusSet.map((s) => Math.floor(s / 100)));
    const thisClass = Math.floor(entry.status / 100);
    if (!priorClasses.has(thisClass) && (priorClasses.has(2) || thisClass === 2)) {
      anomalies.push({
        kind: "status-drift",
        detail: `Previously saw status class(es) ${[...priorClasses].map((c) => c + "xx").join(",")}, now got ${entry.status}.`,
      });
    }

    // Field drift: a field that used to be there (or wasn't) flips.
    if (fieldKeys && existing.fieldUnion.length > 0) {
      const missingNow = existing.fieldUnion.filter((f) => !fieldKeys.includes(f));
      const newField = fieldKeys.filter((f) => !existing.fieldUnion.includes(f));
      if (missingNow.length > 0) {
        anomalies.push({ kind: "field-drift", detail: `Field(s) previously present now missing: ${missingNow.join(", ")}` });
      }
      if (newField.length > 0) {
        anomalies.push({ kind: "field-drift", detail: `New field(s) not seen before: ${newField.join(", ")}` });
      }
    }

    // Latency drift: meaningfully slower than the running baseline.
    if (existing.latencies.length >= MIN_SAMPLES_BEFORE_FLAGGING && entry.time != null) {
      const mean = existing.latencies.reduce((a, b) => a + b, 0) / existing.latencies.length;
      if (entry.time > Math.max(300, mean * 3)) {
        anomalies.push({
          kind: "latency-drift",
          detail: `This call took ${entry.time}ms vs a running average of ${Math.round(mean)}ms.`,
        });
      }
    }

    // Verbose error surfaced where it never did before.
    if (verboseError && !existing.sawVerboseError) {
      anomalies.push({
        kind: "verbose-error",
        detail: "Response body now contains what looks like a stack trace / internal path, not seen on this endpoint before.",
      });
    }
  }

  // Update the baseline regardless of whether this sample was flagged.
  baselineStore.put({
    key,
    sampleCount: existing.sampleCount + 1,
    statusSet: [...new Set([...existing.statusSet, entry.status])].slice(-10),
    fieldUnion: fieldKeys ? [...new Set([...existing.fieldUnion, ...fieldKeys])] : existing.fieldUnion,
    latencies: entry.time != null ? [...existing.latencies, entry.time].slice(-LATENCY_HISTORY_CAP) : existing.latencies,
    sawVerboseError: existing.sawVerboseError || verboseError,
    lastSeen: entry.at,
  });

  if (anomalies.length > 0) {
    anomalyStore.add({
      key,
      pageUrl,
      entry,
      anomalies,
      at: entry.at,
    });
  }
}

async function slrGetAnomalies(limit = 100) {
  const db = await slrOpenDb();
  return new Promise((resolve) => {
    const tx = db.transaction(["anomalies"], "readonly");
    const store = tx.objectStore("anomalies");
    const idx = store.index("by_time");
    const out = [];
    const req = idx.openCursor(null, "prev"); // newest first
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && out.length < limit) {
        out.push(cursor.value);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => resolve(out);
  });
}

async function slrClearAnomalies() {
  const db = await slrOpenDb();
  return new Promise((resolve) => {
    const tx = db.transaction(["anomalies"], "readwrite");
    tx.objectStore("anomalies").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
