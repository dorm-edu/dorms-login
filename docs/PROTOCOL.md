# DoRms로 로그인 HTTP 계약 (모든 스택용)

Next.js App Router 가 아닌 사이트는 이 문서대로 붙입니다. 표준 OAuth 2.1 인가코드 + PKCE(S256) 흐름이고, OpenID 검색 문서가 있어 `openid-client`·Auth.js 같은 라이브러리가 자동으로 설정합니다. **클라이언트 시크릿은 없습니다.** 되돌아올 주소 정확 일치와 PKCE 가 결속을 맡습니다.

## 주소

| 무엇 | 주소 |
|---|---|
| 검색 문서 | `https://dorms.school/.well-known/openid-configuration` |
| 로그인 시작 | `GET https://dorms.school/api/sso/authorize` |
| 토큰 교환 | `POST https://dorms.school/api/sso/token` (JSON 또는 form) |
| 회원 정보 재조회 | `GET https://dorms.school/api/sso/userinfo` (`Authorization: Bearer`) |
| 공개키 | `https://dorms.school/api/sso/jwks` (EdDSA · Ed25519) |

사이트 id(`client_id`)와 되돌아올 주소는 도름스 https://dorms.school/connect 에서 받습니다. 되돌아올 주소는 기본적으로 `<사이트 주소>/api/auth/dorms/callback` 과 `http://localhost:3000/api/auth/dorms/callback` 두 개가 등록되고, 고급 설정에서 바꿀 수 있습니다.

## 1. 로그인 시작

브라우저를 아래 주소로 보냅니다(302). 값은 서버에서 만들고 `state`·`code_verifier`·`nonce` 는 httpOnly 쿠키(10분)에 둡니다.

```
https://dorms.school/api/sso/authorize
  ?response_type=code
  &client_id=<사이트 id>
  &redirect_uri=<등록한 되돌아올 주소, 정확히 같아야 함>
  &scope=openid profile            (이메일까지 켠 사이트만 "openid profile email")
  &state=<무작위 43자 이상>
  &nonce=<무작위>
  &code_challenge=<BASE64URL(SHA256(code_verifier))>
  &code_challenge_method=S256
```

도름스가 회원을 로그인시키고(처음이면 동의 화면), 문(교사 인증·도름 수)을 확인한 뒤 되돌아올 주소로 보냅니다.

- 성공: `?code=<2분 일회용 코드>&state=<보낸 state>`
- 거절: `?error=access_denied&error_description=<사람 말 설명>&state=<보낸 state>` (회원이 취소했거나 문에 안 맞음)
- 사이트 잠김: `error=unauthorized_client`, 허용 안 된 scope: `error=invalid_scope`

## 2. 토큰 교환 (서버에서)

```
POST https://dorms.school/api/sso/token
Content-Type: application/json
{ "grant_type": "authorization_code", "code": "...", "code_verifier": "...", "client_id": "<사이트 id>", "redirect_uri": "<1단계와 같은 주소>" }
```

응답:

```json
{ "token_type": "Bearer", "id_token": "<EdDSA JWT>", "access_token": "<EdDSA JWT, 10분>", "expires_in": 600, "id_token_expires_in": 604800, "scope": "profile" }
```

`id_token` 의 클레임: `iss=https://dorms.school`, `aud=<사이트 id>`, `sub`(도름스 회원 id), `name`, `handle`, `picture`, `teacher_verified`(boolean), `dorms`(받은 도름 수), `email`+`email_verified`(허용된 경우만), `nonce`, `iat`, `exp`. 서명은 공개키(JWKS)로 확인하고 `nonce` 가 보낸 값과 같은지 봅니다. 회원을 구분하는 기준은 `sub` 입니다. 이메일은 없을 수 있으니(애플 이메일 가리기 계정 등) 이메일로 계정을 합치지 마세요.

`id_token` 의 수명은 사이트가 도름스 /connect 고급 설정에서 정합니다(기본 7일, 1시간에서 30일). 사이트 세션으로 그대로 써도 됩니다.

## 3. 회원 정보 재조회 (선택)

민감한 동작 전에 지금 상태를 다시 물어봅니다. 교사 인증·도름 수·연결 끊김·사이트 잠금이 즉시 반영됩니다.

```
GET https://dorms.school/api/sso/userinfo
Authorization: Bearer <access_token 또는 id_token>
```

응답 `{ sub, name, handle, picture, teacher_verified, dorms, email?, email_verified? }`. 회원이 연결을 끊었거나 사이트가 잠기면 401, 문에 안 맞게 됐으면 403.

## 오류

| 오류 | 뜻 |
|---|---|
| `invalid_request` 400 | 파라미터가 빠졌거나 형식이 틀림(PKCE 는 S256 만) |
| `invalid_client` 400 | 모르는 사이트 id 이거나 등록되지 않은 되돌아올 주소. 도름스는 등록 안 된 주소로는 절대 돌려보내지 않음 |
| `invalid_grant` 400 | 코드가 만료(2분)·재사용·PKCE 불일치 |
| `rate_limited` 429 | 잠시 뒤 다시 |

## 한계 (솔직하게)

- 브라우저만 있는 사이트(백엔드 없는 SPA)도 PKCE 로 붙을 수 있지만, 그 경우 화면만 가릴 뿐 데이터를 지키지는 못합니다. 지켜야 할 데이터가 있으면 서버에서 `id_token` 을 확인하세요.
- 회원이 도름스에서 연결을 끊어도 만료 전 `id_token` 은 사이트에 남습니다. 필요하면 수명을 짧게 잡고 `userinfo` 로 재확인하세요.
