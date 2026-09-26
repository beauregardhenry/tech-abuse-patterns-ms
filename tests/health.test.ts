import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
