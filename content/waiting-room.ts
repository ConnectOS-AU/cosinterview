// Marketing content shown to candidates while they wait in the lobby (and
// before the room opens). Edit freely - this is the only file marketing needs
// to touch. Placeholder copy is marked; replace it before go-live.

export type WaitingRoomContent = {
  headline: string;
  intro: string;
  highlights: { title: string; body: string }[];
  videoUrl: string | null; // optional YouTube/Vimeo embed URL, e.g. https://www.youtube.com/embed/<id>
  tips: string[];
  cta: { label: string; href: string } | null;
};

export const waitingRoomContent: WaitingRoomContent = {
  headline: "Get to know ConnectOS",
  // PLACEHOLDER - replace with approved marketing copy.
  intro:
    "ConnectOS connects talented Filipino professionals with growing businesses around the world. Here's a little about what it's like to work with us.",
  highlights: [
    // PLACEHOLDER - replace with approved highlights (culture, benefits, growth, awards).
    { title: "Our people", body: "Add a short line about ConnectOS culture and team." },
    { title: "Your growth", body: "Add a short line about training, career paths and support." },
    { title: "Our clients", body: "Add a short line about the kinds of businesses our team works with." },
  ],
  videoUrl: null,
  tips: [
    "Check your camera and microphone are allowed when your browser asks.",
    "Find a quiet spot with good lighting and a stable internet connection.",
    "Have a copy of your CV handy in case you'd like to refer to it.",
  ],
  cta: { label: "Visit connectos.co", href: "https://connectos.co" },
};
