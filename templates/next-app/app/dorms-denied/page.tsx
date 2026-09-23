import Link from "next/link";
import { dormsLoginHref } from "__DORMS_LIB_IMPORT__";

const MESSAGES: Record<string, { title: string; text: string }> = {
  authentication_required: { title: "다시 로그인해 주세요", text: "로그인 시간이 지났거나 새 확인이 필요해요. 아래 버튼으로 다시 시작해 주세요." },
  access_denied: { title: "들어갈 수 없어요", text: "도름스에서 이 사이트 연결이 끊겼거나 입장 조건이 바뀌었어요. 사이트 운영자에게 문의하거나 도름스에서 허용 상태를 확인해 주세요." },
  temporarily_unavailable: { title: "잠시 뒤 다시 시도해 주세요", text: "도름스에서 지금 들어갈 수 있는지 확인하지 못했어요. 확인될 때까지 이 사이트의 자료는 열리지 않아요." },
};

export default async function DormsDeniedPage({ searchParams }: { searchParams: Promise<{ reason?: string; next?: string }> }) {
  const { reason, next } = await searchParams;
  const message = MESSAGES[reason ?? ""] ?? MESSAGES.temporarily_unavailable;
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px", fontFamily: "inherit", color: "#1c1917", wordBreak: "keep-all", overflowWrap: "anywhere" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>{message.title}</h1>
      <p style={{ fontSize: 15, lineHeight: 1.7, margin: "0 0 20px" }}>{message.text}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <form method="post" action={dormsLoginHref(next)}>
          <button type="submit" style={{ padding: "10px 16px", borderRadius: 9999, border: 0, background: "#1c1917", color: "#fafaf9", font: "inherit", fontWeight: 600, cursor: "pointer" }}>다시 시도</button>
        </form>
        <Link href="/" style={{ padding: "10px 16px", borderRadius: 9999, border: "1px solid #d6d3d1", color: "#1c1917", textDecoration: "none", fontWeight: 600 }}>처음으로</Link>
        <a href="https://dorms.school/connect" target="_blank" rel="noopener noreferrer" style={{ padding: "10px 16px", color: "#1c1917", textDecoration: "underline" }}>도름스에서 확인</a>
      </div>
    </main>
  );
}
