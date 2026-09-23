import { createHash } from "node:crypto";
import { integrationDb } from "@/lib/server/db";
import { setup } from "@/lib/server/config";
import { stageLabels, isStage } from "@/lib/recruiting/stages";
import { SharedFieldCell } from "@/components/recruiting/shared-field-cell";
import Image from "next/image";
import { ExternalLink } from "lucide-react";
import logo from "@/assets/brand/leadvance-recruiting.png";
import styles from "./share-page.module.css";

export const metadata = { title: "Candidate review | Leadvance Recruiting" };

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


function formatDate(s: string | null | undefined) {
  if (!s) return "Not provided";
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
    if (value == null) return "Not provided";
    if (field.kind === "boolean") return value ? "Yes" : "No";
    if (field.kind === "date") return formatDate(String(value));
    return String(value);
  }
  const value = (row as Record<string, unknown>)[key];
  if (value == null || value === "") return "Not provided";
  if (key === "stage_entered_at") return formatDate(String(value));
  if (key === "total_experience_years") return `${value} yrs`;
  if (key === "rating") return `${value} / 5`;
  return String(value);
}

function Message({ title, detail }: { title: string; detail: string }) {
  return (
    <main className={`${styles.page} ${styles.messagePage}`}>
      <div className={styles.message}>
        <span className={styles.brand}>Leadvance Recruiting / Client review</span>
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
  const canEditNotes = data.editableColumns.includes("client_notes");
  const identityKeys = new Set(["full_name", "linkedin", "current_designation", "current_company", "client_notes"]);
  const preferredOrder = ["rating", "location", "total_experience_years", "stage_entered_at", "headline"];
  const factKeys = preferredOrder
    .filter((key) => shown(key) && !identityKeys.has(key))
    .concat(data.fields.filter((field) => shown(field.key)).map((field) => field.key));
  const labelFor = (key: string) => staticLabels[key] ?? data.fields.find((field) => field.key === key)?.label ?? key;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <span className={styles.brand}>
            <Image src={logo} alt="Leadvance Recruiting" className={styles.logo} priority unoptimized />
            <span>Client review</span>
          </span>
          <span className={styles.clientName}>{data.clientName}</span>
        </div>
      </header>
      <div className={styles.frame}>
        <section className={styles.intro} aria-labelledby="review-title">
          <div>
            <p className={styles.eyebrow}>{data.clientName} / Candidate shortlist</p>
            <h1 id="review-title">{data.roleName}</h1>
          </div>
          <span className={styles.stage}>{stageName}</span>
        </section>
        <section className={styles.sheet} aria-label="Candidate review sheet">
          <div className={styles.toolbar}>
            <strong>{data.rows.length} {data.rows.length === 1 ? "candidate" : "candidates"}</strong>
            <span>{canEditNotes ? "Add feedback in the sheet. Changes save when you leave the cell." : "Review the shared candidate details below."}</span>
          </div>
          {data.rows.length ? (
            <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Candidate details. Scroll horizontally to see all columns.">
              <table className={styles.table}>
                <caption className={styles.srOnly}>Candidates shared for {data.roleName}</caption>
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col className={styles.identityColumn} />
                  {shown("client_notes") && <col style={{ width: 300 }} />}
                  {factKeys.map((key) => <col key={key} style={{ width: key === "headline" ? 240 : key === "rating" ? 90 : 140 }} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className={styles.rowNumber}>#</th>
                    <th scope="col" className={styles.identity}>Candidate</th>
                    {shown("client_notes") && <th scope="col">{canEditNotes ? "Your feedback" : "Notes"}</th>}
                    {factKeys.map((key) => <th scope="col" key={key}>{labelFor(key)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, index) => {
                    const name = (shown("full_name") && row.full_name) || `Candidate ${index + 1}`;
                    const subtitle = [shown("current_designation") ? row.current_designation : "", shown("current_company") ? row.current_company : ""].filter(Boolean).join(" · ");
                    return (
                      <tr key={row.id}>
                        <td className={styles.rowNumber}>{index + 1}</td>
                        <th scope="row" className={styles.identity}>
                          <strong className={styles.name} title={name}>{name}</strong>
                          {subtitle && <span className={styles.subtitle} title={subtitle}>{subtitle}</span>}
                          {shown("linkedin") && row.linkedin && <a className={styles.profileLink} href={row.linkedin} rel="noreferrer" target="_blank">LinkedIn <ExternalLink size={11} aria-hidden="true" /></a>}
                        </th>
                        {shown("client_notes") && <td className={styles.feedback}>
                          {canEditNotes ? <SharedFieldCell token={token} roleCandidateId={row.id} column="client_notes" value={row.client_notes} kind="text" multiline label={`Feedback for ${name}`} /> : <span className={styles.noteText}>{row.client_notes || "No notes yet"}</span>}
                        </td>}
                        {factKeys.map((key) => {
                          const value = cell(row, key, data.fields);
                          return <td key={key}><span className={value === "Not provided" ? styles.missing : styles.value} title={value}>{value}</span></td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.empty}><h2>No candidates shared yet</h2><p>Your recruiter will add profiles to this shortlist shortly.</p></div>
          )}
          <div className={styles.sheetFooter}><span>{data.rows.length} {data.rows.length === 1 ? "profile" : "profiles"} shared</span><span>Scroll across to view all columns</span></div>
        </section>
        <footer className={styles.footer}><span>Prepared by {data.clientName}&rsquo;s recruiting team</span><span>Powered by <strong>Leadvance Recruiting</strong></span></footer>
      </div>
    </main>
  );
}
