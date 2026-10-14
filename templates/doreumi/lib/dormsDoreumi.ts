import "server-only";
import { cookies } from "next/headers";
import { DormsAuthError, SESSION_COOKIE } from "./dormsLogin";

/**
 * DoRms Doreumi outfit v0.4.0 (optional). Loads what the signed-in member's Doreumi wears on DoRms:
 * equipped items (3D .glb files) and three colors. Only works when the site enabled "도름이 착장도 받기"
 * on dorms.school/connect and the member allowed it. Item files are for showing that member's own Doreumi only.
 */
const API = process.env.NODE_ENV !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(process.env.DORMS_API_ORIGIN_DEV ?? "") ? process.env.DORMS_API_ORIGIN_DEV! : "https://dorms.school";
const BASE = "/api/auth/dorms/doreumi";
const ITEM_ID = /^[a-z0-9-]{1,40}$/;
const BONE = /^[A-Za-z0-9_]{1,40}$/;
const SLOTS = new Set(["head", "face", "neck", "top", "bottom", "shoes", "back", "hand"]);
const MAX_ITEM_BYTES = 3 * 1024 * 1024;

export type DormsDoreumiItem = {
  id: string;
  name: string;
  slots: string[];
  /** Which hand holds a hand item. null for other items. */
  hand: "leftHand" | "rightHand" | null;
  /** true: skinned to Doreumi's skeleton. false: attached under the bone (or attach point) named in `bone`. */
  rigged: boolean;
  bone: string | null;
  /** This site's path for the .glb file (null for code-drawn official items such as flower-pin). */
  asset: string | null;
  sha256: string | null;
  preview: string | null;
};
export type DormsDoreumi = {
  items: DormsDoreumiItem[];
  /** #rrggbb. Missing means Doreumi's default color. */
  colors: { body?: string; belly?: string; head?: string };
  /** Public base model (includes 26 actions such as Idle, Walk, Wave), rig contract and more motions. CC BY-NC 4.0. */
  model: string;
  rig: string;
  motions: string;
  license: string;
};

const same = (value: unknown) => {
  try { return typeof value === "string" && value.length <= 500 && new URL(value).origin === new URL(API).origin ? value : null; } catch { return null; }
};

function parse(body: unknown): DormsDoreumi | null {
  const raw = body && typeof body === "object" ? (body as { doreumi?: unknown }).doreumi : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const model = same(d.model), rig = same(d.rig), motions = same(d.motions);
  if (!Array.isArray(d.items) || d.items.length > 20 || !model || !rig || !motions || typeof d.license !== "string") return null;
  const items: DormsDoreumiItem[] = [];
  for (const entry of d.items) {
    if (!entry || typeof entry !== "object") return null;
    const item = entry as Record<string, unknown>;
    const slots = Array.isArray(item.slots) ? item.slots.filter((slot): slot is string => typeof slot === "string" && SLOTS.has(slot)) : [];
    if (typeof item.id !== "string" || !ITEM_ID.test(item.id) || !slots.length || typeof item.rigged !== "boolean") return null;
    items.push({
      id: item.id,
      name: typeof item.name === "string" ? item.name.slice(0, 60) : "",
      slots,
      hand: item.hand === "leftHand" || item.hand === "rightHand" ? item.hand : null,
      rigged: item.rigged,
      bone: typeof item.bone === "string" && BONE.test(item.bone) ? item.bone : null,
      // The browser never sees the DoRms token: item files come through this site's route.
      asset: typeof item.asset === "string" ? `${BASE}/items/${item.id}` : null,
      sha256: typeof item.sha256 === "string" && /^[0-9a-f]{64}$/.test(item.sha256) ? item.sha256 : null,
      preview: same(item.preview),
    });
  }
  const colors: DormsDoreumi["colors"] = {};
  const sourceColors = d.colors && typeof d.colors === "object" ? d.colors as Record<string, unknown> : {};
  for (const part of ["body", "belly", "head"] as const) {
    const hex = sourceColors[part];
    if (typeof hex === "string" && /^#[0-9a-f]{6}$/.test(hex)) colors[part] = hex;
  }
  return { items, colors, model, rig, motions, license: d.license.slice(0, 300) };
}

async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/**
 * The signed-in member's current outfit. null when not signed in, when the member did not allow the outfit,
 * when the site turned the option off, or when the session started before the option (sign in again).
 * Throws DormsAuthError("temporarily_unavailable") during outages. Never reuse an old outfit for another member.
 */
export async function getDormsDoreumi(): Promise<DormsDoreumi | null> {
  const token = await sessionToken();
  if (!token) return null;
  let response: Response;
  try {
    response = await fetch(`${API}/api/sso/doreumi`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) });
  } catch { throw new DormsAuthError("temporarily_unavailable"); }
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new DormsAuthError("temporarily_unavailable");
  const outfit = parse(await response.json().catch(() => null));
  if (!outfit) throw new DormsAuthError("temporarily_unavailable");
  return outfit;
}

