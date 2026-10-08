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

## 도름네이션 (선택 기능, v0.3.0)

내가 만든 앱에 사람들이 도름스로 로그인하고, 서로에게 도름을 줄 수 있어요(도름네이션).

사이트 운영자가 `/connect`에서 신청하고 관리자가 승인해야 사용할 수 있습니다. 이용자는 최초 한 번 도름 사용에 동의합니다. 모든 연동 사이트를 합쳐 한 사람당 한국 시간 하루 최대 3도름을 보냅니다. 수신자는 해당 앱에서 실제로 도름스로 로그인한 회원이어야 합니다. 사용 가능한 잔액만 이동하고 평판·랭킹은 늘어나지 않습니다.

기존 `openid profile email` scope 및 로그인 응답은 그대로입니다. 별도의 도름네이션 권한으로 도름 전송만 허용하며 DB 접근권한·서비스 키·클라이언트 비밀키는 필요하지 않습니다.

- `GET /api/connect/donations/authorize`: `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, `session_expires_at`(현재 로그인 만료 epoch 초). Dorms 로그인 및 최초 동의 후 `code`, `state`를 되돌립니다. 등록된 사이트 origin의 `/api/auth/dorms/donation/callback`만 사용합니다.
- `POST /api/connect/donations/token`: 현재 로그인 ID 토큰을 `Authorization: Bearer <id_token>` 헤더에 넣고 JSON `{client_id, redirect_uri, code, code_verifier}`. 응답 `{donation_token, expires_in, subject}`. 공급자는 로그인 토큰의 서명·발급자·대상 사이트·회원·동의 세대·만료를 검증하고 발급되는 도름네이션 토큰을 그 로그인 만료 이내, 최대 7일로 제한합니다. 브라우저가 주장한 `session_expires_at`만으로 수명을 늘릴 수 없습니다. 로그인 ID 토큰은 이 교환 요청에서만 쓰고 status/send/revoke에는 전용 도름네이션 토큰을 사용합니다.
- `GET /api/connect/donations/status`: 전용 토큰의 Bearer 인증. 응답 `{subject, availableBalance, dailyRemaining, resetsAt}`. `resetsAt`은 ISO 8601 시각입니다.
- `POST /api/connect/donations/send`: 동일 인증과 JSON `{recipientId, amount, requestId}`. 수량은 1~3 정수, 두 ID는 UUID입니다. 응답 `{transferId, amount, availableBalance, dailyRemaining, resetsAt}`는 DB 반영 후에만 반환됩니다.
- `POST /api/connect/donations/revoke`: 동일 인증. 토큰 폐기 후 JSON 응답을 반환합니다.

서버용 `getDonationStatus()`와 `sendDonation({recipientId, amount, requestId})`는 매번 현재 로그인 상태를 검사합니다. 전송 결과를 요청 사이에 캐시하지 않습니다. 공개 status/send 라우트에는 토큰이 포함되지 않습니다. 토큰은 host-only, HttpOnly, SameSite=Lax, 운영 Secure 쿠키에 넣고 현재 로그인 세션과 묶습니다. 로그아웃 시 Dorms의 토큰 폐기가 확인된 다음 쿠키를 지웁니다. 폐기 서버가 응답하지 않으면 로그아웃은 503으로 실패하므로 다시 시도해야 합니다.

브라우저에서 보내는 전송은 같은 origin의 JSON POST만 허용합니다. 사용자 정의 서버 액션에서도 Origin 검사를 유지하세요. 출처를 알 수 없는 요청, 비허용 origin, 다른 사이트 요청은 거절합니다. 런타임은 Node.js입니다.

`requestId`는 전송 시도마다 `crypto.randomUUID()`로 만들고 응답 유실·네트워크 장애·5xx 재시도에는 같은 ID와 원래 수신자·수량을 사용합니다. 성공·업무상 거절 뒤 새 전송은 새 ID를 씁니다. 자정을 넘겨도 재시도는 같은 결과입니다. 성공이 확인되기 전 방송 효과나 잔액 증가를 표시하지 않습니다.

실패 응답의 `{reason}`과 HTTP 상태를 보존합니다. `authentication_required`는 로그인, `consent_required`는 최초 허용, 승인 대기는 사이트 운영자 신청·승인 안내, 잔액 부족과 일일 한도는 각각 사용자 안내로 처리합니다. 429·5xx·연결 실패는 성공 여부 미확정이므로 같은 요청으로 재확인합니다. `doctor`는 사이트의 승인 상태를 확인하며 개별 회원 동의 여부는 그 회원의 실제 첫 사용에서 확인합니다.

외부 앱이 침해되면 동의한 회원의 하루 한도 안에서 도름 전송이 오용될 수 있습니다. 운영자 중지·회원 연결 철회가 다음 요청부터 적용됩니다. 도름을 받는 것만으로 다른 회원의 잔액이나 회원 정보를 조회할 권한은 생기지 않습니다.
