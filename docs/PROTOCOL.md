# DoRms login HTTP contract v0.4.0

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

## 도름이 착장 (선택 기능, v0.4.0)

회원이 도름스에서 꾸민 도름이(입은 아이템과 색)를 사이트가 불러옵니다. 사이트 운영자가 `/connect`에서 '도름이 착장도 받기'를 켜면 configuration 응답에 `doreumi: true`가 실리고, v0.4.0 도구는 authorize `scope`에 `doreumi`를 더합니다. `scopes` 배열에는 넣지 않으므로 v0.2·v0.3 설치본은 그대로 작동합니다. 회원은 동의 화면에서 착장 전달을 따로 허용합니다. 이미 받은 토큰에는 `doreumi`가 없으니 새로 로그인해야 착장을 받을 수 있습니다. 동의 범위가 바뀌면 동의 세대가 새로 바뀌어 다른 기기의 예전 로그인도 다시 로그인해야 합니다.

데스크톱 앱처럼 착장만 필요한 클라이언트는 `scope=openid doreumi`로 프로필 없이 착장만 받습니다(운영자가 등록, RFC 8252 루프백: 포트 없이 등록한 `http://localhost/<경로>` 로 그때그때 연 포트를 받는다). 이때 토큰과 userinfo에는 프로필 없이 `sub`만 있고, 이 `sub`는 그 사이트에서만 쓰는 별칭이라 도름스 회원 번호나 다른 사이트의 `sub`와 이어지지 않습니다.

- `GET /api/sso/doreumi`: `Authorization: Bearer <id_token 또는 access_token>`. 매번 현재 동의·사이트 옵션을 확인합니다. 성공 `{ sub, doreumi }`, 옵션이 꺼졌거나 범위가 없거나 연결을 끊었으면 403 `access_denied`, 로그인 만료는 401, 장애는 503입니다. 착장은 토큰과 userinfo에 싣지 않습니다(보호 요청마다 무거운 조회를 하지 않게).
- `doreumi` = `{ version: 1, items: [{ id, name, slots, hand, rigged, bone, asset, sha256, preview }], colors: { body?, belly?, head? }, model, rig, motions, license }`. `slots`는 `head, face, neck, top, bottom, shoes, back, hand` 가운데 하나 이상(한 벌 옷은 `top`과 `bottom`), `hand`는 손 아이템을 쥔 손(`leftHand`·`rightHand`)입니다. 색은 소문자 `#rrggbb`이고 없으면 기본색입니다.
- `GET /api/sso/doreumi/items/<id>`: 같은 Bearer. 토큰 주인이 **지금 입은** 아이템의 `.glb`만 줍니다(남의 아이템·안 입은 아이템은 404). 파일은 3MB 이하이고 아이템 id마다 바뀌지 않습니다. `sha256`으로 캐시 키를 잡을 수 있습니다. 공용 캐시에 두지 마세요.

### 그리는 법