const DATA_IMAGE = /^data:image\/(png|jpeg|webp|ktx2);base64,/i;

/**
 * Every `uri` anywhere must be a data: image (buffers live in the GLB BIN chunk). Raw `uri` keys are counted in the text
 * and must match what JSON.parse sees, so a duplicate key cannot hide an outside address from parsers that keep the first one.
 */
function glbJsonIsSelfContained(text: string): boolean {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return false; }
  let rawUriKeys = 0;
  const token = /"(?:[^"\\]|\\.)*"/g;
  const colon = /\s*:/y;
  for (let m = token.exec(text); m; m = token.exec(text)) {
    colon.lastIndex = token.lastIndex;
    if (!colon.test(text)) continue;
    try { if (JSON.parse(m[0]) === "uri") rawUriKeys++; } catch { return false; }
  }
  let parsedUriKeys = 0;
  let ok = true;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "uri") { parsedUriKeys++; if (typeof child !== "string" || !DATA_IMAGE.test(child)) ok = false; }
        walk(child);
      }
    }
  };
  walk(json);
  return ok && rawUriKeys === parsedUriKeys;
}

/** Item files are made by other teachers: only pass GLBs that do not point at outside addresses (buffers/images by URL). */
function selfContainedGlb(bytes: ArrayBuffer): boolean {
  try {
    const view = new DataView(bytes);
    if (bytes.byteLength < 28 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) return false;
    // The header length must be the file length, and the layout must be exactly one JSON chunk first and at most one BIN chunk.
    // Loaders differ on which JSON chunk they keep (three.js keeps the last), so anything else is refused.
    if (view.getUint32(8, true) !== bytes.byteLength) return false;
    const chunks: { type: number; start: number; length: number }[] = [];
    let offset = 12;
    while (offset < bytes.byteLength) {
      if (offset + 8 > bytes.byteLength) return false;
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      offset += 8;
      if (length > bytes.byteLength - offset) return false;
      chunks.push({ type, start: offset, length });
      offset += length;
    }
    if (chunks[0]?.type !== 0x4e4f534a) return false;
    if (chunks.length > 2 || (chunks.length === 2 && chunks[1].type !== 0x004e4942)) return false;
    return glbJsonIsSelfContained(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes, chunks[0].start, chunks[0].length)));
  } catch {
    return false;
  }
}

const fail = (reason: string, status: number) => Response.json({ reason }, { status, headers: { "Cache-Control": "no-store" } });

/** One item file of the signed-in member's current outfit, streamed through this site (the token stays on the server). */
export async function fetchDormsDoreumiItem(id: string): Promise<Response> {
  if (!ITEM_ID.test(id)) return fail("not_found", 404);
  const token = await sessionToken();
  if (!token) return fail("authentication_required", 401);
  let response: Response;
  try {
    response = await fetch(`${API}/api/sso/doreumi/items/${id}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch { return fail("temporarily_unavailable", 503); }
  if (response.status === 401) return fail("authentication_required", 401);
  if (response.status === 403) return fail("access_denied", 403);
  if (response.status === 404) return fail("not_found", 404);
  if (!response.ok || response.headers.get("content-type") !== "model/gltf-binary") return fail("temporarily_unavailable", 503);
  const bytes = await response.arrayBuffer().catch(() => null);
  if (!bytes || bytes.byteLength > MAX_ITEM_BYTES || !selfContainedGlb(bytes)) return fail("temporarily_unavailable", 503);
  return new Response(bytes, { status: 200, headers: { "Content-Type": "model/gltf-binary", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export const dormsDoreumiHref = BASE;
