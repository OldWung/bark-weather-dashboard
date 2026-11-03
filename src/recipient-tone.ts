export const recipientToneLabels = {
  romantic: "恋人·情话",
  warm: "家人·温暖",
  concise: "朋友·简洁",
} as const;

export type RecipientTone = keyof typeof recipientToneLabels;

export function normalizeRecipientTone(value: unknown): RecipientTone {
  if (value === "warm" || value === "concise") return value;
  return "romantic";
}
