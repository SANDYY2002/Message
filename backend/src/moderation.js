// Conservative review queue, not a claim of complete language understanding.
const phrases = [
  "fuck",
  "fucking",
  "motherfucker",
  "bitch",
  "cunt",
  "kill yourself",
  "rape you",
  "randi",
  "randi ko",
  "chikne",
  "muji",
  "machikne",
  "madarchod",
  "bhenchod",
  "रन्डी",
  "रण्डी",
  "मुजी",
  "चिक्ने",
  "मादरचोद",
];
export function needsReview(text) {
  const s = String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ");
  return phrases.some((p) =>
    new RegExp(
      `(^|[^\\p{L}\\p{M}\\p{N}])${p}($|[^\\p{L}\\p{M}\\p{N}])`,
      "u",
    ).test(s),
  );
}
