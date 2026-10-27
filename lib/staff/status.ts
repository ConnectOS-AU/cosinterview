import type { BookingStatus } from "../types";

// Badge labels and colours, in COScomms' status-badge style.
export const STATUS_BADGE: Record<BookingStatus, { label: string; className: string }> = {
  invited: { label: "Awaiting booking", className: "bg-neutral-100 text-neutral-700" },
  booked: { label: "Booked", className: "bg-blue-100 text-blue-800" },
  in_progress: { label: "In progress", className: "bg-amber-100 text-amber-800" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800" },
  no_show: { label: "No show", className: "bg-red-100 text-red-800" },
  cancelled: { label: "Cancelled", className: "bg-neutral-100 text-neutral-500" },
};
