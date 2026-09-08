export function canonicalLinkedIn(input: string): string | null {
  try {
    const url = new URL(input);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    if (!/^(?:www\.|[a-z]{2}\.)?linkedin\.com$/i.test(url.hostname))
      return null;
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/);
    if (!match) return null;
    const slug = decodeURIComponent(match[1]);
    if (
      !slug.trim() ||
      /[\s/\\?#\u0000-\u001f]/u.test(slug) ||
      slug === "." ||
      slug === ".."
    )
      return null;
    return `https://www.linkedin.com/in/${match[1]}`;
  } catch {
    return null;
  }
}