- 기본 모형 `model`(EXT_meshopt_compression, three.js는 `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`)과 뼈대 계약 `rig`(`rig-contract.json`)를 씁니다. 뼈는 `root, body, torso, head, shoulderL/R, armL/R, elbowL/R, wristL/R, thighL/R, kneeL/R, shinL/R, footL/R`이고 부착점 `headAccessory`, `palmL/R`, `lap`이 있습니다. 기준 자세의 뼈 회전은 모두 0이며 `L`은 도름이 자신의 왼쪽(+X), 앞은 +Z입니다.
- `rigged: false`: 파일의 장면을 `bone` 이름의 노드(뼈 또는 부착점) 자식으로 붙입니다. 파일 안 좌표가 그 뼈 기준 좌표입니다. 손 아이템을 원래와 다른 손에 쥐면 반대쪽 같은 뼈에 붙이고 X 방향으로 거울처럼 뒤집습니다.
- `rigged: true`: 파일 안 `SkinnedMesh`의 관절을 이름으로 도름이 몸의 뼈에 다시 묶습니다(`new Skeleton(joints, garment inverseBinds)`, 몸 메시의 `bindMatrix`). 한 관절이라도 없으면 그 아이템은 건너뜁니다.
- 아이템 파일은 다른 선생님이 만든 파일입니다. 읽기 전에 GLB 안에 닫혀 있는지(`buffers[].uri`가 없고 `images[].uri`는 없거나 `data:image/...`) 확인하세요. 바깥 주소를 가리키면 불러오는 순간 그 주소로 요청이 나갑니다.
- 공식 아이템 `flower-pin`은 파일 없이 코드로 그립니다(`asset: null`). 공개 렌더러 [ainssam/doreumi-desktop-pet](https://github.com/ainssam/doreumi-desktop-pet)의 `web/src` 착장 코드(MIT)가 같은 규칙을 구현해 두었으니 참고하세요.
- 색 세 곳(몸통·배 문양·머리 문양)은 원래 그림 색을 흰색(#f2f4fa)과 남색(#041642) 사이에 놓고 그 비율로 새 색을 섞는 방식입니다. 눈·입이 있는 얼굴판은 칠하지 않습니다.

### 동작

`model`에는 기본 동작 26개(Idle, Walk, Run, Wave, Showcase, HeadTilt, Sit, Think, Bow, Stretch 등)가 들어 있습니다. `motions`는 동작 목록(JSON)이며 각 항목의 `url`은 three.js `AnimationClip.toJSON` 형식이고 트랙 이름은 위 뼈 이름(`body.quaternion` 등)입니다. `AnimationClip.parse()` 결과를 `AnimationMixer`로 같은 모형에 재생하면 됩니다. 모형·동작 파일은 공개 자료라 로그인 없이 받을 수 있습니다.

- 목록 항목의 `ambient: true`는 도름스가 저절로 틀어도 어울린다고 고른 동작이고, `props`가 있는 동작은 줄넘기 같은 소품을 쥔 모습을 가정합니다. 가만히 있을 때 무작위로 틀려면 `ambient`이면서 `props`가 비어 있는 동작을 고르면 자연스럽습니다.
- 동작은 원래 모형의 뼈대 기준입니다. 다른 뼈대로 옮겨 쓰면 회전 중심(관절 위치)을 원래 모형과 같은 자리에 두고, 한 뼈에 두 관절을 합치지 마세요. 어긋나면 팔을 크게 들 때 몸과 옷이 따로 움직입니다. 원래 모형 그대로 재생하면 신경 쓸 일이 없습니다.

### 쓰는 범위

착장은 그 회원의 도름이를 보여 줄 때만 씁니다. 아이템은 만든 선생님의 작품입니다. 따로 모아 두거나 다른 회원·다른 캐릭터에 쓰거나 다시 배포하지 마세요. 도름이 캐릭터·모형·표정·동작은 아인T의 작품(CC BY-NC 4.0)이며 화면에 '도름이 © 아인T, CC BY-NC 4.0' 표기를 남깁니다.

## 도름네이션 (선택 기능, v0.3.0)

내가 만든 앱에 사람들이 도름스로 로그인하고, 서로에게 도름을 줄 수 있어요(도름네이션).

사이트 운영자가 `/connect`의 해당 앱 카드에서 도름네이션 설치 프롬프트 복사 버튼을 누르면 사용 신청도 자동으로 접수됩니다. 신청자 본인 이름으로 홍창욱 계정에 쪽지가 가며, 관리자가 승인해야 사용할 수 있습니다. 로그인 설치 프롬프트 복사와 CLI 설치 명령은 사용 신청을 접수하지 않습니다. 이용자는 최초 한 번 도름 사용에 동의합니다. 모든 연동 사이트를 합쳐 한 사람당 한국 시간 하루 최대 3도름을 보냅니다. 수신자는 해당 앱에서 실제로 도름스로 로그인한 회원이어야 합니다. 보낸 사람의 누적 도름은 줄고 받은 사람은 늘어 랭킹에도 반영됩니다. 받은 양은 주간·월간 랭킹, 보낸 양은 응원단장에 집계됩니다. 받은 도름은 상점에서도 쓸 수 있습니다. 기존 성공 거래도 한 번만 소급 반영합니다. API 요청·응답은 같으므로 이미 설치된 사이트도 재설치 없이 같은 방식으로 작동합니다.

기존 `openid profile email` scope 및 로그인 응답은 그대로입니다. 별도의 도름네이션 권한으로 도름 전송만 허용하며 DB 접근권한·서비스 키·클라이언트 비밀키는 필요하지 않습니다.

- `GET /api/connect/donations/authorize`: `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, `session_expires_at`(현재 로그인 만료 epoch 초). Dorms 로그인 및 최초 동의 후 `code`, `state`를 되돌립니다. 등록된 사이트 origin의 `/api/auth/dorms/donation/callback`만 사용합니다.
- `POST /api/connect/donations/token`: 현재 로그인 ID 토큰을 `Authorization: Bearer <id_token>` 헤더에 넣고 JSON `{client_id, redirect_uri, code, code_verifier}`. 응답 `{donation_token, expires_in, subject}`. 공급자는 로그인 토큰의 서명·발급자·대상 사이트·회원·동의 세대·만료를 검증하고 발급되는 도름네이션 토큰을 그 로그인 만료 이내, 최대 7일로 제한합니다. 브라우저가 주장한 `session_expires_at`만으로 수명을 늘릴 수 없습니다. 로그인 ID 토큰은 이 교환 요청에서만 쓰고 status/send/revoke에는 전용 도름네이션 토큰을 사용합니다.
- `GET /api/connect/donations/status`: 전용 토큰의 Bearer 인증. 응답 `{subject, availableBalance, dailyRemaining, resetsAt}`. `resetsAt`은 ISO 8601 시각입니다.
- `POST /api/connect/donations/send`: 동일 인증과 JSON `{recipientId, amount, requestId}`. 수량은 1~3 정수, 두 ID는 UUID입니다. 응답 `{transferId, amount, availableBalance, dailyRemaining, resetsAt}`는 DB 반영 후에만 반환됩니다.
- `POST /api/connect/donations/revoke`: 동일 인증. 토큰 폐기 후 JSON 응답을 반환합니다.

서버용 `getDonationStatus()`와 `sendDonation({recipientId, amount, requestId})`는 매번 현재 로그인 상태를 검사합니다. 전송 결과를 요청 사이에 캐시하지 않습니다. 공개 status/send 라우트에는 토큰이 포함되지 않습니다. 토큰은 host-only, HttpOnly, SameSite=Lax, 운영 Secure 쿠키에 넣고 현재 로그인 세션과 묶습니다. 로그아웃 시 Dorms의 토큰 폐기가 확인된 다음 쿠키를 지웁니다. 폐기 서버가 응답하지 않으면 로그아웃은 503으로 실패하므로 다시 시도해야 합니다.

브라우저에서 보내는 전송은 같은 origin의 JSON POST만 허용합니다. 사용자 정의 서버 액션에서도 Origin 검사를 유지하세요. 출처를 알 수 없는 요청, 비허용 origin, 다른 사이트 요청은 거절합니다. 런타임은 Node.js입니다.

`requestId`는 전송 시도마다 `crypto.randomUUID()`로 만들고 응답 유실·네트워크 장애·5xx 재시도에는 같은 ID와 원래 수신자·수량을 사용합니다. 성공·업무상 거절 뒤 새 전송은 새 ID를 씁니다. 자정을 넘겨도 재시도는 같은 결과입니다. 성공이 확인되기 전 방송 효과나 잔액 증가를 표시하지 않습니다.

실패 응답의 `{reason}`과 HTTP 상태를 보존합니다. `authentication_required`는 로그인, `consent_required`는 최초 허용 안내로 처리합니다. 미신청이면 운영자가 `/connect`에서 해당 앱의 도름네이션 설치 프롬프트를 복사하도록 안내하고, 이미 신청했다면 관리자 승인을 기다리도록 안내합니다. 잔액 부족과 일일 한도는 각각 사용자 안내로 처리합니다. 429·5xx·연결 실패는 성공 여부 미확정이므로 같은 요청으로 재확인합니다. `doctor`는 사이트의 승인 상태를 확인하며 개별 회원 동의 여부는 그 회원의 실제 첫 사용에서 확인합니다.

외부 앱이 침해되면 동의한 회원의 하루 한도 안에서 도름 전송이 오용될 수 있습니다. 운영자 중지·회원 연결 철회가 다음 요청부터 적용됩니다. 도름을 받는 것만으로 다른 회원의 잔액이나 회원 정보를 조회할 권한은 생기지 않습니다.
