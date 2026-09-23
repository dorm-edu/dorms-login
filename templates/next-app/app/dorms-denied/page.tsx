import Link from "next/link";

/**
 * 도름스 로그인이 거절되거나 실패했을 때 오는 화면.
 * 주소창의 문장은 누구나 바꿔 넣을 수 있으니 화면에 싣지 않고, 오류 코드별로 정해 둔 문장만 보여 준다.
 */
const MESSAGES: Record<string, string> = {
  access_denied: "도름스에서 허용하지 않아 들어오지 못했어요. 이 사이트에 들어올 수 있는 조건은 도름스 로그인 화면에서 안내해요.",
  unauthorized_client: "이 사이트는 지금 도름스 로그인을 받을 수 없어요. 사이트 관리자에게 알려 주세요.",
  invalid_scope: "이 사이트가 요청한 항목을 도름스가 허용하지 않았어요. 사이트 관리자에게 알려 주세요.",
  invalid_state: "로그인 요청이 만료됐거나 맞지 않아요. 다시 시도해 주세요.",
  exchange_failed: "도름스 로그인을 마치지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  teacher: "이 사이트는 교사 인증을 마친 도름스 회원만 들어갈 수 있어요.",
  dorms: "이 사이트는 받은 도름이 기준 이상인 도름스 회원만 들어갈 수 있어요.",
};

export default async function DormsDeniedPage({ searchParams }: { searchParams: Promise<{ error?: string; reason?: string }> }) {
  const { error, reason } = await searchParams;
  const key = reason && MESSAGES[reason] ? reason : error && MESSAGES[error] ? error : "exchange_failed";
  const message = MESSAGES[key];
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px", fontFamily: "inherit", color: "#1c1917", wordBreak: "keep-all" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>들어갈 수 없어요</h1>
      <p style={{ fontSize: 15, lineHeight: 1.7, margin: "0 0 20px" }}>{message}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/api/auth/dorms/start?next=%2F" style={{ padding: "10px 16px", borderRadius: 9999, background: "#1c1917", color: "#fafaf9", textDecoration: "none", fontWeight: 600 }}>다시 로그인</Link>
        <Link href="/" style={{ padding: "10px 16px", borderRadius: 9999, border: "1px solid #d6d3d1", color: "#1c1917", textDecoration: "none", fontWeight: 600 }}>처음으로</Link>
        {key === "teacher" && <a href="https://dorms.school/auth/redeem" target="_blank" rel="noopener noreferrer" style={{ padding: "10px 16px", borderRadius: 9999, color: "#1c1917", textDecoration: "underline", fontWeight: 600 }}>도름스에서 교사 인증 받기</a>}
      </div>
    </main>
  );
}
