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

  const stageName = isStage(data.stage) ? stageLabels[data.stage] : data.stage;
  const shown = (key: string) => data.visibleColumns.includes(key);
  const canEdit = (key: string) => data.editableColumns.includes(key);
  // Name, profile and current role introduce a person; everything else reads
  // better as labelled facts than as another column to scroll past.
  const summarised = new Set([
    "full_name",
    "linkedin",
    "current_designation",
    "current_company",
    "client_notes",
  ]);
  const factKeys = staticOrder
    .filter((key) => shown(key) && !summarised.has(key))
    .concat(data.fields.map((field) => field.key));
  const labelFor = (key: string) =>
    staticLabels[key] ?? data.fields.find((field) => field.key === key)?.label ?? key;

  return (
    <main className="shared-page">
      <header className="shared-topbar">
        <span className="shared-brand">LeadScope</span>
        <span className="shared-topbar-client">{data.clientName}</span>
      </header>
      <div className="shared-frame">
        <section className="shared-intro">
          <p className="shared-eyebrow">{stageName}</p>
          <h1>{data.roleName}</h1>
          <p className="shared-lede">
            {data.rows.length
              ? `${data.rows.length} candidate${data.rows.length === 1 ? "" : "s"} for your review.`
              : "No candidates have been shared yet."}
            {canEdit("client_notes") && data.rows.length
              ? " Leave your feedback under any profile — it saves as you type and reaches the recruiting team straight away."
              : ""}
          </p>
        </section>

        {data.rows.length ? (
          <ol className="shared-list">
            {data.rows.map((row, index) => {
              const subtitle = [
                shown("current_designation") ? row.current_designation : "",
                shown("current_company") ? row.current_company : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li className="shared-candidate" key={row.id}>
                  <div className="shared-candidate-head">
                    <span className="shared-candidate-index" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="shared-candidate-identity">
                      <h2>{(shown("full_name") && row.full_name) || "Candidate"}</h2>
                      {subtitle && <p>{subtitle}</p>}
                    </div>
                    {shown("linkedin") && row.linkedin && (
                      <a
                        className="shared-profile-link"
                        href={row.linkedin}
                        rel="noreferrer"
                        target="_blank"
                      >
                        LinkedIn <ExternalLink size={13} />
                      </a>
                    )}
                  </div>

                  {factKeys.length > 0 && (
                    <dl className="shared-facts">
                      {factKeys.map((key) => (
                        <div className="shared-fact" key={key}>
                          <dt>{labelFor(key)}</dt>
                          <dd>
                            {canEdit(key) ? (
                              <SharedFieldCell
                                token={token}
                                roleCandidateId={row.id}
                                column={key}
                                value={
                                  (row as Record<string, unknown>)[key] as string | undefined
                                }
                                kind={staticEditableKinds[key] ?? "text"}
                              />
                            ) : (
                              cell(row, key, data.fields)
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {shown("client_notes") && (
                    <div className="shared-feedback">
                      <span className="shared-feedback-label">
                        {canEdit("client_notes") ? "Your feedback" : "Notes"}
                      </span>
                      {canEdit("client_notes") ? (
                        <SharedFieldCell
                          token={token}
                          roleCandidateId={row.id}
                          column="client_notes"
                          value={row.client_notes}
                          kind="text"
                          multiline
                        />
                      ) : (
                        <p className="shared-feedback-readonly">
                          {row.client_notes || "No notes yet."}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="card empty">
            <h3>Nothing to review yet</h3>
            <p>Your recruiter will add candidates to this shortlist shortly.</p>
          </div>
        )}

        <footer className="shared-footer">
          Shared by {data.clientName}&rsquo;s recruiting team via LeadScope.
        </footer>
      </div>
    </main>
  );
}
