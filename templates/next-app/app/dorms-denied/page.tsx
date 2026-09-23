import Link from "next/link";

/** 도름스 로그인이 거절되거나 실패했을 때 오는 화면. 메시지는 도름스가 보낸 사람 말 그대로 보여 준다. */
export default async function DormsDeniedPage({ searchParams }: { searchParams: Promise<{ error?: string; error_description?: string; reason?: string }> }) {
  const { error, error_description: rawDescription, reason } = await searchParams;
  // 주소창으로 누구나 넣을 수 있는 글이라 길이를 자르고 제어문자를 지운 뒤, 정해진 오류 코드일 때만 보여 준다.
  const description = typeof rawDescription === "string" && ["access_denied", "unauthorized_client", "invalid_scope"].includes(error ?? "")
    ? rawDescription.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) || null
    : null;
  const message =
    description
    ?? (reason === "teacher" ? "이 사이트는 교사 인증을 마친 도름스 회원만 들어갈 수 있어요."
      : reason === "dorms" ? "이 사이트는 받은 도름이 기준 이상인 도름스 회원만 들어갈 수 있어요."
      : error === "access_denied" ? "도름스에서 허용하지 않아 들어오지 못했어요."
      : "도름스 로그인을 마치지 못했어요. 다시 시도해 주세요.");
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px", fontFamily: "inherit", color: "#1c1917", wordBreak: "keep-all" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>들어갈 수 없어요</h1>
      <p style={{ fontSize: 15, lineHeight: 1.7, margin: "0 0 20px" }}>{message}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/api/auth/dorms/start?next=%2F" style={{ padding: "10px 16px", borderRadius: 9999, background: "#1c1917", color: "#fafaf9", textDecoration: "none", fontWeight: 600 }}>다시 로그인</Link>
        <Link href="/" style={{ padding: "10px 16px", borderRadius: 9999, border: "1px solid #d6d3d1", color: "#1c1917", textDecoration: "none", fontWeight: 600 }}>처음으로</Link>
        {reason === "teacher" && <a href="https://dorms.school/auth/redeem" target="_blank" rel="noopener noreferrer" style={{ padding: "10px 16px", borderRadius: 9999, color: "#1c1917", textDecoration: "underline", fontWeight: 600 }}>도름스에서 교사 인증 받기</a>}
      </div>
    </main>
  );
}
