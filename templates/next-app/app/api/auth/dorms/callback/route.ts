import { NextResponse, type NextRequest } from "next/server";

import { finishDormsLogin, parseFlowCookie, sessionCookieOptions, SESSION_COOKIE } from "__DORMS_LIB_IMPORT__";

export const dynamic = "force-dynamic";

const FLOW_COOKIE = "dorms_flow";

function fail(request: NextRequest, error: string, description?: string) {
  const url = new URL("/dorms-denied", request.url);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  const response = NextResponse.redirect(url, 302);
  response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** 도름스에서 돌아오는 자리. state 대조 → 코드 교환 → 서명 확인 → 세션 쿠키. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const flow = parseFlowCookie(request.cookies.get(FLOW_COOKIE)?.value);
  if (params.get("error")) return fail(request, params.get("error") ?? "access_denied", params.get("error_description") ?? undefined);
  const code = params.get("code");
  const state = params.get("state");
  if (!flow || !code || !state || state !== flow.state) return fail(request, "invalid_state", "로그인 요청이 만료됐거나 맞지 않아요. 다시 시도해 주세요.");
  try {
    const { idToken, expiresAt } = await finishDormsLogin({ code, verifier: flow.verifier, nonce: flow.nonce, requestUrl: request.url });
    const response = NextResponse.redirect(new URL(flow.next, request.url), 302);
    response.cookies.set(SESSION_COOKIE, idToken, sessionCookieOptions(expiresAt - Math.floor(Date.now() / 1000)));
    response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return fail(request, "exchange_failed", error instanceof Error ? error.message : "도름스 로그인을 마치지 못했어요.");
  }
}
