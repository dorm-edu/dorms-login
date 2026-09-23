# DoRms login HTTP contract v0.2.0

This contract describes authorization code + PKCE (S256), discovery, an ID token, and userinfo. It implements the core OIDC login flow used here; it does not promise every OIDC feature or automatic compatibility with every OIDC library. There is no client secret. Register a site as a verified teacher at https://dorms.school/connect.

## Endpoints

| Purpose | URL |
|---|---|
| Discovery | `https://dorms.school/.well-known/openid-configuration` |
| Current client configuration | `GET https://dorms.school/api/sso/clients/<client_id>/configuration?redirect_uri=<URL-encoded registered callback>` |
| Authorization | `GET https://dorms.school/api/sso/authorize` |
| Token exchange | `POST https://dorms.school/api/sso/token` |
| Current permission/profile | `GET https://dorms.school/api/sso/userinfo` |
| Public keys | `https://dorms.school/api/sso/jwks` |

Keep these provider addresses fixed. The development-only `DORMS_API_ORIGIN_DEV` in the Next template accepts a localhost origin and is ignored in production.

## Before each login

Fetch the configuration endpoint with the exact callback URL. A registered, active site returns `{ "active": true, "scopes": ["openid", "profile"] }`, optionally including `"email"`. An invalid callback or inactive site is refused. The response is `no-store`; fetch it again for each login so email settings are current. Do not copy scopes or provider policy into installed code.

Automatic installation supports a root HTTPS origin such as `https://example.com`, with callback `https://example.com/api/auth/dorms/callback`. `http://localhost:3000/api/auth/dorms/callback` is registered for local development. Other local ports require exact registration. The CLI rejects deployment subpaths/basePath; another stack or path layout requires a manual integration and an explicitly registered callback.

## Authorization

Generate independent random `state`, `nonce`, and `code_verifier` values with at least 32 bytes of entropy. Keep them in an httpOnly, SameSite=Lax flow cookie for at most 10 minutes, with Secure enabled in production. The Next template uses bounded base64url JSON with a creation time, not delimiter-separated fields.

Redirect the browser to the authorization endpoint with:

```text
response_type=code
client_id=<registered UUID>
redirect_uri=<exact registered callback>
scope=<current configuration scopes, space separated>
state=<random base64url>
nonce=<random base64url>
code_challenge=<base64url SHA-256 of code_verifier>
code_challenge_method=S256
```

DoRms authenticates the member, obtains consent, checks current policy and sends `code` and `state` to the registered callback. The code expires in two minutes and can be exchanged once. Errors return an OAuth error code with `state` where a safe registered callback is available. Validate state on both success and error; never display an arbitrary `error_description` from a URL.

Only `response_mode=query` is supported. `prompt` (including `none`/`login`), `max_age`, `claims`, `acr_values`, `request`, `request_uri`, `id_token_hint` and `registration` are explicitly rejected rather than silently ignored. These unsupported parameters produce a direct JSON `400 invalid_request` with an explanation, before a safe callback has been established. Configure a general OIDC library to use this supported subset; not every error is delivered by redirect.

## Token exchange

Send JSON or form data from your server:

```json
{ "grant_type": "authorization_code", "code": "...", "code_verifier": "...", "client_id": "...", "redirect_uri": "..." }
```

The callback must exactly match authorization. The response contains `token_type: "Bearer"`, `id_token`, `access_token`, `expires_in`, `id_token_expires_in` and `scope`. Access tokens last 10 minutes; ID tokens default to seven days with a configurable lifetime. Token lifetime does not replace the current-permission check below.

Verify the ID token using JWKS, EdDSA, issuer `https://dorms.school`, your exact client audience, expiration, and required `sub`, `iat`, `exp`, `jti`, `grant_version`. `sub` and `grant_version` are UUIDs. Verify the nonce from your flow cookie. Bind member identity to `sub`, never email. Treat a legacy token without `grant_version` as requiring a new login.

Profile claims include `name`, `handle`, `picture`, `teacher_verified` and `dorms`. Optional `email` and `email_verified` require permission; email may be absent, including for Apple private relay accounts. The template stores the signed ID token in an httpOnly session cookie. Never expose the token in a client component, URL, log or error response.

## Every protected request

After verifying the local token, call userinfo with `Authorization: Bearer <id_token or access_token>`, without caching. Do this before both protected page rendering and every API/server-action data operation. Userinfo checks the current grant generation, member, site, owner and policy. Confirm the returned `sub` matches the verified token before using the profile.

The success response is `{ sub, name?, handle?, picture?, teacher_verified, dorms, email?, email_verified? }`. Revoking consent invalidates the grant generation. Re-consenting creates a new generation, so an old token stays invalid even after permission is granted again. Current policy and optional profile data come from this response, not stale token claims. Existing sites need v0.2.0-equivalent server checks; publishing a new tool version cannot retrofit their copied code.

| Failure reason | Consumer behavior |
|---|---|
| `authentication_required` | Missing, expired, invalid or legacy authentication. Ask for a new login. |
| `access_denied` | Revoked consent, disabled site/owner or unmet current policy. Deny access and show a stable explanation. Do not automatically restart login. |
| `temporarily_unavailable` | Rate limit, server/network/database failure. Deny the protected operation and invite a later retry. Do not reuse old claims or restart login. |

Error bodies include `{ error, reason }`. The SDK maps denied access to 403 and unavailable checks to 503. A 429/5xx/network error is always unavailable. A 401 without a reason is treated as authentication required for older-provider compatibility. API consumers must reject before returning or changing any protected data.

## Limits

No refresh-token, single-logout, token introspection or complete OIDC conformance is claimed. Local logout clears this site's session and flow cookies using a same-origin POST; it does not log the member out of DoRms. A browser-only app cannot protect data already shipped to the browser. Put verification on the data-serving backend. Authorization cannot revoke data previously downloaded or retroactively stop an operation already authorized.
