/**
 * For display of user-entered notes/descriptions: capitalizes the first letter
 * of each sentence (after . ! ? or newline) without changing stored data.
 */
export function capitalizeSentencesForUi(text: string): string {
  if (!text) return text;
  let s = text;
  s = s.replace(/^[a-z]/, (c) => c.toUpperCase());
  s = s.replace(/([.!?])\s+([a-z])/g, (_, punct: string, letter: string) => `${punct} ${letter.toUpperCase()}`);
  s = s.replace(/\n(\s*)([a-z])/g, (_, spaces: string, letter: string) => `\n${spaces}${letter.toUpperCase()}`);
  return s;
}
