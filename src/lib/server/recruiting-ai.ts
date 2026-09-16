import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { setup } from "@/lib/server/config";
import { AppError } from "@/lib/server/db";

const suggestion = z.object({
  id: z.string().uuid(),
  rating: z.number().int().min(0).max(5),
  rationale: z.string().trim().min(1).max(240),
});

const reviewResponse = z.object({ suggestions: z.array(suggestion) });

export type AiReviewCandidate = {
  id: string;
  headline: string;
  currentCompany: string;
  currentDesignation: string;
  totalExperienceYears: number | null;
};

export type AiReviewSuggestion = z.infer<typeof suggestion>;

function responseText(response: unknown) {
  const direct = z.object({ output_text: z.string().optional() }).safeParse(response);
  if (direct.success && direct.data.output_text) return direct.data.output_text;
  const nested = z
    .object({
      output: z.array(
        z.object({
          type: z.string(),
          content: z
            .array(z.object({ type: z.string(), text: z.string().optional() }))
            .optional(),
        }),
      ),
    })
    .safeParse(response);
  if (!nested.success) return null;
  return nested.data.output
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("\n");
}

export function validateAiSuggestions(text: string, candidateIds: string[]) {
  const parsed = reviewResponse.parse(JSON.parse(text));
  const expected = new Set(candidateIds);
  const received = new Set(parsed.suggestions.map((item) => item.id));
  if (
    parsed.suggestions.length !== candidateIds.length ||
    received.size !== candidateIds.length ||
    [...received].some((id) => !expected.has(id))
  )
    throw new AppError("AI review did not return a score for every selected candidate.", 502);
  return parsed.suggestions;
}

export async function reviewCandidatesWithAi({
  actorId,
  role,
  candidates,
}: {
  actorId: string;
  role: { name: string; description: string; ratingThreshold: number };
  candidates: AiReviewCandidate[];
}): Promise<AiReviewSuggestion[]> {
  const config = setup();
  if (!config.openAiApiKey)
    throw new AppError(
      "AI review is not connected. Add OPENAI_API_KEY in the server environment, then try again.",
      503,
    );

  const schema = {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            rating: { type: "integer", minimum: 0, maximum: 5 },
            rationale: { type: "string", maxLength: 240 },
          },
          required: ["id", "rating", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["suggestions"],
    additionalProperties: false,
  };
  const input = {
    role,
    candidates,
  };
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(50_000),
      body: JSON.stringify({
        model: config.openAiRecruitingModel,
        store: false,
        max_output_tokens: Math.max(220, candidates.length * 44),
        safety_identifier: createHash("sha256").update(actorId).digest("hex"),
        instructions:
          "You assist a recruiter by reviewing job-related evidence. Score fit only from the supplied role and professional profile fields. Do not use or infer protected or personal characteristics, and do not make a hiring decision. Return one 0–5 suggested rating per candidate, where 5 means strong documented alignment and 0 means no documented alignment. Keep each rationale factual, concise, and limited to the provided professional evidence.",
        input: JSON.stringify(input),
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "recruiting_review",
            strict: true,
            schema,
          },
        },
      }),
    });
  } catch {
    throw new AppError("AI review timed out. Please try a smaller group.", 504);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = z
      .object({ error: z.object({ message: z.string() }).optional() })
      .safeParse(payload);
    throw new AppError(
      message.success && message.data.error?.message
        ? `AI review could not be completed: ${message.data.error.message}`
        : "AI review could not be completed. Please try again.",
      502,
    );
  }
  const text = responseText(payload);
  if (!text) throw new AppError("AI review returned no usable result. Please try again.", 502);
  try {
    return validateAiSuggestions(text, candidates.map((candidate) => candidate.id));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("AI review returned an invalid result. Please try again.", 502);
  }
}
