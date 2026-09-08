import "server-only";
import { z } from "zod";
import { normalizeQuery } from "../queries";
export class ProviderError extends Error {
  constructor(
    public code: string,
    public retryable: boolean,
    public stopRun = false,
  ) {
    super(code);
  }
}
const responseSchema = z
  .object({
    organic: z
      .array(
        z.object({
          title: z.string().max(4000),
          link: z.string().max(4000),
          snippet: z.string().max(16000).default(""),
          position: z.number().int().min(1).max(1000),
        }),
      )
      .max(100)
      .default([]),
  })
  .passthrough();
export function providerGuard() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST)
    throw new ProviderError("test_dispatch_forbidden", false, true);
  if (process.env.SERPER_LIVE_ENABLED !== "true" || !process.env.SERPER_API_KEY)
    throw new ProviderError("serper_setup_required", false, true);
}
export async function searchSerper(
  query: string,
  country: string,
  language: string,
  page: number,
) {
  providerGuard();
  const q = normalizeQuery(query);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 5 ||
    !/^[a-z]{2}$/.test(country) ||
    !/^[a-z]{2}$/.test(language)
  )
    throw new ProviderError("invalid_search_parameters", false, true);
  let response: Response;
  try {
    response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q, gl: country, hl: language, page, num: 10 }),
      signal: AbortSignal.timeout(18000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new ProviderError("network_or_timeout", true);
  }
  if (!response.ok)
    throw new ProviderError(
      `serper_${response.status}`,
      response.status === 429 || response.status >= 500,
      [400, 401, 403].includes(response.status),
    );
  let rawText: string;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError("empty_response", false);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1000000) {
        await reader.cancel();
        throw new ProviderError("response_too_large", false);
      }
      chunks.push(value);
    }
    rawText = Buffer.concat(chunks).toString("utf8");
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError("network_or_timeout", true);
  }
  try {
    return responseSchema.parse(JSON.parse(rawText));
  } catch {
    throw new ProviderError("invalid_provider_response", false);
  }
}
