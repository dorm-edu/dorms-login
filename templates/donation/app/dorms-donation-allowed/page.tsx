"use client";
/**
 * Where the new tab opened by DormsDonationButton (at-login mode) lands after DoRms. It never reopens the original page,
 * so a live camera, stream or game room is not opened twice. Restyle freely.
 */
export default function DonationAllowed() {
  return <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px", wordBreak: "keep-all", overflowWrap: "anywhere" }}>
    <h1>도름스 확인을 마쳤어요</h1>
    <p>이 창을 닫고 원래 화면에서 보내기를 다시 눌러 주세요.</p>
    <button type="button" onClick={() => window.close()} style={{ minHeight: 44, padding: "10px 14px", font: "inherit" }}>이 창 닫기</button>
  </main>;
}
