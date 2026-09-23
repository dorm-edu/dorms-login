---
name: dorms-login
description: 선생님이 만든 사이트에 "DoRms로 로그인" 버튼을 단다. 도름스(dorms.school) 계정으로 로그인하고, 교사 인증 회원만·몇 도름 이상만 같은 문은 도름스가 로그인 순간에 직접 지킨다. 비밀값이 없고 환경 변수는 DORMS_CLIENT_ID·DORMS_SITE_URL 둘뿐이다.
---

# dorms-login

사용자가 "DoRms로 로그인을 달아 달라"고 하면 그 프로젝트 폴더에서 [AGENTS.md](./AGENTS.md)의 순서를 따릅니다. 사이트 id 는 사용자가 도름스 https://dorms.school/connect 에서 받아 프롬프트에 넣어 옵니다. 없으면 그 주소에서 받아 오라고 안내하고 멈춥니다.

## 먼저 설명할 내용

- 구글 로그인처럼 도름스 계정으로 이 사이트에 들어오게 하는 기능입니다. 비밀번호는 사이트에 오지 않습니다.
- 누가 들어올 수 있는지(누구나·교사 인증만·몇 도름 이상)는 도름스가 로그인 순간에 확인합니다. 사이트 코드가 틀려도 문이 열리지 않습니다.
- 사이트에 비밀값은 없습니다. `DORMS_CLIENT_ID` 와 `DORMS_SITE_URL` 만 있으면 됩니다.

## 순서

`detect` → `init --client-id <id> --site <https://주소> [--require-teacher] [--min-dorms N] [--email]` → 버튼을 화면에 놓기 → `doctor` → 로컬에서 실제로 눌러 보기. 실행 예시는 [USE-WITH-AI.md](./USE-WITH-AI.md)에 있습니다.

`init` 은 `lib/dormsLogin.ts`, `components/DormsLoginButton.tsx`, `app/api/auth/dorms/{start,callback,logout}/route.ts`, `app/dorms-denied/page.tsx` 를 넣고 `.env.local` 에 두 값을 덧붙이며 `jose` 를 설치합니다. 기존 파일은 덮어쓰지 않고 `.dorms-login/` 아래에 참고본을 둡니다.

Next.js App Router 가 아니면 [docs/PROTOCOL.md](./docs/PROTOCOL.md)의 HTTP 계약으로 같은 흐름을 직접 붙입니다.

## 지킬 것

- 되돌아올 주소는 `<사이트 주소>/api/auth/dorms/callback` 입니다. 다른 경로로 바꾸지 마세요(도름스에 등록된 주소와 정확히 같아야 합니다).
- 회원 구분은 `sub`(도름스 회원 id)로 합니다. 이메일은 없을 수 있으니 이메일로 계정을 합치지 마세요.
- 버튼 아래 DoRms 안내 링크는 기본값입니다. 사용자가 바꾸자고 할 때만 바꿉니다.
- 배포는 사용자가 따로 요청할 때만 합니다. 배포 환경에 두 환경 변수를 넣어야 한다고 알려 주세요.
