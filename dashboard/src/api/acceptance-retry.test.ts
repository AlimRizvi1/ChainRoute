import { afterEach, expect, it, vi } from "vitest";
import { acceptPlan, type AcceptInput } from "./optimization";
import { writeSession } from "../auth/session";

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });
it("retries identical agreement terms with the same key and lets corrected terms use a new key", async () => {
  writeSession({token:"test",expiresAt:Date.now()+60000,user:{id:"shipper",username:"shipper",role:"Shipper"}});
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ contractId: "1", state: "Created" }), {status:200,headers:{"content-type":"application/json"}}));
  vi.stubGlobal("fetch",fetch);
  const input: AcceptInput = {carrierAddress:`0x${"2".repeat(40)}`,terms:{freightValuePaise:"100",penaltyBpsPerBlock:100,penaltyBlockSeconds:3600,freeHoldingHours:4,demurrageRatePaisePerWagonHour:"500",wagonCount:1}};
  await acceptPlan("plan-1",input); await acceptPlan("plan-1",input);
  await acceptPlan("plan-1",{...input,terms:{...input.terms,freightValuePaise:"200"}});
  const key = (index:number) => (fetch.mock.calls[index][1].headers as Headers).get("idempotency-key");
  expect(key(0)).toBe(key(1)); expect(key(2)).not.toBe(key(0)); expect(key(0)!.length).toBeLessThanOrEqual(128);
});
