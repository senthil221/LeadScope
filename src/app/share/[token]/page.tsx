import { createHash } from "node:crypto";
import { integrationDb } from "@/lib/server/db";
import { setup } from "@/lib/server/config";
import { stageLabels, isStage } from "@/lib/recruiting/stages";
import { SharedFieldCell } from "@/components/recruiting/shared-field-cell";
import { ExternalLink } from "lucide-react";

// Never cached, never statically generated: every request re-checks the
// token against the database, so a revoked or expired link stops working
// immediately rather than serving a stale page.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type SharedRow = {
  id: string;
  full_name?: string;
  linkedin?: string;
  headline?: string;
  current_company?: string;
  current_designation?: string;
  location?: string;
  total_experience_years?: number;
  rating?: number;
  stage_entered_at?: string;
  client_notes?: string;
  custom?: Record<string, string | number | boolean>;
};
type SharedField = { key: string; label: string; kind: string; options: string[] };
type SharedStage = {
  clientName: string;
  roleName: string;
  stage: string;
  visibleColumns: string[];
  editableColumns: string[];
  fields: SharedField[];
  rows: SharedRow[];
  lastViewedAt: string | null;
};
const staticEditableKinds: Record<string, "text"> = { client_notes: "text" };

const staticLabels: Record<string, string> = {
  stage_entered_at: "Date added",
  full_name: "Full name",
  linkedin: "LinkedIn",
  headline: "Headline",
  current_designation: "Designation",
  current_company: "Company",
  location: "Location",
  total_experience_years: "Experience",
  rating: "Rating",
  client_notes: "Notes",
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
  if (key === "stage_entered_at") return formatDate(String(value));
  if (key === "total_experience_years") return `${value} yrs`;
  if (key === "rating") return `${value} / 5`;
  return String(value);
}

function Message({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="shared-page shared-message-page">
      <div className="shared-message card">
        <span className="shared-brand">LeadScope</span>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
    </main>
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
  const editableLabels = data.editableColumns.map(
    (key) => staticLabels[key] ?? data.fields.find((f) => f.key === key)?.label ?? key,
  );

  return (
    <main className="shared-page">
      <div className="shared-frame">
        <header className="shared-header">
          <div className="shared-header-brand">LeadScope</div>
          <div className="shared-header-client">{data.clientName}</div>
        </header>
        <section className="shared-intro">
          <div>
            <div className="eyebrow">Candidate shortlist</div>
            <h1>{data.roleName}</h1>
            <p>{data.rows.length} candidate{data.rows.length === 1 ? "" : "s"} ready for your review.</p>
          </div>
          <div className="shared-intro-meta">
            <span className="badge accepted">{stageName}</span>
            <span>
              {editableLabels.length
                ? `You can update ${editableLabels.join(", ")}.`
                : "View-only access"}
            </span>
          </div>
        </section>
        <div className="card table-wrap shared-table">
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
                  {columns.map((key) => {
                    if (key === "linkedin") {
                      return (
                        <td className="candidate-linkedin-cell" key={key}>
                          {row.linkedin ? (
                            <a
                              className="candidate-link"
                              href={row.linkedin}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open profile <ExternalLink size={11} />
                            </a>
                          ) : "—"}
                        </td>
                      );
                    }
                    if (!data.editableColumns.includes(key))
                      return <td key={key}>{cell(row, key, data.fields)}</td>;
                    const kind = staticEditableKinds[key] ?? "text";
                    const value = (row as Record<string, unknown>)[key] as string | undefined;
                    return (
                      <td
                        className={key === "client_notes" ? "shared-note-cell" : undefined}
                        key={key}
                      >
                        <SharedFieldCell
                          token={token}
                          roleCandidateId={row.id}
                          column={key}
                          value={value}
                          kind={kind}
                          multiline={key === "client_notes"}
                        />
                      </td>
                    );
                  })}
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
    </main>
  );
}
