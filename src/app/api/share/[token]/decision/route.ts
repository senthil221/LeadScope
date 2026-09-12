import { z } from "zod";
import { createHash } from "node:crypto";
import { integrationDb, AppError, checked } from "@/lib/server/db";
import { body, failure } from "@/lib/server/http";
import { uuid } from "@/lib/domain";

export const runtime = "nodejs";
// Same-origin protected like /api/share/[token]: a client only ever reaches
// this by clicking a button on /share/[token] itself.
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
        decision: z.enum(["shortlisted", "rejected", "hold"]),
        reason: z.string().max(4000).default(""),
      })
      .parse(input);
    const hash = createHash("sha256").update(token).digest("hex");
    checked(
      await integrationDb().rpc("write_client_decision", {
        p_token_hash: hash,
        p_role_candidate: p.roleCandidateId,
        p_decision: p.decision,
        p_reason: p.reason || null,
      }),
    );
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
