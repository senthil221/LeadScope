import { describe, it, expect, vi } from "vitest";
import { collectPages } from "../src/lib/server/collect-pages";

describe("complete bounded selections and exports", () => {
  const dataset = Array.from({length: 1751}, (_,i) => ({id:String(i)}));
  it("reads beyond the API cap, retaining the last matching row", async () => {
    const fetcher = vi.fn(async (from:number,to:number) => ({data:dataset.slice(from,to+1),error:null,count:dataset.length}));
    expect(await collectPages(fetcher, 2000)).toEqual(dataset);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("caps a selection explicitly but rejects an oversized export", async () => {
    const fetcher = async(from:number,to:number) => ({data:dataset.slice(from,to+1),error:null,count:dataset.length});
    expect(await collectPages(fetcher,1000,true)).toHaveLength(1000);
    await expect(collectPages(fetcher,1000)).rejects.toThrow("Narrow the filters");
  });
  it("rejects truncated data and datasets changing during collection", async () => {
    await expect(collectPages(async () => ({data:dataset.slice(0,100),error:null,count:1751}),2000)).rejects.toThrow("complete list");
    await expect(collectPages(async(from,to) => ({data:dataset.slice(from,to+1),error:null,count:from ? 1750 : 1751}),2000)).rejects.toThrow("changed");
    await expect(collectPages(async() => ({data:dataset.slice(0,500),error:null,count:1751}),2000)).rejects.toThrow("changed");
  });
});
