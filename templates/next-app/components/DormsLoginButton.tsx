/**
 * "DoRms로 로그인" 버튼 (dorms-login 템플릿). 서버 컴포넌트라 어디든 그냥 놓으면 된다.
 * 모양은 도름스가 MoRan 에 단 버튼과 같다. 인라인 스타일이라 Tailwind 가 없어도 보인다.
 * 아래 두 링크(DoRms 바로 가기 · 내 사이트에도 달기)는 기능과 무관하니 지워도 로그인은 그대로 된다.
 */

export function DormsEmblem({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true" style={{ display: "block" }}>
      <path
        d="M 5.51 20.27 L 4.54 18.99 L 3.78 17.58 L 3.25 16.09 L 2.95 14.55 L 2.90 13.00 L 3.09 11.47 L 3.50 10.01 L 4.13 8.63 L 4.95 7.39 L 5.95 6.29 L 7.09 5.37 L 8.35 4.64 L 9.69 4.12 L 11.09 3.82 L 12.49 3.73 L 13.88 3.87 L 15.22 4.21 L 16.48 4.74 L 17.63 5.46 L 18.64 6.33 L 19.50 7.34 L 20.19 8.46 L 20.69 9.66 L 20.99 10.90 L 21.10 12.17 L 21.01 13.42 L 20.74 14.63 L 20.29 15.77 L 19.67 16.81 L 18.91 17.74 L 18.03 18.52 L 17.05 19.16 L 15.99 19.63 L 14.89 19.93 L 13.77 20.05 L 12.66 20.00 L 11.58 19.78 L 10.57 19.40 L 9.63 18.88 L 8.80 18.23 L 8.09 17.47 L 7.52 16.62 L 7.09 15.70 L 6.81 14.74 L 6.68 13.77 L 6.70 12.80 L 6.87 11.86 L 7.18 10.97 L 7.62 10.15 L 8.17 9.42 L 8.82 8.79 L 9.54 8.29 L 10.32 7.90 L 11.14 7.64 L 11.97 7.52 L 12.80 7.53 L 13.60 7.66 L 14.36 7.91 L 15.06 8.27 L 15.68 8.73 L 16.22 9.27 L 16.65 9.87 L 16.98 10.52 L 17.21 11.20 L 17.32 11.89 L 17.32 12.58 L 17.21 13.24 L 17.01 13.87 L 16.72 14.44 L 16.35 14.96 L 15.91 15.39 L 15.43 15.75 L 14.90 16.01 L 14.36 16.19 L 13.80 16.28 L 13.26 16.28 L 12.73 16.19 L 12.24 16.03 L 11.79 15.80 L 11.40 15.51 L 11.07 15.17 L 10.80 14.79 L 10.60 14.39 L 10.48 13.97 L 10.42 13.56 L 10.43 13.15 L 10.51 12.77 L 10.64 12.41 L 10.82 12.09 L 11.04 11.82 L 11.29 11.60 L 11.57 11.43 L 11.85 11.31 L 12.14 11.24 L 12.42 11.23 L 12.69 11.26"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DormsLoginButton({ next = "/", label = "DoRms로 로그인", showLinks = true }: { next?: string; label?: string; showLinks?: boolean }) {
  const href = `/api/auth/dorms/start?next=${encodeURIComponent(next)}`;
  return (
    <div style={{ maxWidth: 420 }}>
      <form method="post" action={href}>
        <button
          type="submit"
          style={{
            display: "inline-flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            borderRadius: 12,
            border: "1px solid #fda4af",
            background: "linear-gradient(90deg, #ffe4e6 0%, #ffffff 50%, #f0f9ff 100%)",
            padding: "12px 16px",
            fontSize: 14,
            fontWeight: 600,
            color: "#1c1917",
            boxShadow: "0 10px 28px -16px rgba(190,24,93,0.75)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <span style={{ display: "inline-flex", width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 9999, background: "#0284c7", color: "#ffffff", boxShadow: "0 0 0 1px #7dd3fc" }}>
            <DormsEmblem size={20} />
          </span>
          {label}
        </button>
      </form>
      {showLinks && (
        <p style={{ margin: "8px 0 0", textAlign: "center", fontSize: 12, lineHeight: 1.6, color: "#57534e", wordBreak: "keep-all" }}>
          도름스 계정으로 들어와요.{" "}
          <a href="https://dorms.school" target="_blank" rel="noopener noreferrer" style={{ color: "#1c1917", fontWeight: 600, textDecoration: "underline" }}>DoRms 바로 가기</a>
          {" · "}
          <a href="https://dorms.school/connect" target="_blank" rel="noopener noreferrer" style={{ color: "#1c1917", fontWeight: 600, textDecoration: "underline" }}>내 사이트에도 DoRms 로그인 달기</a>
        </p>
      )}
    </div>
  );
}

/** 푸터 등에 두는 작은 표식. 방문자가 눌러 도름스와 이 기능을 살펴볼 수 있다. */
export function DormsBadge() {
  return (
    <a
      href="https://dorms.school/connect"
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 6px", borderRadius: 9999, border: "1px solid #e7e5e4", background: "#fafaf9", color: "#44403c", fontSize: 12, fontWeight: 600, textDecoration: "none" }}
    >
      <span style={{ display: "inline-flex", width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: 9999, background: "#0284c7", color: "#ffffff" }}>
        <DormsEmblem size={12} />
      </span>
      DoRms로 로그인 지원
    </a>
  );
}
