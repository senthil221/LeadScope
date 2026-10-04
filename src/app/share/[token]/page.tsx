import { createHash } from "node:crypto";
import { integrationDb } from "@/lib/server/db";
import { setup } from "@/lib/server/config";
import { stageLabels, isStage } from "@/lib/recruiting/stages";
import { clientShareLabels } from "@/lib/recruiting/share-columns";
import { candidateSourceLabel } from "@/lib/recruiting/stages";
import { ClientShareSheet } from "@/components/recruiting/client-share-sheet";
import Image from "next/image";
import logo from "@/assets/brand/leadvance-recruiting.png";
import styles from "./share-page.module.css";
import { formatRecruitingDate } from "@/lib/recruiting/display";

export const metadata = { title: "Candidate review | Leadvance Recruiting" };

// Never cached, never statically generated: every request re-checks the
// token against the database, so a revoked or expired link stops working
// immediately rather than serving a stale page.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type SharedRow = {
  id: string;
  [key: string]: unknown;
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


const staticLabels = clientShareLabels;

const formatDate = formatRecruitingDate;
function cell(row: SharedRow, key: string, fields: SharedField[]): string {
  const field = fields.find((f) => f.key === key);
  if (field) {
    const value = row.custom?.[key];
    if (value == null) return "";
    if (field.kind === "boolean") return value ? "Yes" : "No";
    if (field.kind === "date") return formatDate(String(value));
    return String(value);
  }
  const value = (row as Record<string, unknown>)[key];
  if (value == null || value === "") return "";
  if (["created_at", "stage_entered_at", "interview_at", "follow_up_at", "offer_sent_on", "offer_response_due_at", "expected_start_at"].includes(key)) return formatDate(String(value));
  if (key === "stage" && isStage(String(value))) return stageLabels[String(value) as keyof typeof stageLabels];
  if (key === "source") return candidateSourceLabel(String(value));
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
        title={message.includes("LS:") ? "This link is no longer valid" : "The sheet is temporarily unavailable"}
        detail={
          message.includes("revoked")
            ? "This link has been revoked."
            : message.includes("expired")
              ? "This link has expired."
              : message.includes("LS:") ? "Check the link your recruiter sent you." : "Please refresh in a moment. Your feedback has not been changed."
        }
      />
    );
  }

  const shown = (key: string) => data.visibleColumns.includes(key);
  const canEditNotes = data.editableColumns.includes("client_notes");
  const identityKeys = new Set(["full_name", "linkedin", "client_notes"]);
  const factKeys = data.visibleColumns.filter((key) => !identityKeys.has(key));
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
          <span className={styles.stage}>Client shortlist</span>
        </section>
        <ClientShareSheet token={token} roleName={data.roleName} canEditNotes={canEditNotes} columns={factKeys.map((key) => ({key,label:labelFor(key)}))} rows={data.rows.map((row,index) => ({id:row.id,name:(shown("full_name") && row.full_name) || String(index+1),subtitle:[row.current_designation,row.current_company].filter(Boolean).join(" · "),linkedin:shown("linkedin") ? row.linkedin : undefined,note:row.client_notes,stage:cell(row,"stage",data.fields),resume:Boolean(row.resume),values:Object.fromEntries(factKeys.map((key) => [key,cell(row,key,data.fields)]))}))} />
        <footer className={styles.footer}><span>Prepared by {data.clientName}&rsquo;s recruiting team</span><span>Powered by <strong>Leadvance Recruiting</strong></span></footer>
      </div>
    </main>
  );
}
