import { describe, expect, it, vi } from "vitest";
import { handle } from "../lib/broker.js";

const env = {
  BROKER_BASE_URL: "https://broker.meetdino.co/",
  SLACK_CLIENT_ID: "123.456",
  SLACK_CLIENT_SECRET: "shh",
};
const callback = "https://broker.meetdino.co/callback/slack";

function get(path: string) {
  return handle(new Request(`https://broker.meetdino.co${path}`), env, unreachable());
}

function post(path: string, form: Record<string, string>, fetcher = unreachable()) {
  const request = new Request(`https://broker.meetdino.co${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  return handle(request, env, fetcher);
}

function unreachable() {
  return vi.fn<typeof fetch>(() => {
    throw new Error("the provider must not be called");
  });
}

describe("health", () => {
  it("answers on /", async () => {
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "dinocode-broker" });
  });
});

describe("callback", () => {
  it("bounces the exact query to the port named in state", async () => {
    const query = "?code=abc%2Fdef&state=19876.f00d&extra=a+b";
    const response = await get(`/callback/slack${query}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`http://localhost:19876/mcp/oauth/callback${query}`);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("passes an error through", async () => {
    const query = "?error=access_denied&error_description=No&state=40000.x";
    const response = await get(`/callback/slack${query}`);
    expect(response.headers.get("location")).toBe(`http://localhost:40000/mcp/oauth/callback${query}`);
  });

  it.each(["", "?state=abc", "?state=80.x", "?state=1023.x", "?state=65536.x", "?state=19876", "?state=+1999.x", "?state=evil.com:80.x"])(
    "refuses state %j",
    async (query) => {
      const response = await get(`/callback/slack${query}`);
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it.each(["/callback/unknown?state=19876.x", "/callback/constructor?state=19876.x", "/callback/slack/more?state=19876.x"])(
    "refuses %s",
    async (path) => {
      expect((await get(path)).status).toBe(404);
    },
  );
});

describe("token", () => {
  it("adds the secret and posts to the provider's fixed URL", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response('{"ok":true,"access_token":"xoxp"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const response = await post(
      "/token/slack",
      {
        grant_type: "authorization_code",
        code: "abc",
        code_verifier: "verifier",
        redirect_uri: callback,
        client_id: "someone-else",
        client_secret: "forged",
        token_url: "https://evil.example",
      },
      fetcher,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true,"access_token":"xoxp"}');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://slack.com/api/oauth.v2.user.access");
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      grant_type: "authorization_code",
      code: "abc",
      code_verifier: "verifier",
      redirect_uri: callback,
      client_id: "123.456",
      client_secret: "shh",
    });
  });

  it("refreshes without a redirect_uri and returns the provider's status", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"ok":false,"error":"invalid_refresh_token"}', { status: 400 }));
    const response = await post("/token/slack", { grant_type: "refresh_token", refresh_token: "r" }, fetcher);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_refresh_token" });
    const body = fetcher.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("client_secret")).toBe("shh");
    expect(body.get("refresh_token")).toBe("r");
  });

  it.each([
    [{ grant_type: "client_credentials" }, "unsupported_grant_type"],
    [{ code: "abc", redirect_uri: callback }, "unsupported_grant_type"],
    [{ grant_type: "authorization_code", code: "abc" }, "invalid_redirect_uri"],
    [{ grant_type: "authorization_code", code: "abc", redirect_uri: "http://localhost:19876/mcp/oauth/callback" }, "invalid_redirect_uri"],
    [{ grant_type: "authorization_code", code: "abc", redirect_uri: "https://broker.meetdino.co/callback/other" }, "invalid_redirect_uri"],
  ])("refuses %j", async (form, error) => {
    const response = await post("/token/slack", form);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
  });

  it("refuses unknown providers, big bodies and other content types", async () => {
    expect((await post("/token/unknown", { grant_type: "refresh_token" })).status).toBe(404);
    expect((await post("/token/slack", { grant_type: "refresh_token", refresh_token: "x".repeat(9000) })).status).toBe(413);
    const json = new Request("https://broker.meetdino.co/token/slack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect((await handle(json, env, unreachable())).status).toBe(415);
  });

  it("fails closed without its configuration", async () => {
    const request = new Request("https://broker.meetdino.co/token/slack", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token&refresh_token=r",
    });
    const response = await handle(request, { SLACK_CLIENT_ID: "123.456" }, unreachable());
    expect(response.status).toBe(500);
  });
});
