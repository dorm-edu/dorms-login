# dorms-login

[English](./README.md) | 한국어

선생님이 만든 사이트에 **"DoRms로 로그인"** 버튼을 다는 도구입니다. 도름스(https://dorms.school) 계정으로 로그인하고, **교사 인증 회원만**·**몇 도름 이상 받은 회원만** 같은 문은 도름스가 로그인 순간에 직접 지킵니다. 구글 로그인을 가져다 다는 것과 같은 그림입니다.

## 시작

1. 도름스 https://dorms.school/connect 에서 사이트 주소를 적고 누가 들어올 수 있는지 고르세요. 교사 인증을 마친 도름스 회원만 등록할 수 있어요.
2. 화면에 나온 프롬프트를 복사해 코딩에 쓰는 AI 도구에 붙여 넣으세요. AI가 아래 명령을 대신 실행합니다.

~~~bash
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.1.0.tar.gz detect
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.1.0.tar.gz init --client-id <사이트 id> --site https://내-사이트 [--require-teacher] [--min-dorms 10] [--email]
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.1.0.tar.gz doctor
~~~

`init` 은 Next.js App Router 프로젝트에 파일 6개를 넣습니다: `lib/dormsLogin.ts`, `components/DormsLoginButton.tsx`, `app/api/auth/dorms/{start,callback,logout}/route.ts`, `app/dorms-denied/page.tsx`. 환경 변수는 `DORMS_CLIENT_ID` 와 `DORMS_SITE_URL` 둘뿐이고 비밀값은 없습니다. 다른 스택은 [docs/PROTOCOL.md](./docs/PROTOCOL.md)를 보세요.

## 쓰는 법

~~~tsx
import { DormsLoginButton } from "@/components/DormsLoginButton";
import { getDormsUser, requireDormsUser } from "@/lib/dormsLogin";

// 로그인 화면
<DormsLoginButton next="/dashboard" />

// 서버 컴포넌트에서 회원 읽기
const user = await getDormsUser();            // 없으면 null
const member = await requireDormsUser({ next: "/dashboard" }); // 없으면 도름스 로그인으로, 문에 안 맞으면 /dorms-denied 로
~~~

`user` 에는 `id`(도름스 회원 id), `name`, `handle`, `picture`, `teacherVerified`, `dorms`(받은 도름 수), `email`(허용된 경우만)이 있습니다. 회원을 구분하는 기준은 `id` 입니다.

## 무엇이 전달되나

회원이 동의 화면에서 허용했을 때만 닉네임·프로필 사진·교사 인증 여부·받은 도름 수가 옵니다. 이메일은 제작자가 켜 두고 회원이 따로 허용한 사이트에만 옵니다. 비밀번호와 도름스 로그인 상태는 절대 오지 않습니다. 회원은 도름스에서 언제든 연결을 끊을 수 있습니다.

## 버전 고정

명령은 릴리스 tarball 을 고정합니다. 도름스 /connect 화면의 프롬프트가 늘 현재 판을 가리킵니다. 조직에서 특정 커밋을 검토했다면 그 커밋의 tarball 을 쓰세요.

Made by 홍창욱 (Team DoRm). [LICENSE](./LICENSE) · [SECURITY.md](./SECURITY.md)
