# dorms-login

[English](./README.md) | 한국어

선생님이 만든 사이트에 **DoRms로 로그인** 버튼을 답니다. 도름스 계정으로 들어오고, 교사 인증 여부나 받은 도름 수로 입장 조건을 정할 수 있어요. 사이트마다 비밀번호를 새로 만들 필요가 없습니다.

## 시작하기

1. [도름스에서 사이트를 등록](https://dorms.school/connect)하세요. 교사 인증을 마친 회원만 등록할 수 있어요.
2. 화면의 프롬프트를 복사해 코딩에 쓰는 AI에게 붙여 넣으세요.
3. AI가 설치와 확인을 마치면 실제로 로그인하고 로그아웃해 보세요. 도름스에서 연결을 끊은 뒤에는 보호한 자료가 다시 열리지 않는지도 확인하세요.

자동 설치는 **Node.js 22 이상, TypeScript, Next.js 15 이상 App Router, 도메인 첫 경로**를 사용하는 프로젝트용입니다. `https://example.com/my-app` 같은 하위 경로, Pages Router, 브라우저만 있는 사이트는 자동 설치 대상이 아닙니다. 다른 환경은 AI가 [연동 계약](./docs/PROTOCOL.md)을 보고 서버 쪽 확인까지 구현해야 합니다. 이번 판은 Next.js 15.5.26의 `app/`와 `src/app/` 프로젝트에서 실제 빌드를 확인합니다.

AI가 실행하는 명령입니다. npm에 게시한 패키지가 아니므로 GitHub 주소를 그대로 사용합니다.

```sh
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.2.0.tar.gz detect
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.2.0.tar.gz init --client-id '<사이트 id>' --site 'https://example.com'
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.2.0.tar.gz doctor
```

`init`은 로그인 파일 6개와 설치 기록 `.dorms-login.json`을 만들고 `jose`를 설치합니다. 환경 변수는 공개값인 `DORMS_CLIENT_ID`, `DORMS_SITE_URL` 두 개입니다. 배포 환경에도 같은 값을 넣어야 합니다. 기존 파일은 덮어쓰지 않습니다.

## 버튼과 보호할 자료 연결하기

다음 코드는 개발 도구에 전달할 예시입니다. `@/` 별칭을 쓰지 않는 프로젝트에서는 AI가 실제 파일 위치에 맞춰 가져오면 됩니다. 설치 도구가 만든 파일끼리는 상대 경로를 사용합니다.

```tsx
import { DormsLoginButton } from "@/components/DormsLoginButton";
import { requireDormsUser, dormsLogoutHref } from "@/lib/dormsLogin";

// 로그인 화면에 배치
<DormsLoginButton next="/dashboard" />

// 보호할 페이지의 서버 컴포넌트에서 실행
const user = await requireDormsUser({ next: "/dashboard" });

// 이 사이트에서 로그아웃
<form method="post" action={dormsLogoutHref}>
  <button type="submit">로그아웃</button>
</form>
```

**화면에 버튼만 넣는 것으로 자료가 보호되지는 않습니다.** 자료를 읽거나 저장하는 API와 서버 액션에서도 처리 전에 `getDormsUser()`를 호출해야 합니다. 확인 결과를 다음 요청에 재사용하거나, 확인 실패 때 예전 로그인 정보로 계속 처리하면 안 됩니다. 각 자료의 소유자를 확인하는 기존 권한 검사도 유지하세요.

다음은 보호한 회원 정보 API의 예시입니다.

```ts
import { DormsAuthError, getDormsUser } from "@/lib/dormsLogin";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await getDormsUser();
    if (!user) return Response.json({ reason: "authentication_required" }, { status: 401 });
    return Response.json({ id: user.id, name: user.name }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DormsAuthError) {
      return Response.json({ reason: error.reason }, { status: error.status });
    }
    throw error;
  }
}
```

`user`에는 `id`, `name`, `handle`, `picture`, `teacherVerified`, `dorms`, `email`, `expiresAt`이 있습니다. 사람을 구분하는 기준은 `id`입니다. 이메일이 없을 수 있으므로 이메일로 다른 계정을 합치지 마세요.

## 허용 상태가 바뀌면

v0.2.0의 `getDormsUser()`, `requireDormsUser()`, `refreshDormsUser()`는 호출할 때마다 도름스에 현재 허용 상태를 확인합니다. 연결 끊기, 사이트 잠금, 입장 조건 변경은 **다음 보호 요청에서** 반영됩니다. 도름스가 응답하지 못할 때도 자료를 열지 않고 잠시 뒤 다시 시도하도록 안내합니다. 화면을 이미 열어 둔 사람이 내려받은 자료까지 회수하는 기능은 아닙니다.

- 로그인 전·만료·예전 판의 로그인: `getDormsUser()`는 `null`을 반환합니다. 페이지의 `requireDormsUser()`는 새 로그인을 시작합니다.
- 연결 철회·사이트 잠금·조건 불충족: `DormsAuthError`, `reason: access_denied`, 상태 `403`입니다.
- 응답 지연·요청 제한·서버 장애: `DormsAuthError`, `reason: temporarily_unavailable`, 상태 `503`입니다.

거절과 장애는 자동 로그인 반복으로 처리하지 않습니다. `requireDormsUser()`가 안내 화면을 열고 회원이 직접 다시 시도합니다. 이메일 요청 여부도 로그인할 때 도름스의 현재 설정을 읽습니다. 사이트만의 추가 조건이 필요하면 `requireDormsUser({ requireTeacher: true, minDorms: 10 })`처럼 명시할 수 있습니다.

## 이미 설치했다면

공개 도구의 새 판을 내도 각 사이트에 복사해 둔 코드는 자동으로 바뀌지 않습니다. AI에게 다음 명령으로 확인하고 업데이트를 마쳐 달라고 요청하세요.

```sh
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.2.0.tar.gz upgrade
```

설치 기록과 내용이 같은 파일만 자동으로 바꿉니다. 직접 고친 파일은 보존하고 `.dorms-login/review/`에 새 참고본과 차이를 남깁니다. v0.1.0에는 설치 기록이 없으므로 AI가 참고본의 변경을 기존 코드와 합쳐야 합니다. 검토할 파일이 남으면 명령은 종료 코드 `1`을 반환합니다.

AI가 차이를 합친 뒤 타입검사·빌드·실제 로그인·연결 끊기를 확인하고 `upgrade --accept-reviewed`로 검토 완료를 기록하세요. 이 명령도 기존 파일을 덮어쓰지 않으며, 다음 업데이트에서 직접 고친 파일을 계속 보호합니다. `doctor`는 기본 설정과 등록 상태를 확인하는 도구이고 실제 로그인 검증을 대신하지 않습니다.

## 개인정보와 공개 범위

회원이 허용한 사이트에 닉네임, 사진, 교사 인증 여부, 받은 도름 수가 전달됩니다. 이메일은 사이트가 요청하고 회원이 허용했을 때만 전달되며 애플 이메일 가리기 계정 등에서는 없을 수 있습니다. 비밀번호와 도름스 자체 로그인 쿠키는 전달하지 않습니다. 도름스에서 연결을 끊으면 새 정보 전달을 중단하고, v0.2.0의 확인 함수를 적용한 사이트는 다음 보호 요청부터 차단합니다. 이전 설치본은 업데이트가 필요합니다.

[HTTP 계약](./docs/PROTOCOL.md) · [보안 안내](./SECURITY.md) · [MIT 라이선스](./LICENSE)
