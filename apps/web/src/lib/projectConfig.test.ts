import { describe, expect, it } from "vitest";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  LOCAL_API_BASE_URL,
  LOCAL_SMOKE_HEALTH_URL,
  LOCAL_WEB_FALLBACK_PORT,
  LOCAL_WEB_PORT,
} from "./projectConfig";

describe("projectConfig", () => {
  it("centralizes local development ports and URLs", () => {
    expect(LOCAL_WEB_PORT).toBe(5273);
    expect(LOCAL_WEB_FALLBACK_PORT).toBe(5274);
    expect(LOCAL_API_BASE_URL).toBe("http://127.0.0.1:8150");
    expect(LOCAL_SMOKE_HEALTH_URL).toBe(`${LOCAL_API_BASE_URL}/api/health`);
  });

  it("centralizes the default API request timeout", () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(10000);
  });
});
