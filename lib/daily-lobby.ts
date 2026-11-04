import type { DailyCall } from "@daily-co/daily-js";

export type AdmissionState = "lobby" | "in_call" | "denied" | "error";

// Follows someone through Daily's lobby. The video frame runs Daily's own
// screens: the person presses "Request to join" there and the recruiter presses
// Allow or Deny there, so those screens must stay visible and clickable.
// join() can't be used to tell who is in: it finishes as soon as they knock.
export function followAdmission(call: DailyCall, onChange: (state: AdmissionState) => void) {
  call.on("access-state-updated", (e) => {
    if (!e || e.access === "unknown") return;
    if (e.access.level === "full") onChange("in_call");
    else if (e.access.level === "lobby") onChange("lobby");
  });
  call.on("error", (e) => onChange(/rejected/i.test(e?.errorMsg ?? "") ? "denied" : "error"));
}
