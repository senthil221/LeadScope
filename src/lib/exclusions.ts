import { canonicalLinkedIn } from "./urls";

export function parseExcludedUrls(text: string) {
  const tokens = text.split(/[\s,;]+/u).filter(Boolean);
  const urls = new Set<string>();
  const invalid: string[] = [];
  let duplicates = 0;
  for (const token of tokens) {
    const value = token.replace(/^["']|["']$/g, "");
    const withScheme = /^(?:www\.|[a-z]{2}\.)?linkedin\.com\//i.test(value)
      ? `https://${value}`
      : value;
    const url = canonicalLinkedIn(withScheme);
    if (!url) invalid.push(token);
    else if (urls.has(url)) duplicates++;
    else urls.add(url);
  }
  return { urls: [...urls], invalid, duplicates };
}
