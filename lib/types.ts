import type { Stage } from "./stages";
export type BookingStatus =
  | "invited"
  | "booked"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

// Everything the server knows about one invite. Contains internal fields
// (candidate email, recruiter calendar) - never pass this to a client component;
// use PublicRecruiter / the page's own props instead.
export type InviteRecord = {
  bookingId: string;
  status: BookingStatus;
  candidateName: string;
  candidateEmail: string;
  candidateTimezone: string | null;
  jobadderCandidateId: string;
  jobadderApplicationId: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  inviteExpiresAt: string | null;
  dailyRoomName: string | null;
  dailyRoomUrl: string | null;
  graphEventId: string | null;
  interview: {
    id: string;
    jobadderJobId: string;
    jobTitle: string | null;
    clientName: string | null;
    durationMins: number;
    status: "open" | "closed";
    stage: Stage;
  };
  recruiter: {
    id: string;
    slug: string;
    displayName: string;
    title: string | null;
    photoPath: string | null;
    bio: string | null;
    welcomeMessage: string | null;
    timezone: string;
    calendarEmail: string;
    active: boolean;
  };
};

// What the candidate is allowed to see about their recruiter.
export type PublicRecruiter = {
  displayName: string;
  firstName: string;
  title: string | null;
  photoUrl: string | null;
  bio: string | null;
  welcomeMessage: string | null;
};

export type TimeRange = { start: string; end: string };

export type RecruiterProfile = {
  id: string;
  userId: string | null;
  slug: string;
  displayName: string;
  title: string | null;
  photoPath: string | null;
  bio: string | null;
  welcomeMessage: string | null;
  timezone: string;
  calendarEmail: string;
  active: boolean;
  // Admins manage the recruiter list at /r/admin.
  isAdmin: boolean;
};

export type BookingSummary = {
  bookingId: string;
  interviewId: string;
  status: BookingStatus;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string | null;
  clientName: string | null;
  stage: Stage;
  slotStart: string | null;
  slotEnd: string | null;
  inviteExpiresAt: string | null;
};

export type InterviewNote = {
  id: string;
  body: string;
  offsetMs: number | null;
  createdAt: string;
  // Who wrote it: the recruiter, or a client attendee (shown with their name).
  authorName: string | null;
  authorKind: "recruiter" | "client" | "other";
  authorId: string;
};

export type InterviewRound = {
  id: string;
  recruiterId: string;
  jobadderJobId: string;
  jobTitle: string | null;
  clientName: string | null;
  durationMins: number;
  status: "open" | "closed";
  stage: Stage;
  createdAt: string;
};

// JobAdder data, read from the synced ja_* tables.
export type JobAdderJob = {
  jobId: string;
  title: string;
  companyName: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  statusName: string | null;
  updatedAt: string | null;
};

export type JobAdderApplication = {
  applicationId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string | null;
  statusName: string | null;
  stage: string | null;
  unsubscribed: boolean;
  updatedAt: string | null;
};

export type NewInvite = {
  candidateId: string;
  applicationId: string | null;
  name: string;
  email: string;
  tokenHash: string;
  expiresAt: string;
};
