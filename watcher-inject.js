// Site Leak Radar — Behavior Watcher (page-context injector)
// Runs in the MAIN world (shares window.fetch/XHR with the actual page) so it
// sees real traffic the page generates during normal use. It never fires a
// request of its own — it wraps the page's own fetch/XHR, timestamps what
// already happened, and hands a lightweight summary across to the isolated-
// world content script via a CustomEvent on window (chrome.runtime isn't
// reachable from the MAIN world directly).

(function () {
  if (window.__slrWatcherInstalled) return;
  window.__slrWatcherInstalled = true;

  const EVENT_NAME = "slr:behavior-entry";
  const MAX_BODY_SNIPPET = 2000;

  function safeHeadersToObject(headers) {
    const out = {};
    try {
      headers.forEach((v, k) => { out[k] = v; });
    } catch (e) {}
    return out;
  }

  function emit(entry) {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: entry }));
    } catch (e) {
      // detail must be structured-cloneable; drop this one rather than throw
      // inside the page's own code.
    }
  }

  // ---- fetch ----
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const start = performance.now();
      let url, method;
      try {
        url = typeof input === "string" ? input : input.url;
        method = (init && init.method) || (typeof input === "object" && input.method) || "GET";
      } catch (e) {
        url = String(input);
        method = "GET";
      }

      return origFetch.apply(this, arguments).then((res) => {
        const time = Math.round(performance.now() - start);
        // Clone so reading the body here never affects what the page sees.
        res
          .clone()
          .text()
          .then((text) => {
            emit({
              via: "fetch",
              url,
              method: method.toUpperCase(),
              status: res.status,
              ok: res.ok,
              responseHeaders: safeHeadersToObject(res.headers),
              bodySnippet: (text || "").slice(0, MAX_BODY_SNIPPET),
              bodyLength: (text || "").length,
              time,
              at: Date.now(),
            });
          })
          .catch(() => {
            emit({
              via: "fetch",
              url,
              method: method.toUpperCase(),
              status: res.status,
              ok: res.ok,
              responseHeaders: safeHeadersToObject(res.headers),
              bodySnippet: "",
              bodyLength: 0,
              time,
              at: Date.now(),
            });
          });
        return res;
      });
    };
  }

  // ---- XMLHttpRequest ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__slrMethod = method;
    this.__slrUrl = url;
    this.__slrStart = null;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.__slrStart = performance.now();
    this.addEventListener("loadend", () => {
      const time = this.__slrStart ? Math.round(performance.now() - this.__slrStart) : null;
      let headersObj = {};
      try {
        this.getAllResponseHeaders()
          .trim()
          .split(/[\r\n]+/)
          .forEach((line) => {
            const idx = line.indexOf(":");
            if (idx > -1) headersObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          });
      } catch (e) {}

      let bodySnippet = "";
      try {
        if (typeof this.responseText === "string") bodySnippet = this.responseText.slice(0, MAX_BODY_SNIPPET);
      } catch (e) {}

      emit({
        via: "xhr",
        url: this.__slrUrl,
        method: (this.__slrMethod || "GET").toUpperCase(),
        status: this.status,
        ok: this.status >= 200 && this.status < 300,
        responseHeaders: headersObj,
        bodySnippet,
        bodyLength: bodySnippet.length,
        time,
        at: Date.now(),
      });
    });
    return origSend.apply(this, arguments);
  };
})();
