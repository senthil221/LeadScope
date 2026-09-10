import { createHash } from "node:crypto";
import { integrationDb } from "@/lib/server/db";
import { setup } from "@/lib/server/config";
import { stageLabels, isStage } from "@/lib/recruiting/stages";

// Never cached, never statically generated: every request re-checks the
// token against the database, so a revoked or expired link stops working
// immediately rather than serving a stale page.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type SharedRow = {
  id: string;
  full_name?: string;
  headline?: string;
  current_company?: string;
  current_designation?: string;
  location?: string;
  total_experience_years?: number;
  rating?: number;
  stage_entered_at?: string;
  client_notes?: string;
  client_decision?: string;
  interview_at?: string;
  custom?: Record<string, string | number | boolean>;
};
type SharedField = { key: string; label: string; kind: string; options: string[] };
type SharedStage = {
  clientName: string;
  roleName: string;
  stage: string;
  visibleColumns: string[];
  fields: SharedField[];
  rows: SharedRow[];
  lastViewedAt: string | null;
};

const staticLabels: Record<string, string> = {
  stage_entered_at: "Date added",
  full_name: "Full name",
  headline: "Headline",
  current_designation: "Designation",
  current_company: "Company",
  location: "Location",
  total_experience_years: "Experience",
  rating: "Rating",
  client_notes: "Notes",
  client_decision: "Decision",
  interview_at: "Interview date",
};
const staticOrder = Object.keys(staticLabels);

function formatDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function cell(row: SharedRow, key: string, fields: SharedField[]): string {
  const field = fields.find((f) => f.key === key);
  if (field) {
    const value = row.custom?.[key];
    if (value == null) return "—";
    if (field.kind === "boolean") return value ? "Yes" : "No";
    if (field.kind === "date") return formatDate(String(value));
    return String(value);
  }
  const value = (row as Record<string, unknown>)[key];
  if (value == null || value === "") return "—";
  if (key === "stage_entered_at" || key === "interview_at") return formatDate(String(value));
  if (key === "total_experience_years") return `${value} yrs`;
  if (key === "rating") return `${value} / 5`;
  return String(value);
}

function Message({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f7f9f6",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "white",
          border: "1px solid #e1e5df",
          borderRadius: 12,
          padding: "28px 32px",
          maxWidth: 420,
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>{title}</h1>
        <p style={{ color: "#6b776a", fontSize: 13, margin: 0 }}>{detail}</p>
      </div>
    </div>
  );
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const env = setup();
  if (!env.database || !env.secret)
    return (
      <Message
        title="This workspace is not fully configured"
        detail="Ask the agency to finish setting up before sharing a link."
      />
    );
  if (!/^[0-9a-f]{64}$/i.test(token))
    return (
      <Message
        title="This link is no longer valid"
        detail="Check the link your recruiter sent you, or ask them to send a new one."
      />
    );
  const hash = createHash("sha256").update(token).digest("hex");
  let data: SharedStage;
  try {
    const { data: result, error } = await integrationDb().rpc("read_shared_stage", {
      p_token_hash: hash,
    });
    if (error || !result) throw error ?? new Error("empty result");
    data = result as SharedStage;
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "";
    return (
      <Message
        title="This link is no longer valid"
        detail={
          message.includes("revoked")
            ? "This link has been revoked."
            : message.includes("expired")
              ? "This link has expired."
              : "Check the link your recruiter sent you, or ask them to send a new one."
        }
      />
    );
  }

  const columns = staticOrder
    .filter((k) => data.visibleColumns.includes(k))
    .concat(data.fields.map((f) => f.key));
  const stageName = isStage(data.stage) ? stageLabels[data.stage] : data.stage;

  return (
    <div style={{ minHeight: "100vh", background: "#f7f9f6", padding: 20 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div>
              <div className="eyebrow">{data.clientName}</div>
              <h1 style={{ margin: "4px 0 0", fontSize: 20 }}>
                {data.roleName} — {stageName}
              </h1>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {data.rows.length} candidate{data.rows.length === 1 ? "" : "s"}
              </p>
            </div>
            <span className="badge">Read-only</span>
          </div>
        </div>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((key) => (
                  <th key={key}>
                    {staticLabels[key] ?? data.fields.find((f) => f.key === key)?.label ?? key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((key) => (
                    <td key={key}>{cell(row, key, data.fields)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!data.rows.length && (
            <div className="empty">
              <h3>No candidates in this stage yet.</h3>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
