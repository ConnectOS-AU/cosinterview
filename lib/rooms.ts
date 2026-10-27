import "server-only";
import { dailyConfigured, ensureInterviewRoom } from "./daily";
import { saveRoom } from "./repo";
import type { InviteRecord } from "./types";

// The Daily room for a booking, created on first need (at booking, or when
// either side joins if that failed). null without Daily credentials (local dev).
export async function roomForBooking(invite: InviteRecord): Promise<{ name: string; url: string } | null> {
  if (invite.dailyRoomUrl && invite.dailyRoomName) return { name: invite.dailyRoomName, url: invite.dailyRoomUrl };
  if (!dailyConfigured() || !invite.slotStart || !invite.slotEnd) return null;
  const room = await ensureInterviewRoom(`cosrec-${invite.bookingId}`, {
    start: invite.slotStart,
    end: invite.slotEnd,
  });
  await saveRoom(invite.bookingId, room);
  return room;
}
