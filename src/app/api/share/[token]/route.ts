import { z } from "zod";
import { createHash } from "node:crypto";
import { integrationDb, AppError, checked } from "@/lib/server/db";
import { body, failure } from "@/lib/server/http";
import { uuid } from "@/lib/domain";

export const runtime = "nodejs";
// Unlike the share page's own GET, this write path is same-origin protected
// (via body()) since a client only ever reaches it by submitting the form on
// /share/[token] itself, not by following a link from an email.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    if (!/^[0-9a-f]{64}$/i.test(token))
      throw new AppError("This link is no longer valid.", 404);
    const input = await body(request);
    const p = z
      .object({
        roleCandidateId: uuid,
        column: z.string().min(1).max(50),
        value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
      })
      .parse(input);
    const hash = createHash("sha256").update(token).digest("hex");
    checked(
      await integrationDb().rpc("write_shared_cell", {
        p_token_hash: hash,
        p_role_candidate: p.roleCandidateId,
        p_column: p.column,
        p_value: p.value,
      }),
    );
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
