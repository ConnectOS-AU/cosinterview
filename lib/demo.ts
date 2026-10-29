import "server-only";
import { DateTime } from "luxon";
import type {
  InterviewNote,
  InterviewRound,
  InviteRecord,
  JobAdderApplication,
  JobAdderJob,
  RecruiterProfile,
} from "./types";

// Local-only sample data so the portal and recruiter screens can be clicked
// through without Supabase, Graph or Daily credentials. Used whenever Supabase
// isn't configured, and never in production. State lives on globalThis so it
// survives dev hot reloads.
//
// - Candidate: /c/demo/demo (?reset=1 starts again)
// - Recruiter: /r (signed in as the demo recruiter)
export const DEMO_BOOKING_ID = "demo-booking";
export const DEMO_RECRUITER_ID = "demo-recruiter";

export function demoMode(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function isDemoInvite(slug: string, token: string): boolean {
  return demoMode() && slug === "demo" && token === "demo";
}

type DemoInvite = InviteRecord & {
  tokenHash: string | null;
  // Reminder bookkeeping (columns on cos_recruitment_bookings in production).
  bookedAt?: string | null;
  linkToken?: string | null;
  reminder24hSentAt?: string | null;
  reminder2hSentAt?: string | null;
};

type DemoStore = {
  recruiter: RecruiterProfile;
  // Everyone else on the admin page.
  otherRecruiters: RecruiterProfile[];
  interviews: InterviewRound[];
  invites: DemoInvite[];
  notes: Map<string, InterviewNote[]>;
  nextId: number;
};

const globalStore = globalThis as typeof globalThis & { __cosrecDemo?: DemoStore };

function seed(): DemoStore {
  const recruiter: RecruiterProfile = {
    id: DEMO_RECRUITER_ID,
    userId: null,
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
    isAdmin: true,
  };
  const interview: InterviewRound = {
    id: "demo-interview",
    recruiterId: recruiter.id,
    jobadderJobId: "1001",
    jobTitle: "Customer Support Specialist",
    clientName: "Sample Client",
    durationMins: 30,
    status: "open",
    createdAt: DateTime.utc().toISO()!,
  };
  return {
    recruiter,
    otherRecruiters: [
      {
        ...recruiter,
        id: "demo-recruiter-2",
        slug: "jasmine-cruz",
        displayName: "Jasmine Cruz",
        title: "Recruitment Consultant",
        bio: null,
        welcomeMessage: null,
        calendarEmail: "jasmine.cruz@connectos.co",
        isAdmin: false,
      },
    ],
    interviews: [interview],
    invites: [
      {
        ...inviteFor(recruiter, interview, {
          bookingId: DEMO_BOOKING_ID,
          candidateId: "5001",
          applicationId: "9001",
          name: "Maria Santos",
          email: "maria.santos@example.com",
          expiresAt: DateTime.utc().plus({ days: 14 }).toISO()!,
        }),
        tokenHash: null,
      },
    ],
    notes: new Map(),
    nextId: 1,
  };
}

export function demoStore(): DemoStore {
  return (globalStore.__cosrecDemo ??= seed());
}

export function demoId(prefix: string): string {
  return `${prefix}-${demoStore().nextId++}`;
}

// Builds the InviteRecord shape from the current recruiter + interview, so the
// candidate portal sees profile edits straight away.
export function inviteFor(
  recruiter: RecruiterProfile,
  interview: InterviewRound,
  c: { bookingId: string; candidateId: string; applicationId: string | null; name: string; email: string; expiresAt: string },
): InviteRecord {
  return {
    bookingId: c.bookingId,
    status: "invited",
    candidateName: c.name,
    candidateEmail: c.email,
    candidateTimezone: null,
    jobadderCandidateId: c.candidateId,
    jobadderApplicationId: c.applicationId,
    slotStart: null,
    slotEnd: null,
    inviteExpiresAt: c.expiresAt,
    dailyRoomName: null,
    dailyRoomUrl: null,
    graphEventId: null,
    interview: {
      id: interview.id,
      jobadderJobId: interview.jobadderJobId,
      jobTitle: interview.jobTitle,
      clientName: interview.clientName,
      durationMins: interview.durationMins,
      status: interview.status,
    },
    recruiter: {
      id: recruiter.id,
      slug: recruiter.slug,
      displayName: recruiter.displayName,
      title: recruiter.title,
      photoPath: recruiter.photoPath,
      bio: recruiter.bio,
      welcomeMessage: recruiter.welcomeMessage,
      timezone: recruiter.timezone,
      calendarEmail: recruiter.calendarEmail,
      active: recruiter.active,
    },
  };
}

// The signed-in demo recruiter first, then everyone else.
export function demoRecruiters(): RecruiterProfile[] {
  const store = demoStore();
  return [store.recruiter, ...store.otherRecruiters];
}

// Invites always reflect the latest recruiter profile.
export function demoInvites(): DemoInvite[] {
  const { invites } = demoStore();
  const recruiters = demoRecruiters();
  for (const invite of invites) {
    const recruiter = recruiters.find((r) => r.id === invite.recruiter.id);
    if (!recruiter) continue;
    Object.assign(invite.recruiter, {
      displayName: recruiter.displayName,
      title: recruiter.title,
      photoPath: recruiter.photoPath,
      bio: recruiter.bio,
      welcomeMessage: recruiter.welcomeMessage,
      timezone: recruiter.timezone,
    });
  }
  return invites;
}

export function demoInviteById(bookingId: string): DemoInvite | null {
  return demoInvites().find((i) => i.bookingId === bookingId) ?? null;
}

export function updateDemoInvite(bookingId: string, fields: Partial<InviteRecord>): void {
  const invite = demoInviteById(bookingId);
  if (invite) Object.assign(invite, fields);
}

// Lets you replay the demo: /c/demo/demo?reset=1
export function resetDemo(): void {
  delete globalStore.__cosrecDemo;
}

// Sample JobAdder data for the new-interview screen.
export const DEMO_JOBS: JobAdderJob[] = [
  {
    jobId: "1001",
    title: "Customer Support Specialist",
    companyName: "Sample Client",
    ownerEmail: "demo@connectos.co",
    ownerName: "Rei Agustin",
    statusName: "Open",
    updatedAt: "2026-10-20T02:00:00Z",
  },
  {
    jobId: "1002",
    title: "Bookkeeper (Xero)",
    companyName: "Harbour Accounting",
    ownerEmail: "demo@connectos.co",
    ownerName: "Rei Agustin",
    statusName: "Open",
    updatedAt: "2026-10-24T05:30:00Z",
  },
  {
    jobId: "1003",
    title: "Virtual Assistant",
    companyName: "Northside Realty",
    ownerEmail: "someone.else@connectos.co",
    ownerName: "Ana Cruz",
    statusName: "On hold",
    updatedAt: "2026-10-10T01:00:00Z",
  },
];

export const DEMO_APPLICATIONS: Record<string, JobAdderApplication[]> = {
  "1001": [
    { applicationId: "9001", candidateId: "5001", candidateName: "Maria Santos", candidateEmail: "maria.santos@example.com", statusName: "Shortlisting", stage: "Screening", unsubscribed: false, updatedAt: "2026-10-21T00:00:00Z" },
    { applicationId: "9002", candidateId: "5002", candidateName: "Jose Reyes", candidateEmail: "jose.reyes@example.com", statusName: "Shortlisting", stage: "Screening", unsubscribed: false, updatedAt: "2026-10-22T00:00:00Z" },
    { applicationId: "9003", candidateId: "5003", candidateName: "Liza Mendoza", candidateEmail: null, statusName: "Applied", stage: "New", unsubscribed: false, updatedAt: "2026-10-23T00:00:00Z" },
  ],
  "1002": [
    { applicationId: "9101", candidateId: "5101", candidateName: "Carlo Bautista", candidateEmail: "carlo.b@example.com", statusName: "Applied", stage: "New", unsubscribed: false, updatedAt: "2026-10-25T00:00:00Z" },
    { applicationId: "9102", candidateId: "5102", candidateName: "Grace Villanueva", candidateEmail: "grace.v@example.com", statusName: "A possibility", stage: "Screening", unsubscribed: true, updatedAt: "2026-10-25T00:00:00Z" },
  ],
  "1003": [],
};
