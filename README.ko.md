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
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.6.0.tar.gz detect
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.6.0.tar.gz init --client-id '<사이트 id>' --site 'https://example.com'
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.6.0.tar.gz doctor
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
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.6.0.tar.gz upgrade
```

설치 기록과 내용이 같은 파일만 자동으로 바꿉니다. 직접 고친 파일은 보존하고 `.dorms-login/review/`에 새 참고본과 차이를 남깁니다. v0.1.0에는 설치 기록이 없으므로 AI가 참고본의 변경을 기존 코드와 합쳐야 합니다. 검토할 파일이 남으면 명령은 종료 코드 `1`을 반환합니다.

AI가 차이를 합친 뒤 타입검사·빌드·실제 로그인·연결 끊기를 확인하고 `upgrade --accept-reviewed`로 검토 완료를 기록하세요. 이 명령도 기존 파일을 덮어쓰지 않으며, 다음 업데이트에서 직접 고친 파일을 계속 보호합니다. `doctor`는 기본 설정과 등록 상태를 확인하는 도구이고 실제 로그인 검증을 대신하지 않습니다.

## 개인정보와 공개 범위

회원이 허용한 사이트에 닉네임, 사진, 교사 인증 여부, 받은 도름 수가 전달됩니다. 이메일과 도름이 착장은 사이트가 요청하고 회원이 허용했을 때만 전달되며 애플 이메일 가리기 계정 등에서는 없을 수 있습니다. 비밀번호와 도름스 자체 로그인 쿠키는 전달하지 않습니다. 도름스에서 연결을 끊으면 새 정보 전달을 중단하고, v0.2.0의 확인 함수를 적용한 사이트는 다음 보호 요청부터 차단합니다. 이전 설치본은 업데이트가 필요합니다.

[HTTP 계약](./docs/PROTOCOL.md) · [보안 안내](./SECURITY.md) · [MIT 라이선스](./LICENSE)

## 만든 사람 프로필 달기 (선택, v0.6.0)

웹앱 구석에 '만든 사람'을 글자로 적어 두면 동명이인과 헷갈리고, 소속이 바뀔 때마다 고쳐야 해요. 대신 도름스 프로필을 달면 닉네임과 프로필 사진을 바꿀 때 그대로 따라 바뀌어요. 누르면 그 선생님의 도름스 프로필 정보(교사 인증, 지역과 담당, 소개, 링크, 랭킹, 받은 도름, 숙제 출석, 뱃지)가 정보 창으로 열리고, **도름스에서 자세히 보기**는 도름스 프로필을 새 탭으로 엽니다. 차단이나 쪽지처럼 도름스 안에서만 하는 일은 담기지 않아요.

로그인 없이 공개 정보만 쓰는 부품이라, 도름스 로그인을 달지 않은 사이트에도 두 줄이면 됩니다(HTML · Vite · Next.js 모두).

```html
<script src="https://dorms.school/embed/creator.js" defer></script>
<dorms-creator ids="회원번호,회원번호"></dorms-creator>
```

- 회원 번호는 도름스 프로필 주소 `https://dorms.school/u/<회원번호>`의 끝부분이에요. 내 번호가 들어간 코드와 AI 프롬프트는 [내 사이트 관리](https://dorms.school/connect#creator)의 **만든 사람으로 내 프로필 달기**에서 복사할 수 있어요. 함께 만든 선생님은 쉼표로 이어 적어요(10명까지).
- Next.js App Router에 도름스 로그인을 이미 달았다면 `upgrade --creator`로 `components/DormsCreator.tsx`를 받아 `<DormsCreator ids={["회원번호"]} />`처럼 써도 돼요. 새로 설치하면 `init --creator`.

### 배치는 그대로, 디자인은 내 사이트대로

정보의 배치(사진·닉네임과 뱃지 → 인증·지역·함께한 때 → 소개 → 링크 → 랭킹·받은 도름·숙제 출석 → 사이트 열기·도름스에서 자세히 보기)는 도름스 프로필 창과 같고, 색·글꼴·모서리·그림자는 부품이 정하지 않아요. 글꼴과 글자색은 감싸는 곳에서 물려받고, 나머지는 내 사이트가 입힙니다.

