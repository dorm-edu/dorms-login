"use client";
import { useRef, useState, type CSSProperties } from "react";
const messages: Record<string, string> = {
  approval_required: "사이트 운영자가 도름네이션을 신청하고 승인을 받아야 해요.",
  site_not_approved: "아직 도름네이션을 사용할 수 없는 앱이에요.",
  donation_not_approved: "아직 도름네이션을 사용할 수 없는 앱이에요.",
  insufficient_dorms: "보낼 수 있는 도름이 부족해요.",
  daily_limit: "오늘 보낼 수 있는 도름을 다 보냈어요. 한국 시간 자정에 다시 보낼 수 있어요.",
  self_donation: "자신에게는 도름을 보낼 수 없어요.",
  idempotency_conflict: "앞서 보낸 요청과 내용이 달라요. 페이지를 새로 열고 확인해 주세요.",
  insufficient_balance: "보낼 수 있는 도름이 부족해요.",
  daily_limit_exceeded: "오늘 보낼 수 있는 도름을 다 보냈어요. 한국 시간 자정에 다시 보낼 수 있어요.",
  recipient_unavailable: "이 선생님께 지금은 도름을 보낼 수 없어요.",
  access_denied: "지금은 도름네이션을 사용할 수 없어요.",
  forbidden: "페이지를 새로 열고 다시 시도해 주세요.",
};
/** Pass the recipient's DoRms member ID, never an email or a browser-supplied sender ID. */
export function DormsDonationButton({ recipientId, amount = 1, onSuccess, className, style }: { recipientId: string; amount?: number; className?: string; style?: CSSProperties; onSuccess?: (result: { transferId: string; amount: number }) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<{ requestId: string; recipientId: string; amount: number } | null>(null);
  const locked = useRef(false);
  async function send() {
    if (locked.current) return;
    if (pending.current && (pending.current.recipientId !== recipientId || pending.current.amount !== amount)) {
      setMessage("앞서 보낸 요청의 결과가 아직 확인되지 않았어요. 이전 대상과 도름 수로 돌아가 결과를 확인해 주세요.");
      return;
    }
    locked.current = true; setBusy(true); setMessage("");
    try {
      // Keep this exact request after timeouts: the provider returns the original committed result.
      pending.current ??= { recipientId, amount, requestId: crypto.randomUUID() };
      const response = await fetch("/api/auth/dorms/donation/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      const result = await response.json();
      if (!response.ok) {
        if (["consent_required", "invalid_token", "authentication_required"].includes(result.reason)) {
          const path = result.reason === "authentication_required" ? "/api/auth/dorms/start" : "/api/auth/dorms/donation/start";
          window.location.assign(`${path}?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`); return;
        }
        if (response.status < 500 && response.status !== 429) pending.current = null;
        setMessage(messages[result.reason] ?? "결과를 확인하지 못했어요. 다시 누르면 같은 요청의 결과를 확인해요."); return;
      }
      pending.current = null;
      setMessage(`${result.amount}도름을 보냈어요.`);
      onSuccess?.(result);
    } catch { setMessage("결과를 확인하지 못했어요. 다시 누르면 같은 요청의 결과를 확인해요."); }
    finally { locked.current = false; setBusy(false); }
  }
  return <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 8, maxWidth: "100%", wordBreak: "keep-all", overflowWrap: "break-word" }}><button type="button" className={className} style={{ minHeight: 44, padding: "10px 14px", font: "inherit", flexShrink: 0, ...style }} disabled={busy} onClick={send}>{busy ? "확인 중…" : `${amount}도름 보내기`}</button><span role="status" aria-live="polite" style={{ minWidth: 0 }}>{message}</span></span>;
}
