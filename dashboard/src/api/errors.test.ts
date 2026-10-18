import { describe, expect, it } from "vitest";
import { ApiError, readApiError } from "./errors";

describe("API error normalization", () => {
  it("retains backend error codes, messages, and field details", async () => {
    const error = await readApiError(new Response(JSON.stringify({
      error: { code: "VALIDATION_ERROR", message: "Request fields are invalid.", fields: { quantity: "Must be positive." } },
    }), { status: 400, headers: { "content-type": "application/json" } }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.fields?.quantity).toBe("Must be positive.");
  });

  it("gives a clear fallback for unavailable and non-JSON responses", async () => {
    const unavailable = await readApiError(new Response("gateway down", { status: 503 }));
    expect(unavailable.message).toContain("required service is unavailable");
    const invalid = await readApiError(new Response("bad gateway", { status: 502 }));
    expect(invalid.code).toBe("REQUEST_FAILED");
    expect(invalid.message).toContain("HTTP 502");
  });
});
