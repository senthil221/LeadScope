import { ClientShareView } from "@/components/recruiting/client-share-view";

export const metadata = { title: "Candidate shortlist | Leadvance Recruiting", robots: { index: false, follow: false } };
// Never cached: every request re-checks the link, so a revoked one stops at once.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// The original long links keep working alongside the short /c/ ones.
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClientShareView token={token} />;
}
