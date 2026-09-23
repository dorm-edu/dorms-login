# dorms-login 작업 순서 (모든 AI 공통)

1. `npx -y <릴리스 tarball 주소> detect` 로 프로젝트 종류를 확인한다. App Router 가 아니면 `docs/PROTOCOL.md` 로 간다.
2. 사용자가 준 사이트 id(uuid)와 사이트 주소(https)로 `init` 을 실행한다. 정책 플래그(`--require-teacher`, `--min-dorms N`, `--email`)는 사용자가 준 프롬프트 그대로 쓴다.
3. `init` 이 건너뛴 파일(이미 있던 것)이 있으면 무엇이 겹치는지 사용자에게 알리고 `.dorms-login/` 참고본과 비교해 합친다.
4. `<DormsLoginButton />` 을 로그인 화면이나 첫 화면에 놓는다. 로그인이 필요한 서버 컴포넌트에서는 `await requireDormsUser({ next: "/그 경로" })` 를 부른다. 서버 액션·라우트에서는 `getDormsUser()` 로 회원을 읽는다.
5. `doctor` 를 돌려 전부 OK 인지 본다.
6. 로컬에서 실제로 버튼을 눌러 도름스 로그인 화면이 뜨고, 허용 뒤 사이트로 돌아와 닉네임이 보이는지 확인한다.
7. 배포 환경에 `DORMS_CLIENT_ID`, `DORMS_SITE_URL` 을 넣으라고 안내한다. 비밀값이 아니다.

하지 말 것: 되돌아올 주소 바꾸기, 이메일로 계정 합치기, 임의로 배포하기, 도름스 주소(`https://dorms.school`)를 다른 곳으로 바꾸기.
