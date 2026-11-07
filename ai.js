// ===== Site Leak Radar — AI triage seam (stub, not wired to anything yet) =====
//
// Purpose: every finding — from the page scan, the deep scan, or the
// Repeater/Intruder sweep — flows through classifyFinding() exactly once,
// right before it's rendered. Today that function is a no-op passthrough.
// When a GCP/Gemini (or any other) key gets added later, the only change
// needed is inside classifyFinding() itself: call out, map the response onto
// aiVerdict/aiNote, done. No changes needed anywhere else — popup.js, the
// render functions, and the evidence-copy text already know how to show
// these fields when they're non-null, and just omit them when they're null.
//
// Expected return shape (always the original finding, plus two fields):
//   {
//     ...finding,
//     aiVerdict: "likely-finding" | "likely-false-positive" | null,
//     aiNote:    "<one-line reasoning, suitable to paste into a report>" | null,
//   }
//
// Design intent for when this gets wired up: classifyFinding should judge a
// finding against the *scope/exclusion language already available* (named
// patterns like Stripe publishable keys, OAuth client IDs, widget
// fingerprints) rather than guessing generically — the same judgment calls
// made by hand all session (Weglot, GitBook viewer JWTs, Intercom, Apigee
// errors, etc.) are exactly the training signal this should encode.

const AI_ENABLED = false; // flip to true once classifyFinding() actually calls out somewhere

async function classifyFinding(finding) {
  if (!AI_ENABLED) {
    return { ...finding, aiVerdict: null, aiNote: null };
  }

  // ---- Future wiring goes here ----
  // Example shape once a key exists (left unimplemented on purpose):
  //
  //   const res = await fetch(AI_ENDPOINT, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ finding }),
  //   });
  //   const { verdict, note } = await res.json();
  //   return { ...finding, aiVerdict: verdict, aiNote: note };

  return { ...finding, aiVerdict: null, aiNote: null };
}

// Batch helper — classifies a whole findings array and preserves order.
// popup.js uses this one call site; nothing else needs to change when
// classifyFinding grows a real implementation.
async function classifyFindings(findings) {
  return Promise.all(findings.map(classifyFinding));
}

if (typeof module !== "undefined") {
  module.exports = { classifyFinding, classifyFindings, AI_ENABLED };
}
