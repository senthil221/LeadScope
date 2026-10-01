const stageFilterKeys = ["q", "source", "source_detail", "rating", "entered_from", "entered_to", "sort"];

export function roleStageUrl(path: string, search: string, currentStage: string, targetStage: string, version = 0) {
  const params = new URLSearchParams(search);
  params.set("stage", targetStage);
  params.delete("page"); params.delete("bottom");
  if (targetStage !== currentStage) for (const key of stageFilterKeys) params.delete(key);
  if (version) params.set("v", String(version));
  return `${path}?${params}`;
}
