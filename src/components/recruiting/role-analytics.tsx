import type { StageDurationRow, StageFunnelRow } from "@/lib/types";
import { pipelineStages, stageLabels, type Stage } from "@/lib/recruiting/stages";

function formatDays(days: number | null): string {
  if (days == null) return "—";
  if (days < 1) return `${Math.round(days * 24)} hrs`;
  return `${days.toFixed(1)} days`;
}
function formatPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// Everything here reads role_stage_funnel and role_stage_durations, two
// security_invoker views over role_candidate_events: no new writes, and
// this stays entirely within the same RLS boundary as every other tab.
export function RoleAnalytics({
  funnel,
  durations,
}: {
  funnel: StageFunnelRow[];
  durations: StageDurationRow[];
}) {
  const byStage = new Map(funnel.map((r) => [r.stage, r]));
  const durationByStage = new Map(durations.map((r) => [r.stage, r]));
  const allProfiles = byStage.get("all_profiles")?.ever_reached ?? 0;
  const rejected = byStage.get("rejected");

  return (
    <div className="card table-wrap">
      <h3>Pipeline funnel</h3>
      <p className="muted">
        Ever reached counts a candidate once, the first time they arrived at a
        stage, even if they later moved on or were rejected. Conversion
        compares that to the stage before it in the pipeline.
      </p>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Ever reached</th>
            <th>Currently here</th>
            <th>Conversion</th>
          </tr>
        </thead>
        <tbody>
          {pipelineStages.map((stage, i) => {
            const row = byStage.get(stage);
            const everReached = row?.ever_reached ?? 0;
            const prevStage = i > 0 ? pipelineStages[i - 1] : null;
            const prevReached = prevStage ? (byStage.get(prevStage)?.ever_reached ?? 0) : 0;
            const conversion = prevStage && prevReached > 0 ? everReached / prevReached : null;
            return (
              <tr key={stage}>
                <td className="strong">{stageLabels[stage]}</td>
                <td>{everReached}</td>
                <td>{row?.currently_here ?? 0}</td>
                <td>{conversion == null ? "—" : formatPct(conversion)}</td>
              </tr>
            );
          })}
          <tr>
            <td className="strong">{stageLabels.rejected}</td>
            <td>{rejected?.ever_reached ?? 0}</td>
            <td>{rejected?.currently_here ?? 0}</td>
            <td>
              {allProfiles > 0
                ? formatPct((rejected?.ever_reached ?? 0) / allProfiles)
                : "—"}
            </td>
          </tr>
        </tbody>
      </table>
      <h3>Median time in stage</h3>
      <p className="muted">
        Only completed stays count — a candidate still sitting in a stage
        today has not finished that stay yet.
      </p>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Median time in stage</th>
            <th>Completed stays measured</th>
          </tr>
        </thead>
        <tbody>
          {[...pipelineStages, "rejected" as Stage].map((stage) => {
            const row = durationByStage.get(stage);
            return (
              <tr key={stage}>
                <td className="strong">{stageLabels[stage]}</td>
                <td>{formatDays(row?.median_days ?? null)}</td>
                <td>{row?.completed_count ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
