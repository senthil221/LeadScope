import "server-only";
import { ZodError } from "zod";
import { AppError } from "./db";
import { setup } from "./config";
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = setup().appUrl;
  if (!expected) throw new AppError("Set APP_URL to enable changes.", 503);
  if (
    !origin ||
    origin !== new URL(expected).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AppError("This action must be made from the application.", 403);
}
export async function body(request: Request) {
  sameOrigin(request);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("Expected JSON.");
  const text = await boundedText(request, 64000);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("Invalid JSON.");
  }
}
export async function boundedText(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new AppError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Expected a request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AppError("Request is too large.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function failure(error: unknown) {
  if (error instanceof ZodError)
    return Response.json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  if (error instanceof AppError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(JSON.stringify({ event: "request_error", code: "unexpected" }));
  return Response.json(
    { error: "The action could not be completed. Try again." },
    { status: 500 },
  );
}
