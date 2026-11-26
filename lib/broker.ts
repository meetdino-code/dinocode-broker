import { type Provider, providers } from "./providers.js";

export type Env = Record<string, string | undefined>;

const MAX_BODY = 8 * 1024;
const GRANTS = ["authorization_code", "refresh_token"];
const FORWARDED = ["grant_type", "code", "code_verifier", "redirect_uri", "refresh_token", "resource"];
const CALLBACK = "/mcp/oauth/callback";

export async function handle(
  request: Request,
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/" && request.method === "GET") {
    return json(200, { ok: true, service: "dinocode-broker" });
  }
  const [, route, name = "", ...rest] = url.pathname.split("/");
  if (rest.length > 0 || !Object.hasOwn(providers, name)) {
    return json(404, { error: "unknown_provider" });
  }
  const provider = providers[name];
  if (route === "callback" && request.method === "GET") return callback(url);
  if (route === "token" && request.method === "POST") {
    return token(request, name, provider, env, fetcher);
  }
  if (route === "revoke" && request.method === "POST" && provider.revokeUrl) {
    return revoke(request, provider.revokeUrl, fetcher);
  }
  return json(404, { error: "not_found" });
}

function callback(url: URL): Response {
  const state = url.searchParams.get("state") ?? "";
  const port = Number(/^(\d{4,5})\./.exec(state)?.[1]);
  if (!(port >= 1024 && port <= 65535)) return json(400, { error: "invalid_state" });
  return new Response(null, {
    status: 302,
    headers: {
      location: `http://localhost:${port}${CALLBACK}${url.search}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

async function token(
  request: Request,
  name: string,
  provider: Provider,
  env: Env,
  fetcher: typeof fetch,
): Promise<Response> {
  const form = await readForm(request);
  if (form instanceof Response) return form;
  const grant = form.get("grant_type") ?? "";
  if (!GRANTS.includes(grant)) return json(400, { error: "unsupported_grant_type" });
  const base = env.BROKER_BASE_URL?.replace(/\/+$/, "");
  const id = env[provider.clientId];
  const secret = env[provider.clientSecret];
  if (!base || !id || !secret) return json(500, { error: "broker_not_configured" });
  if (grant === "authorization_code" && form.get("redirect_uri") !== `${base}/callback/${name}`) {
    return json(400, { error: "invalid_redirect_uri" });
  }
  const body = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = form.get(key);
    if (value !== null) body.set(key, value);
  }
  body.set("client_id", id);
  body.set("client_secret", secret);
  return forward(provider.tokenUrl, body, fetcher);
}

async function revoke(request: Request, url: string, fetcher: typeof fetch): Promise<Response> {
  const form = await readForm(request);
  if (form instanceof Response) return form;
  const token = form.get("token");
  if (!token) return json(400, { error: "invalid_request" });
  return forward(url, new URLSearchParams({ token }), fetcher);
}

async function readForm(request: Request): Promise<URLSearchParams | Response> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) {
    return json(415, { error: "unsupported_media_type" });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return json(413, { error: "body_too_large" });
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: "body_too_large" });
  return new URLSearchParams(text);
}

async function forward(url: string, body: URLSearchParams, fetcher: typeof fetch): Promise<Response> {
  let answer: Response;
  try {
    answer = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      redirect: "error",
    });
  } catch {
    return json(502, { error: "provider_unreachable" });
  }
  return new Response(await answer.text(), {
    status: answer.status,
    headers: {
      "content-type": answer.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
