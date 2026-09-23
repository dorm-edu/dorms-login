# AI에게 "DoRms로 로그인" 달기 맡기기

도름스 https://dorms.school/connect 에서 사이트를 등록하면 아래와 같은 프롬프트가 사이트 id·주소·정책이 채워진 채로 나옵니다. 그것을 복사해 AI 도구(클로드 코드·코덱스·커서 등)에 붙여 넣으면 됩니다. 아래는 그 프롬프트의 본보기입니다.

~~~text
내 사이트에 "DoRms로 로그인" 버튼을 달아줘. 도름스(dorms.school)는 교사 커뮤니티고, 이 로그인은 구글 로그인처럼 도름스 계정으로 내 사이트에 들어오게 해 주는 기능이야. 이 사이트에 들어올 수 있는 사람: 교사 인증 회원만. 이 기준은 도름스가 로그인 순간에 직접 확인하니까 내 코드가 따로 막지 않아도 돼.

1. 먼저 npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.1.0.tar.gz detect 로 내 프로젝트 종류를 확인해줘. 이 도구는 npm 에 없으니 위 깃허브 주소 그대로 실행해.
2. npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.1.0.tar.gz init --client-id <사이트 id> --site <https://내-사이트> --require-teacher 로 파일을 넣어줘. 기존 파일이 있으면 덮어쓰지 말고 무엇이 겹치는지 먼저 알려줘.
3. 로그인 버튼(components/DormsLoginButton.tsx)을 로그인 화면이나 첫 화면에 놓고, 로그인이 필요한 페이지에서는 lib/dormsLogin.ts 의 getDormsUser() 와 requireDormsUser() 를 써줘. 버튼 디자인과 버튼 아래 DoRms 안내 링크는 기본값 그대로 두고, 내가 바꾸자고 할 때만 바꿔.
4. 되돌아올 주소는 정확히 <https://내-사이트>/api/auth/dorms/callback 이어야 해. 다른 경로로 만들지 마. 로컬 개발에서는 http://localhost:3000/api/auth/dorms/callback 도 그대로 돼.
5. 내 사이트에는 비밀값이 필요 없어. 환경 변수는 DORMS_CLIENT_ID 와 DORMS_SITE_URL 둘뿐이야. 배포 환경(Vercel 등)에도 같은 값을 넣어줘.
6. 다 되면 로컬에서 버튼을 눌러 도름스 로그인 화면이 뜨고, 허용을 누르면 내 사이트로 돌아와 닉네임이 보이는지 확인해줘. 안 되면 npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.1.0.tar.gz doctor 로 원인을 알려줘.

내 프로젝트가 Next.js 가 아니면 도구가 알려주는 PROTOCOL.md 를 읽고 같은 흐름(OAuth 2.1 인가코드 + PKCE, 표준 검색 문서 https://dorms.school/.well-known/openid-configuration)으로 붙여줘. 이 사이트는 이메일을 받지 않아. 회원 구분은 sub(도름스 회원 id)로 해줘.
~~~
