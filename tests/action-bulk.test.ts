import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { POST } from "../src/app/api/action/route";
const { rpc } = vi.hoisted(() => ({rpc:vi.fn()}));
vi.mock("../src/lib/server/db", async (importOriginal) => ({...await importOriginal<typeof import("../src/lib/server/db")>(), admin:async()=>({db:{rpc},user:{id:"test"}})}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("bulk API boundary", () => {
  it.each([89,2000])("accepts %i selected rows through the real HTTP parser", async(count) => {
    vi.stubEnv("APP_URL","https://app.test");
    rpc.mockResolvedValue({data:{token:"a".repeat(32),affected:count},error:null});
    const ids=Array.from({length:count},()=>randomUUID());
    const response=await POST(new Request("https://app.test/api/action",{method:"POST",headers:{origin:"https://app.test","Content-Type":"application/json"},body:JSON.stringify({action:"bulkEditCandidates",payload:{clientId:randomUUID(),roleId:randomUUID(),ids,stage:null,field:"source",value:"google",mode:"replace"}})}));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("bulk_edit_role_candidates",expect.objectContaining({p_ids:ids,p_expected:null}));
  });
  it("still rejects more than the database limit", async() => {
    vi.stubEnv("APP_URL","https://app.test");
    vi.spyOn(console,"error").mockImplementation(()=>{});
    const response=await POST(new Request("https://app.test/api/action",{method:"POST",headers:{origin:"https://app.test","Content-Type":"application/json"},body:JSON.stringify({action:"bulkEditCandidates",payload:{clientId:randomUUID(),roleId:randomUUID(),ids:Array.from({length:2001},()=>randomUUID()),stage:null,field:"source",value:"google",mode:"replace"}})}));
    expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
