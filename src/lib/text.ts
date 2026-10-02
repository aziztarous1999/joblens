/**
 * Safety net for the plain-text cover letter, applied to the full text: replaces em/en dashes
 * used as punctuation and strips markdown the model may still add.
 */
export function toPlainLetter(text: string): string {
  return text
    .replace(/[ \t]*[—–][ \t]*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\n)#{1,6}[ \t]+/g, "$1")
    .replace(/(^|\n)[ \t]*[-*•][ \t]+/g, "$1");
}
