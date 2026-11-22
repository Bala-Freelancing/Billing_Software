// Module 12: free reply templates for Google reviews (no AI). 4–5 stars get a
// ready thank-you; 3 stars and below are left to the owner to answer personally.

export type ReplyLanguage = "en" | "ta";

const THANKS: Record<ReplyLanguage, string[]> = {
  en: [
    "Thank you {name} for the {stars}-star rating! We're glad you're happy with {shop}. Do visit us again.",
    "Thanks a lot, {name}! Your {stars}-star review means a lot to the {shop} team. See you again soon.",
    "Thank you for your kind words, {name}. It was a pleasure serving you at {shop}.",
  ],
  ta: [
    "{name}, உங்கள் {stars} நட்சத்திர மதிப்பீட்டிற்கு மிக்க நன்றி! {shop} உங்களை மீண்டும் வரவேற்கிறது.",
    "மிக்க நன்றி {name}! உங்கள் ஆதரவுக்கு {shop} குழுவின் நன்றிகள். மீண்டும் வாருங்கள்.",
  ],
};

/** Number of ready-made wordings for a language (to rotate so replies don't all look the same). */
export const variantCount = (lang: ReplyLanguage) => THANKS[lang].length;

/**
 * A ready reply for a review, or null when the owner should write it (3 stars or fewer).
 * `variant` picks one of the wordings, wrapping around.
 */
export function draftReply(stars: number, name: string, shop: string, lang: ReplyLanguage = "en", variant = 0): string | null {
  if (stars < 4) return null;
  const list = THANKS[lang];
  const who = name.trim() || (lang === "ta" ? "நண்பரே" : "friend");
  return (list[((variant % list.length) + list.length) % list.length] ?? "")
    .replaceAll("{name}", who)
    .replaceAll("{stars}", String(stars))
    .replaceAll("{shop}", shop);
}
