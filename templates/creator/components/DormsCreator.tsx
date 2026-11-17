"use client";

// dorms-login: 만든 사람 프로필(<dorms-creator>)을 그리는 얇은 부품.
// 도름스가 주는 스크립트를 한 번만 불러, 회원 번호에 맞는 사진 · 닉네임 칩과 프로필 정보 창을 그린다.
// 배치(정보 순서)는 도름스 프로필 창과 같고, 모양은 이 사이트가 정한다:
//   글꼴 · 글자색은 감싸는 곳에서 물려받고, 바탕 · 선 · 강조색 · 모서리는 CSS 변수로,
//   칸마다의 모양은 dorms-creator::part(이름) 으로 꾸민다. README.ko.md '만든 사람 프로필 달기' 참고.
// 로그인과 상관없는 공개 정보만 쓰므로 로그인하지 않은 방문자에게도 보인다.
import Script from "next/script";
import type { CSSProperties, DetailedHTMLProps, HTMLAttributes } from "react";

export const DORMS_CREATOR_SCRIPT = "https://dorms.school/embed/creator.js";

type CreatorElementProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { ids?: string; headless?: boolean | "" };

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "dorms-creator": CreatorElementProps;
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DormsCreatorProps = {
  /** 도름스 회원 번호(프로필 주소 https://dorms.school/u/<회원번호> 의 끝부분). 함께 만든 선생님은 이어서. 10명까지. */
  ids: string[];
  className?: string;
  /** 사이트 디자인에 맞추는 변수(예: { "--dorms-creator-accent": "#e85d3f" }). */
  style?: CSSProperties & Record<`--dorms-creator-${string}`, string>;
};

export function DormsCreator({ ids, className, style }: DormsCreatorProps) {
  const clean = [...new Set(ids.map((id) => id.trim().toLowerCase()).filter((id) => UUID.test(id)))].slice(0, 10);
  if (!clean.length) return null;
  return (
    <>
      <Script src={DORMS_CREATOR_SCRIPT} strategy="afterInteractive" />
      <dorms-creator ids={clean.join(",")} className={className} style={style} />
    </>
  );
}

export default DormsCreator;
