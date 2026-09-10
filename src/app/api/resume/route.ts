import { admin, integrationDb, AppError } from "@/lib/server/db";
import { failure, sameOrigin } from "@/lib/server/http";
import { uuid } from "@/lib/domain";

export const runtime = "nodejs";
// Resumes never touch the browser except as a short-lived signed URL; every
// read and write here goes through the service-role client because no RLS
// policy grants authenticated or anon access to this bucket at all.
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { db } = await admin();
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
      throw new AppError("Expected a file upload.");
    const form = await request.formData();
    const candidateId = uuid.parse(form.get("candidateId"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a file to upload.");
    if (!ALLOWED_TYPES.has(file.type))
      throw new AppError("Upload a PDF or Word document.");
    if (file.size === 0) throw new AppError("The selected file is empty.");
    if (file.size > MAX_BYTES) throw new AppError("Resume must be under 10 MB.");
    const { data: candidate, error: lookupError } = await db
      .from("candidates")
      .select("id")
      .eq("id", candidateId)
      .single();
    if (lookupError || !candidate) throw new AppError("Candidate not found.", 404);
    const extension =
      file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
    const path = `${candidateId}/${Date.now()}.${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await integrationDb()
      .storage.from("resumes")
      .upload(path, bytes, { contentType: file.type, upsert: true });
    if (uploadError) {
      console.error(
        JSON.stringify({ event: "resume_upload_failed", code: uploadError.name }),
      );
      throw new AppError("Could not upload the resume. Try again.", 502);
    }
    const { error: rpcError } = await db.rpc("save_resume_path", {
      p_id: candidateId,
      p_resume_path: path,
    });
    if (rpcError)
      throw new AppError("Uploaded, but could not save the reference. Try again.");
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request) {
  try {
    const { db } = await admin();
    const candidateId = uuid.parse(
      new URL(request.url).searchParams.get("candidateId"),
    );
    const { data: candidate, error } = await db
      .from("candidates")
      .select("resume_path")
      .eq("id", candidateId)
      .single();
    if (error || !candidate?.resume_path)
      throw new AppError("No resume on file for this candidate.", 404);
    const { data: signed, error: signError } = await integrationDb()
      .storage.from("resumes")
      .createSignedUrl(candidate.resume_path, 60);
    if (signError || !signed)
      throw new AppError("Could not open the resume. Try again.", 502);
    return Response.json({ url: signed.signedUrl });
  } catch (error) {
    return failure(error);
  }
}
