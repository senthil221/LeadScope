import { ClientShareView, ShareMessage } from "@/components/recruiting/client-share-view";
import { integrationDb } from "@/lib/server/db";
import { shareCodeFromSegment } from "@/lib/recruiting/roles";

export const metadata = { title: "Candidate shortlist | Leadvance Recruiting", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// /c/<client>/<role>-<code>. The names are there to read; the six-character
// code finds the link, so a renamed role or client keeps every link working.
export default async function ShortSharePage({ params }: { params: Promise<{ client: string; role: string }> }) {
  const { role } = await params;
  const code = shareCodeFromSegment(role);
  const token = code ? (await integrationDb().rpc("share_token_for_code", { p_code: code })).data : null;
  if (typeof token !== "string") return <ShareMessage title="This link is no longer valid" detail="Check the link your recruiter sent you, or ask them for a new one." />;
  return <ClientShareView token={token} />;
}
