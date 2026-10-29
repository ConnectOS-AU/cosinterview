// What candidates see while they wait in the lobby (and before the room opens).
// Admins edit it at /r/admin/lobby; this is the starting point until they save,
// and what "Reset to default" goes back to.

export type WaitingRoomContent = {
  headline: string;
  // Rich text from the admin editor. Always sanitised before it's stored or shown.
  bodyHtml: string;
  videoUrl: string | null; // YouTube/Vimeo embed URL, e.g. https://www.youtube.com/embed/<id>
  tips: string[];
  cta: { label: string; href: string } | null;
};

export const defaultWaitingRoomContent: WaitingRoomContent = {
  headline: "Get to know ConnectOS",
  bodyHtml: [
    "<p>ConnectOS connects talented Filipino professionals with growing businesses around the world. Here's a little about what it's like to work with us.</p>",
    "<h3>Our people</h3><p>Add a short line about ConnectOS culture and team.</p>",
    "<h3>Your growth</h3><p>Add a short line about training, career paths and support.</p>",
    "<h3>Our clients</h3><p>Add a short line about the kinds of businesses our team works with.</p>",
  ].join(""),
  videoUrl: null,
  tips: [
    "Check your camera and microphone are allowed when your browser asks.",
    "Find a quiet spot with good lighting and a stable internet connection.",
    "Have a copy of your CV handy in case you'd like to refer to it.",
  ],
  cta: { label: "Visit connectos.co", href: "https://connectos.co" },
};
