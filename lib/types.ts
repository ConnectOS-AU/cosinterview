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
  slotStart: string | null;
  slotEnd: string | null;
  inviteExpiresAt: string | null;
  dailyRoomName: string | null;
  dailyRoomUrl: string | null;
  graphEventId: string | null;
  interview: {
    id: string;
    jobTitle: string | null;
    clientName: string | null;
    durationMins: number;
    status: "open" | "closed";
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
