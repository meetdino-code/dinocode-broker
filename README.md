# dinocode-broker

A stateless OAuth token broker for dinocode, the coding agent.

Some providers (Slack first) only accept HTTPS redirect URLs for distributed apps, and once the redirect is HTTPS they treat the app as a server app and require its client secret at the token endpoint. dinocode is a local binary: it signs in through a callback on `http://localhost` and can't keep a secret. The broker is the HTTPS redirect, and it adds the secret to token requests. It also relays revocation when you sign out, so dinocode has one fixed place to send a brokered provider's tokens. That's all it does.

## It stores nothing

There is no database, no cache, no session and no cookie. Every request is handled on its own and forgotten. The broker never logs request bodies, codes, tokens or secrets. It holds only its configuration: one client ID and secret per provider.

An authorization code passing through the callback is single-use and bound by PKCE to a verifier that only the dinocode process on your machine knows, so the broker can't redeem it on its own, and it never redirects anywhere except your own machine.

## Endpoints

### `GET /callback/:provider`

The provider redirects here after sign-in. The broker answers `302` to

```
http://localhost:<port>/mcp/oauth/callback?<the same query>
```

`<port>` comes from `state`, which dinocode sends as `<port>.<random>`. The port must be from 1024 to 65535 and the provider must be known, or the broker answers `400` or `404`. The query, including `error` and `error_description`, is passed through byte for byte. The target host and path are fixed.

### `POST /token/:provider`

An OAuth token request, form-encoded:

- `grant_type` must be `authorization_code` or `refresh_token`.
- For `authorization_code`, `redirect_uri` must be `<BROKER_BASE_URL>/callback/<provider>`.
- Only `grant_type`, `code`, `code_verifier`, `redirect_uri`, `refresh_token` and `resource` are forwarded. The broker sets `client_id` and `client_secret` from its environment, replacing any the caller sent.
- The request goes to the provider's fixed token URL, and the provider's status and body come back unchanged.
- Bodies over 8 KiB are refused.

### `POST /revoke/:provider`

Revokes a token when dinocode signs out, form-encoded:

- `token` is required. `token_type_hint` is accepted and ignored.
- Only `token` is forwarded, as a form field, to the provider's fixed revoke URL. The broker adds no client ID or secret, because revoking needs only the token.
- The provider's status and body come back unchanged. Slack's `auth.revoke` answers `200` even when it fails, with `{"ok":false,"error":"..."}`.
- Bodies over 8 KiB are refused. A provider without a revoke URL answers `404`.

### `GET /`

Health check: `{"ok":true,"service":"dinocode-broker"}`.

## Configuration

| Variable | Meaning |
| --- | --- |
| `BROKER_BASE_URL` | The broker's public origin, e.g. `https://broker.meetdino.co`. |
| `SLACK_CLIENT_ID` | The Slack app's client ID. |
| `SLACK_CLIENT_SECRET` | The Slack app's client secret. |

The token endpoint answers `500` until a provider's variables are set.

## Deploying

1. Import the repository as a Vercel project. No build settings are needed.
2. Set the environment variables above for Production.
3. Add the domain `broker.meetdino.co` to the project and point a `CNAME` record for `broker` at `cname.vercel-dns.com`.
4. In the provider's app settings, set the redirect URL to `https://broker.meetdino.co/callback/<provider>`.

Check it with:

```sh
curl -i https://broker.meetdino.co/
curl -i "https://broker.meetdino.co/callback/slack?code=test&state=19876.abc"
```

The second should answer `302` with `location: http://localhost:19876/mcp/oauth/callback?code=test&state=19876.abc`.

## Adding a provider

Add an entry to [`lib/providers.ts`](lib/providers.ts) with the provider's token URL, its revoke URL if it has one that needs only the token, and the names of its client ID and secret variables, set those variables in Vercel, and register `https://broker.meetdino.co/callback/<provider>` as the app's redirect URL.

## Development

```sh
npm install
npm test
npm run typecheck
```

## License

MIT
