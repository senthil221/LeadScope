import { AppError } from "./db";

// PostgREST enforces a per-request row cap, independently of range(). Read
// bounded pages and reject a changing dataset rather than export partial data.
export async function collectPages<T extends { id: string }>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null; count: number | null }>,
  limit: number,
  allowCapped = false,
) {
  const rows: T[] = [];
  const ids = new Set<string>();
  let total: number | null = null;
  for (let offset = 0; offset < limit; offset += 500) {
    const result = await fetchPage(offset, Math.min(limit - 1, offset + 499));
    if (result.error) throw new AppError("Could not read the complete list. Please retry.");
    if (result.count == null) throw new AppError("Could not verify the list size. Please retry.");
    if (total !== null && total !== result.count) throw new AppError("This list changed while loading. Please retry.");
    total = result.count;
    if (total > limit && !allowCapped) throw new AppError(`Narrow the filters to ${limit.toLocaleString("en-US")} profiles or fewer.`);
    const page = result.data ?? [];
    for (const row of page) {
      if (ids.has(row.id)) throw new AppError("This list changed while loading. Please retry.");
      ids.add(row.id); rows.push(row);
    }
    const wanted = Math.min(total, limit);
    if (rows.length === wanted) return rows;
    if (page.length < Math.min(500, limit - offset)) throw new AppError("The complete list was not returned. Please retry.");
  }
  return rows;
}
