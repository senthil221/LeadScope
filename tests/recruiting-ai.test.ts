import { describe, expect, it } from "vitest";
import { validateAiSuggestions } from "../src/lib/server/recruiting-ai";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";

describe("AI recruiting review response validation", () => {
  it("requires one bounded score for each candidate in the submitted group", () => {
    expect(
      validateAiSuggestions(
        JSON.stringify({
          suggestions: [
            { id: first, rating: 4, rationale: "Relevant platform engineering experience." },
            { id: second, rating: 2, rationale: "Limited role-specific evidence." },
          ],
        }),
        [first, second],
      ),
    ).toHaveLength(2);
  });

  it("rejects partial or substituted candidate results", () => {
    expect(() =>
      validateAiSuggestions(
        JSON.stringify({
          suggestions: [
            { id: first, rating: 4, rationale: "Relevant experience." },
          ],
        }),
        [first, second],
      ),
    ).toThrow("every selected candidate");
  });
});
