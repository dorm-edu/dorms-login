import { NextResponse, type NextRequest } from "next/server";

import { finishDormsLogin, parseFlowCookie, sessionCookieOptions, SESSION_COOKIE } from "__DORMS_LIB_IMPORT__";

export const dynamic = "force-dynamic";

const FLOW_COOKIE = "dorms_flow";

function fail(request: NextRequest, error: string) {
  // 도름스가 보낸 설명 문장은 화면에 싣지 않는다(주소창 위조 방지). 오류 코드만 넘기고 고정 문장으로 안내한다.
  const url = new URL("/dorms-denied", request.url);
  url.searchParams.set("error", /^[a-z_]{1,40}$/.test(error) ? error : "exchange_failed");
  const response = NextResponse.redirect(url, 302);
  response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** 도름스에서 돌아오는 자리. state 대조 → 코드 교환 → 서명 확인 → 세션 쿠키. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const flow = parseFlowCookie(request.cookies.get(FLOW_COOKIE)?.value);
  if (params.get("error")) return fail(request, params.get("error") ?? "access_denied");
  const code = params.get("code");
  const state = params.get("state");
  if (!flow || !code || !state || state !== flow.state) return fail(request, "invalid_state");
  try {
    const { idToken, expiresAt } = await finishDormsLogin({ code, verifier: flow.verifier, nonce: flow.nonce, requestUrl: request.url });
    const target = new URL(flow.next, request.url);
    if (target.origin !== new URL(request.url).origin) target.pathname = "/";
    const response = NextResponse.redirect(target, 302);
    response.cookies.set(SESSION_COOKIE, idToken, sessionCookieOptions(expiresAt - Math.floor(Date.now() / 1000)));
    response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return fail(request, "exchange_failed");
  }
}
