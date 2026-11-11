// Behavior Watcher storage + baseline/diff engine (slrRecordObservation,
// slrGetAnomalies, slrClearAnomalies). Classic service worker, so a plain
// importScripts rather than an ES module import.
importScripts("watcher-store.js");

// Apply rules when the browser starts or extension is installed
chrome.runtime.onStartup.addListener(loadAndApplyRules);
chrome.runtime.onInstalled.addListener(loadAndApplyRules);

// Re-apply rules instantly if the user saves changes in the popup
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.customHeaders) {
        applyHeaderRules(changes.customHeaders.newValue);
    }
});

function loadAndApplyRules() {
    chrome.storage.local.get(['customHeaders'], (result) => {
        if (result.customHeaders) {
            applyHeaderRules(result.customHeaders);
        }
    });
}

function applyHeaderRules(headersArray) {
    // Filter for headers that are checked and actually have text
    const activeHeaders = headersArray.filter(h => h.active && h.name && h.value);

    const requestHeaders = activeHeaders.map(h => ({
        header: h.name,
        operation: "set",
        value: h.value
    }));

    // Package them into a single dynamic rule
    const addRules = requestHeaders.length > 0 ? [{
        id: 1,
        priority: 1,
        action: {
            type: "modifyHeaders",
            requestHeaders: requestHeaders
        },
        condition: {
            urlFilter: "*",
            resourceTypes: ["main_frame", "xmlhttprequest", "script", "stylesheet", "image", "font", "other"]
        }
    }] : [];

    // Remove the old rule (ID: 1) and apply the new one
    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1],
        addRules: addRules
    }, () => {
        console.log("Site Leak Radar: Headers updated.", requestHeaders);
    });
}

// ---- Behavior Watcher message handling ----
// content.js relays each observed fetch/XHR pair here (it never generates
// new traffic itself); this is where the baseline/diff logic and the
// IndexedDB storage from watcher-store.js actually run.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "behaviorEntry") {
        slrRecordObservation(request.entry, request.pageUrl).catch((e) => {
            console.warn("Site Leak Radar: behavior observation failed to record.", e);
        });
        return false; // fire-and-forget, no response needed
    }
    if (request.action === "getBehaviorAnomalies") {
        slrGetAnomalies(request.limit || 100).then((anomalies) => sendResponse({ anomalies }));
        return true; // keep the message channel open for the async response
    }
    if (request.action === "clearBehaviorAnomalies") {
        slrClearAnomalies().then(() => sendResponse({ ok: true }));
        return true;
    }
});