```css
dorms-creator {
  --dorms-creator-surface: #fffaf2;  /* 정보 창 바탕 */
  --dorms-creator-text: #2b2620;     /* 정보 창 글자 */
  --dorms-creator-border: #e3d8c8;   /* 선 */
  --dorms-creator-muted: #7a6f62;    /* 흐린 글자 */
  --dorms-creator-accent: #e85d3f;   /* 교사 인증 · 링크 · 자세히 보기 */
  --dorms-creator-radius: 14px;      /* 정보 창 · 단추 모서리 */
}
dorms-creator::part(card) { box-shadow: 0 12px 40px rgb(0 0 0 / .15); }
dorms-creator::part(chip) { background: #fff3e6; }
```

꾸밀 수 있는 칸: `chip` `chip-photo` `name` `card` `head` `photo` `nickname` `handle` `badges` `badge` `meta` `teacher` `bio` `links` `link` `stats` `actions` `site` `more` `close` `missing`.
화면을 처음부터 직접 그리고 싶으면 `<dorms-creator ids="…" headless>`로 두고 `dorms-creator:data` 이벤트의 `event.detail.creators`를 쓰세요. 형식은 [연동 계약의 만든 사람 프로필 절](./docs/PROTOCOL.md#만든-사람-프로필-선택-기능-v060)에 있어요.

사이트에 콘텐츠 보안 정책(CSP)이 있으면 `script-src`·`connect-src`에 `https://dorms.school`, `img-src`에 `https://dorms.school`과 `https://*.supabase.co`를 더해 주세요. 탈퇴했거나 찾을 수 없는 번호는 '찾을 수 없는 회원'으로만 보여요.

[복사해서 AI에 부탁하기](USE-WITH-AI.md#만든-사람-프로필-달기)

## 도름이 착장 불러오기 (선택, v0.4.0)

회원이 도름스에서 꾸민 도름이(입은 아이템과 색)를 내 사이트에서도 보여 줄 수 있어요. 원하면 도름이 동작도 붙일 수 있어요.

1. [내 사이트 관리](https://dorms.school/connect)에서 해당 앱 카드의 **누가 들어올지 바꾸기**를 열고 **도름이 착장도 받기**를 켭니다. 켜면 로그인할 때 동의 화면에 '도름이 착장'이 추가됩니다. 이미 로그인해 있던 회원은 한 번 다시 로그인해야 착장이 와요.
2. 기존 로그인에 `upgrade --doreumi`, 새로 설치하면 `init --doreumi`를 실행합니다. `lib/dormsDoreumi.ts`와 경로 두 개(`/api/auth/dorms/doreumi`, `/api/auth/dorms/doreumi/items/<아이템 id>`)가 추가됩니다.
3. 서버에서 `getDormsDoreumi()`를 부릅니다. 회원이 허용하지 않았거나 옵션이 꺼져 있으면 `null`이니 기본 도름이를 보여 주세요.

```ts
import { getDormsDoreumi } from "@/lib/dormsDoreumi";

const outfit = await getDormsDoreumi();
// outfit.items: { id, name, slots, hand, rigged, bone, asset, sha256, preview }[]
// outfit.colors: { body?, belly?, head? }  (#rrggbb, 없으면 기본색)
// outfit.model · outfit.rig · outfit.motions: 기본 도름이 모형(동작 26개 포함), 뼈대 계약, 추가 동작 목록
```

아이템 3D 파일은 `asset`(내 사이트의 `/api/auth/dorms/doreumi/items/<id>`)으로 받습니다. 도름스 토큰은 서버에만 있고 브라우저로 나가지 않아요. 그리는 법은 [연동 계약의 도름이 착장 절](./docs/PROTOCOL.md#도름이-착장-선택-기능-v040)에 있습니다.

착장은 지금 입은 것만 전달돼요. 아이템은 만든 선생님의 작품이라 산 선생님의 도름이에 입혀 보여 줄 때만 쓰고, 따로 모아 두거나 나눠 주지 마세요.

도름이 캐릭터·모형·표정·동작은 아인T 선생님이 CC BY-NC 4.0으로 공개한 작품이에요([원본](https://github.com/ainssam/doreumi-desktop-pet)). 내 사이트에 들인 도름이는 도름스와 상관없이 마음대로 고치고 새 동작을 더해 써도 돼요. 화면에 '도름이 © 아인T, CC BY-NC 4.0' 표기를 남기고 고친 곳이 있으면 고쳤다고 함께 적어 주세요. 돈을 버는 데 쓰려면 아인T 선생님과 따로 약속해야 해요. 동작 파일만 따로 떼어 나눠 주지는 마세요.

[복사해서 AI에 부탁하기](USE-WITH-AI.md#도름이-착장도-불러오기)

## 도름네이션 추가하기

내가 만든 앱에 사람들이 도름스로 로그인하고, 서로에게 도름을 줄 수 있어요(도름네이션).

먼저 사이트 운영자가 [내 사이트 관리](https://dorms.school/connect)에서 해당 앱의 **도름네이션 설치 프롬프트 복사** 버튼을 누릅니다. 복사하면 사용 신청도 자동으로 접수되고 본인 이름으로 홍창욱 선생님께 쪽지가 갑니다. 로그인 설치 프롬프트를 복사하거나 이 도구의 설치 명령만 실행하면 신청되지 않습니다.

복사한 프롬프트를 코딩 AI에 전달하세요. 기존 로그인에 `upgrade --donations`를 실행하면 전송 도우미와 버튼을 추가합니다. 신규 설치는 `init --donations`를 사용합니다. 선택하지 않으면 로그인 기능만 설치됩니다. 실제로 보내려면 관리자 승인과 이용자의 첫 도름 사용 허용이 필요합니다. 모든 앱을 합쳐 한 사람당 하루 최대 3도름, 한국 시간 자정 기준입니다. 보내면 내 누적 도름이 줄고 받은 사람의 누적 도름이 늘어 랭킹에도 반영됩니다. 받은 양은 주간·월간 랭킹에, 보낸 양은 응원단장에 집계됩니다. 받은 도름은 상점에서도 쓸 수 있어요. 도름스 서버가 계산하므로 이미 도름네이션을 설치한 사이트는 재설치 없이 적용됩니다.

**방식은 개발할 때 고릅니다 (v0.5.0)**: 도름스로 로그인만(옵션 없음), 도름네이션을 따로 허락(`--donations`, 처음 보낼 때 도름스에서 한 번 허락), 로그인할 때 도름네이션까지 허락(`--donations-at-login`). 마지막 방식은 그 사이트의 도름스 로그인이 늘 도름네이션 허락까지 함께 받아, 로그인이 유지되는 동안 보낼 때 화면이 바뀌지 않습니다. 라이브 방송·화상 통화·게임처럼 페이지를 떠나면 안 되는 앱에 쓰세요. 버튼 모양과 문구는 어느 방식이든 앱이 정합니다. 회원은 도름스 허락 화면에서 로그인만 고를 수도 있고(그 회원에게는 다음 로그인 때 다시 묻습니다), 승인 전인 앱은 평소 로그인과 같습니다. 이 방식에서는 기본 도름네이션 버튼도 페이지를 넘기지 않고, 허용이나 다시 로그인이 필요하면 새 창 링크를 보여 줍니다(새 창은 `/dorms-donation-allowed` 로 끝나 원래 화면을 다시 열지 않아요). 홈 화면에 추가한 웹앱처럼 새 창에 이 사이트의 로그인이 없을 수 있는 환경이면 그 안내를 따로 두세요. `upgrade --donations`·`upgrade --donations-at-login` 으로 방식을 바꿉니다.

[복사해서 AI에 부탁하기](USE-WITH-AI.md#도름네이션도-붙이기) · [다른 환경의 연동 안내](docs/PROTOCOL.md#도름네이션-선택-기능-v030) · [로그인할 때 함께 허락받기](docs/PROTOCOL.md#로그인과-함께-도름네이션-허락받기-v050)
