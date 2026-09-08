import { describe, expect, it } from "vitest";
import { parseExcludedUrls } from "../src/lib/exclusions";
describe("pasted client blocklist", () => {
  it("normalizes pasted columns and skips repeated profile URLs", () => {
    const result = parseExcludedUrls(
      "https://in.linkedin.com/in/example/?trk=search\nhttps://www.linkedin.com/in/example#about\tlinkedin.com/in/second",
    );
    expect(result).toEqual({
      urls: [
        "https://www.linkedin.com/in/example",
        "https://www.linkedin.com/in/second",
      ],
      duplicates: 1,
      invalid: [],
    });
  });
  it("reports invalid entries without silently dropping them", () => {
    const result = parseExcludedUrls(
      "https://linkedin.com/company/test,https://evil.example/in/person\nnot-a-url",
    );
    expect(result.urls).toEqual([]);
    expect(result.invalid).toHaveLength(3);
  });
  it("supports quotes, blank lines and comma-separated URLs", () => {
    expect(
      parseExcludedUrls(
        '  "https://www.linkedin.com/in/one",\n\nhttps://linkedin.com/in/two; ',
      ).urls,
    ).toHaveLength(2);
    expect(parseExcludedUrls(" \n ").urls).toEqual([]);
  });
});
