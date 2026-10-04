import { roleFilterKeys } from "./list-filters";

export function roleStageUrl(path: string, search: string, currentStage: string, targetStage: string, version = 0) {
  const params = new URLSearchParams(search);
  params.set("stage", targetStage);
  params.delete("page"); params.delete("bottom");
  if (targetStage !== currentStage) { for (const key of roleFilterKeys) params.delete(key); params.delete("candidate"); }
  if (version) params.set("v", String(version));
  return `${path}?${params}`;
}
