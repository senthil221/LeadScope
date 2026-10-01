import { randomUUID } from "node:crypto";
import { admin, checked, integrationDb, AppError } from "@/lib/server/db";
import { failure, sameOrigin } from "@/lib/server/http";
import { uuid } from "@/lib/domain";

export const runtime = "nodejs";
const types: Record<string, string> = { "application/pdf": "pdf", "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { db } = await admin();
    const form = await request.formData();
    const roleId = uuid.parse(form.get("roleId"));
    const revision = Number(form.get("revision"));
    const file = form.get("file");
    if (!(file instanceof File) || !types[file.type] || file.size === 0 || file.size > 10 * 1024 * 1024) throw new AppError("Choose a PDF or Word JD under 10 MB.");
    if (!Number.isSafeInteger(revision) || revision < 1) throw new AppError("Refresh this role before uploading.");
    const role = checked(await db.from("roles").select("id,archived,revision,clients!inner(archived)").eq("id", roleId).single()) as unknown as { archived: boolean; revision: number; clients: { archived: boolean } };
    if (role.archived || role.clients.archived || role.revision !== revision) throw new AppError("Role changed or is archived. Refresh before uploading.");
    const path = `roles/${roleId}/${randomUUID()}.${types[file.type]}`;
    const storage = integrationDb().storage.from("resumes");
    const upload = await storage.upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (upload.error) throw new AppError("Could not upload the JD. Try again.", 502);
    try { checked(await db.rpc("save_role_jd", { p_id: roleId, p_path: path, p_name: file.name.slice(0, 255), p_revision: revision })); }
    catch (e) { await storage.remove([path]); throw e; }
    return Response.json({ saved: true });
  } catch (error) { return failure(error); }
}

export async function GET(request: Request) {
  try {
    const { db } = await admin();
    const id = uuid.parse(new URL(request.url).searchParams.get("roleId"));
    const role = checked(await db.from("roles").select("jd_path").eq("id", id).single());
    if (!role.jd_path || !role.jd_path.startsWith(`roles/${id}/`)) throw new AppError("No JD attached.", 404);
    const { data, error } = await integrationDb().storage.from("resumes").createSignedUrl(role.jd_path, 60);
    if (error || !data) throw new AppError("Could not open the JD.", 502);
    return new Response(null, { status: 302, headers: { Location: data.signedUrl, "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
