import Link from "next/link";
import { dormsLoginHref } from "__DORMS_LIB_IMPORT__";
const messages: Record<string, string> = {
  approval_required: "앱 운영자가 도름네이션을 신청하고 관리자가 승인하면 사용할 수 있어요.",
  consent_required: "도름을 보내려면 처음 한 번 도름스에서 사용을 허용해 주세요.",
  authentication_required: "로그인 시간이 지났어요. 다시 로그인한 뒤 도름을 보내 주세요.",
  access_denied: "도름네이션 사용을 허용하지 않았거나 연결이 끊겼어요. 도름스에서 연결 상태를 확인해 주세요.",
  temporarily_unavailable: "지금은 도름스에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
};
export default async function DonationDenied({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px", wordBreak: "keep-all", overflowWrap: "anywhere" }}>
    <h1>도름네이션을 확인해 주세요</h1>
    <p>{messages[reason ?? ""] ?? messages.access_denied}</p>
    {reason === "authentication_required" && <a href={dormsLoginHref()}>다시 로그인</a>}
    <p><Link href="/">앱으로 돌아가기</Link></p>
    <a href="https://dorms.school/connect" target="_blank" rel="noopener noreferrer">도름스에서 확인</a>
  </main>;
}
