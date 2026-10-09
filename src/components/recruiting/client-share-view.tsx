import { createHash } from "node:crypto";
import Image from "next/image";
import { integrationDb } from "@/lib/server/db";
import { setup } from "@/lib/server/config";
import { formatRecruitingDate } from "@/lib/recruiting/display";
import { formatMobile } from "@/lib/recruiting/contact";
import logo from "@/assets/brand/leadvance-recruiting.png";
import { ClientShareSheet, type ShareCandidate } from "./client-share-sheet";
import styles from "./client-share.module.css";

type SharedRow = {
  id: string;
  full_name?: string;
  stage?: string;
  created_at?: string;
  linkedin?: string;
  phone?: string;
  alternate_phone?: string;
  email?: string;
  location?: string;
  current_company?: string;
  current_designation?: string;
  total_experience_years?: number;
  current_ctc?: string | number;
  highest_qualification?: string;
  resume?: string;
  client_notes?: string;
  custom?: Record<string, string | number | boolean>;
};
type SharedField = { key: string; label: string; kind: string };
type SharedStage = { clientName: string; roleName: string; editableColumns: string[]; fields: SharedField[]; rows: SharedRow[] };

export function ShareMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <main className={`${styles.page} ${styles.messagePage}`}>
      <div className={styles.message}>
        <Image src={logo} alt="Leadvance Recruiting" className={styles.logo} priority unoptimized />
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
    </main>
  );
}

const customValue = (field: SharedField, value: unknown) => {
  if (value == null || value === "") return "";
  if (field.kind === "boolean") return value ? "Yes" : "No";
  if (field.kind === "date") return formatRecruitingDate(String(value));
  return String(value);
};

// The client's view of a role: the people the agency has shortlisted for them,
// with what the Recruiter shortlisted tab shows, and a place for feedback.
// Every request re-reads the link, so a revoked one stops at once.
export async function ClientShareView({ token }: { token: string }) {
  const env = setup();
  if (!env.database || !env.secret)
    return <ShareMessage title="This page is not ready yet" detail="Ask your recruiter to finish setting up before sharing a link." />;
  if (!/^[0-9a-f]{64}$/i.test(token))
    return <ShareMessage title="This link is no longer valid" detail="Check the link your recruiter sent you, or ask them for a new one." />;
  let data: SharedStage;
  try {
    const { data: result, error } = await integrationDb().rpc("read_shared_stage", { p_token_hash: createHash("sha256").update(token).digest("hex") });
    if (error || !result) throw error ?? new Error("empty result");
    data = result as SharedStage;
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
    return (
      <ShareMessage
        title={message.includes("LS:") ? "This link is no longer valid" : "This page is temporarily unavailable"}
        detail={message.includes("revoked") ? "This link has been revoked." : message.includes("expired") ? "This link has expired." : message.includes("LS:") ? "Check the link your recruiter sent you." : "Please refresh in a moment. Your feedback is safe."}
      />
    );
  }

  const candidates: ShareCandidate[] = data.rows.map((row) => ({
    id: row.id,
    name: row.full_name?.trim() || "Candidate",
    designation: row.current_designation ?? "",
    company: row.current_company ?? "",
    linkedin: row.linkedin,
    resume: Boolean(row.resume),
    stage: row.stage ?? "recruiter_shortlisted",
    experience: row.total_experience_years != null ? `${row.total_experience_years} yrs` : "",
    ctc: row.current_ctc != null && row.current_ctc !== "" ? String(row.current_ctc) : "",
    location: row.location ?? "",
    qualification: row.highest_qualification ?? "",
    phones: [row.phone, row.alternate_phone].filter((n): n is string => Boolean(n)).map(formatMobile),
    email: row.email ?? "",
    added: row.created_at ? formatRecruitingDate(row.created_at) : "",
    note: row.client_notes,
    custom: Object.fromEntries(data.fields.map((field) => [field.key, customValue(field, row.custom?.[field.key])])),
  }));

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Image src={logo} alt="Leadvance Recruiting" className={styles.logo} priority unoptimized />
          <span className={styles.preparedFor}>Prepared for <strong>{data.clientName}</strong></span>
        </div>
      </header>
      <div className={styles.frame}>
        <section className={styles.hero} aria-labelledby="review-title">
          <p className={styles.eyebrow}>Candidate shortlist</p>
          <h1 id="review-title">{data.roleName}</h1>
        </section>
        <ClientShareSheet
          token={token}
          roleName={data.roleName}
          canEditNotes={data.editableColumns.includes("client_notes")}
          fields={data.fields.map((field) => ({ key: field.key, label: field.label }))}
          candidates={candidates}
        />
        <footer className={styles.footer}>
          <span>Shared by your recruiting team at Leadvance</span>
          <span>Confidential · please do not forward</span>
        </footer>
      </div>
    </main>
  );
}
