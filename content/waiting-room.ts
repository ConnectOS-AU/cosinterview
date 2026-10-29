// What candidates see while they wait in the lobby (and before the room opens).
// Admins edit it at /r/admin/lobby; this is the starting point until they save,
// and what "Reset to default" goes back to.

export type WaitingRoomContent = {
  headline: string;
  // Rich text from the admin editor. Every *Html field is sanitised before it's
  // stored or shown (lib/lobby.ts).
  bodyHtml: string;
  videoUrl: string | null; // YouTube/Vimeo embed URL, e.g. https://www.youtube.com/embed/<id>
  // Beside the recruiter's photo while the candidate waits.
  tipsHtml: string;
  // Its own panel under the tips.
  interviewTipsTitle: string;
  interviewTipsHtml: string;
  // Link to the job description from JobAdder (shown when JobAdder has one).
  jobLinkLabel: string;
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
  tipsHtml: [
    "<ul>",
    "<li>Check your camera and microphone are allowed when your browser asks.</li>",
    "<li>Find a quiet spot with good lighting and a stable internet connection.</li>",
    "<li>Have a copy of your CV handy in case you'd like to refer to it.</li>",
    "</ul>",
  ].join(""),
  interviewTipsTitle: "Interview tips",
  interviewTipsHtml: [
    "<ul>",
    "<li><strong>Know the role:</strong> read the job description and think about how your experience fits.</li>",
    "<li><strong>Use examples:</strong> describe the situation, what you did and the result.</li>",
    "<li><strong>Bring questions:</strong> it's your chance to find out about the team and the work.</li>",
    "</ul>",
  ].join(""),
  jobLinkLabel: "Read the job description",
  cta: { label: "Visit connectos.co", href: "https://connectos.co" },
};
