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
    const rows=Array.from({length:26},(_,i)=>({id:String(i),name:`Person ${i}`,subtitle:"",stage:"Recruiter shortlisted",values:{email:`p${i}@example.com`},resume:false}));
    render(<ClientShareSheet token="token" rows={rows} columns={[{key:"email",label:"Email"}]} canEditNotes roleName="Test role"/>);
    fireEvent.change(screen.getByRole("textbox",{name:"Feedback for Person 0"}),{target:{value:"Keep this"}});
    fireEvent.click(screen.getByRole("button",{name:"Next"}));
    expect(screen.getByRole("alert").textContent).toContain("Save your feedback");
    expect((screen.getByRole("textbox",{name:"Feedback for Person 0"}) as HTMLTextAreaElement).value).toBe("Keep this");
    expect(screen.queryByRole("textbox",{name:"Feedback for Person 25"})).toBeNull();
  });
});

it("sorts a zero rating above an unrated client profile",()=>{
  const rows=[{id:"blank",name:"Unrated",rating:""},{id:"zero",name:"Zero",rating:"0"},{id:"rated",name:"Rated",rating:"4.5"}].map(r=>({...r,subtitle:"",stage:"Recruiter shortlisted",values:{rating:r.rating},resume:false}));
  render(<ClientShareSheet token="token" rows={rows} columns={[{key:"rating",label:"Rating"}]} canEditNotes={false} roleName="Test role"/>);
  fireEvent.change(screen.getByRole("combobox",{name:"Sort shared candidates"}),{target:{value:"rating"}});
  expect([...document.querySelectorAll('tbody th')].map(x=>x.textContent)).toEqual(["Rated","Zero","Unrated"]);
});
