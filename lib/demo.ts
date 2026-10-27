import "server-only";
import { DateTime } from "luxon";
import type { InviteRecord } from "./types";

// A local-only sample invite so the portal can be clicked through without
// Supabase, Graph or Daily credentials: /c/demo/demo. It is never served in
// production. State lives on globalThis so it survives dev hot reloads.
export const DEMO_BOOKING_ID = "demo-booking";

export function isDemoInvite(slug: string, token: string): boolean {
  return process.env.NODE_ENV !== "production" && slug === "demo" && token === "demo";
}

type DemoStore = { invite: InviteRecord };
const store = globalThis as typeof globalThis & { __cosrecDemo?: DemoStore };

export function demoInvite(): InviteRecord {
  if (!store.__cosrecDemo) {
    store.__cosrecDemo = {
      invite: {
        bookingId: DEMO_BOOKING_ID,
        status: "invited",
        candidateName: "Maria Santos",
        candidateEmail: "maria.santos@example.com",
        candidateTimezone: null,
        slotStart: null,
        slotEnd: null,
        inviteExpiresAt: DateTime.utc().plus({ days: 14 }).toISO(),
        dailyRoomName: null,
        dailyRoomUrl: null,
        graphEventId: null,
        interview: {
          id: "demo-interview",
          jobTitle: "Customer Support Specialist",
          clientName: "Sample Client",
          durationMins: 30,
          status: "open",
        },
        recruiter: {
          id: "demo-recruiter",
          slug: "demo",
          displayName: "Rei Agustin",
          title: "Talent Acquisition Specialist",
          photoPath: null,
          bio: "I've helped hundreds of Filipino professionals start rewarding careers with Australian and US businesses.",
          welcomeMessage:
            "Hi! Thanks for your interest in this role. Pick a time that suits you and I'll look forward to meeting you.",
          timezone: "Asia/Manila",
          calendarEmail: "demo@connectos.co",
          active: true,
        },
      },
    };
  }
  return store.__cosrecDemo.invite;
}

export function updateDemoInvite(fields: Partial<InviteRecord>): void {
  Object.assign(demoInvite(), fields);
}

// Lets you replay the demo: /c/demo/demo?reset=1
export function resetDemoInvite(): void {
  delete store.__cosrecDemo;
}
