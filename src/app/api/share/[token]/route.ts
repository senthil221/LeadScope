import { z } from "zod";
import { createHash } from "node:crypto";
import { integrationDb, AppError, checked } from "@/lib/server/db";
import { body, failure } from "@/lib/server/http";
import { uuid } from "@/lib/domain";

export const runtime = "nodejs";
// The token must authorize this exact role membership before Storage is used.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!/^[0-9a-f]{64}$/i.test(token)) throw new AppError("This link is no longer valid.", 404);
    const membershipId = uuid.parse(new URL(request.url).searchParams.get("resume"));
    const db = integrationDb();
    const shared = checked(await db.rpc("read_shared_stage", { p_token_hash: createHash("sha256").update(token).digest("hex") })) as { rows: { id: string; resume?: string }[] };
    if (!shared.rows.some((row) => row.id === membershipId && row.resume)) throw new AppError("Resume not available in this shared role.", 404);
    const row = checked(await db.from("role_candidates").select("candidates!inner(resume_path)").eq("id", membershipId).single()) as unknown as { candidates: { resume_path: string } };
    const { data, error } = await db.storage.from("resumes").createSignedUrl(row.candidates.resume_path, 60);
    if (error || !data) throw new AppError("Could not open the resume. Try again.", 502);
    return new Response(null, { status: 302, headers: { Location: data.signedUrl, "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
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
        expected: z.string().max(4000).optional(),
      })
      .parse(input);
    const hash = createHash("sha256").update(token).digest("hex");
    checked(
      await integrationDb().rpc(p.expected === undefined ? "write_shared_cell" : "write_shared_cell_checked", {
        p_token_hash: hash,
        p_role_candidate: p.roleCandidateId,
        p_column: p.column,
        p_value: p.value,
        ...(p.expected === undefined ? {} : { p_expected: p.expected }),
      }),
    );
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
