// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SharedFieldCell } from "../src/components/recruiting/shared-field-cell";
import { ClientShareSheet } from "../src/components/recruiting/client-share-sheet";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("client feedback drafts",()=>{
  it("retains the draft after a network failure and retries against the original value",async()=>{
    const fetcher=vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce(new Response("{}"));vi.stubGlobal("fetch",fetcher);
    render(<SharedFieldCell token="token" roleCandidateId="row" column="client_notes" value="Existing" kind="text" multiline label="Feedback"/>);
    const input=screen.getByRole("textbox",{name:"Feedback"});
    fireEvent.change(input,{target:{value:"My feedback"}});fireEvent.blur(input);
    await screen.findByText("Connection lost");
    expect((input as HTMLTextAreaElement).value).toBe("My feedback");
    expect(document.querySelector('[data-unsaved="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Retry saving feedback"}));
    await waitFor(()=>expect(document.querySelector('[data-unsaved="true"]')).toBeNull());
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({value:"My feedback",expected:"Existing"});
  });
  it("prevents pagination from discarding unsaved feedback",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("Connection lost")));
    render(<ClientShareSheet token="token" candidates={Array.from({length:26},(_,i)=>person(String(i),`Person ${i}`))} fields={[]} canEditNotes roleName="Test role"/>);
    fireEvent.change(screen.getByRole("textbox",{name:"Feedback on Person 0"}),{target:{value:"Keep this"}});
    fireEvent.click(screen.getByRole("button",{name:"Next"}));
    expect(screen.getByRole("alert").textContent).toContain("Save your feedback");
    expect((screen.getByRole("textbox",{name:"Feedback on Person 0"}) as HTMLTextAreaElement).value).toBe("Keep this");
    expect(screen.queryByRole("textbox",{name:"Feedback on Person 25"})).toBeNull();
  });
});

const person=(id:string,name:string,stage="recruiter_shortlisted")=>({id,name,designation:"QA Lead",company:"Acme",resume:false,stage,experience:"8 yrs",ctc:"18 LPA",location:"Chennai",qualification:"B.E.",phones:["98765 43210"],email:`${id}@example.com`,added:"Oct 1, 2026",custom:{}});
describe("the client shortlist",()=>{
  it("shows the Recruiter shortlisted columns and no internal ones",()=>{
    render(<ClientShareSheet token="token" candidates={[person("a","Asha")]} fields={[{key:"notice",label:"Notice period"}]} canEditNotes={false} roleName="Test role"/>);
    expect([...document.querySelectorAll("thead th")].map((th)=>th.textContent)).toEqual(["Candidate","Experience","Current CTC","Location","Qualification","Contact","Notice period","Your feedback"]);
    expect(screen.queryByText(/rating|source/i)).toBeNull();
  });
  it("filters by stage, counting each, and searches across details",()=>{
    render(<ClientShareSheet token="token" candidates={[person("a","Asha"),person("b","Bala","client_shortlisted"),person("c","Chitra","offer_sent")]} fields={[]} canEditNotes={false} roleName="Test role"/>);
    fireEvent.click(screen.getByRole("button",{name:/Shortlisted 1/}));
    expect([...document.querySelectorAll("tbody th strong")].map((x)=>x.textContent)).toEqual(["Bala"]);
    fireEvent.click(screen.getByRole("button",{name:/All 3/}));
    fireEvent.change(screen.getByRole("searchbox",{name:"Search candidates"}),{target:{value:"chitra"}});
    expect([...document.querySelectorAll("tbody th strong")].map((x)=>x.textContent)).toEqual(["Chitra"]);
  });
});
