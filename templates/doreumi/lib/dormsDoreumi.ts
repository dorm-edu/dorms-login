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


/**
 * No `uri` anywhere: DoRms only accepts items whose pictures and data live in the GLB BIN chunk. Raw `uri` keys are counted in the text
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
        if (key === "uri") { parsedUriKeys++; ok = false; }
        walk(child);
      }
    }
  };
  walk(json);
  return ok && rawUriKeys === parsedUriKeys;
}

// A 3MB file can still declare huge arrays or images. Same caps as the Jjongal desktop pet (measured on live items with wide margins).
const MAX_ACCESSOR_BYTES = 48 * 1024 * 1024, MAX_ACCESSOR_COUNT = 500_000, MAX_MESHES = 1024;
// The same rules DoRms applies when an item is uploaded (items DoRms serves already passed them; this re-checks before your
// site or your members' browsers draw the file): 4 pictures of at most 1MB and 2048px, 200 parts, 256 draws, 40,000 triangles,
// allowed extensions only (also hidden ones), no animations or morph targets.
const MAX_IMAGES = 4, MAX_IMAGE_BYTES = 1024 * 1024, MAX_IMAGE_SIDE = 2048, MAX_NODES = 200, MAX_DRAWS = 256, MAX_TRIANGLES = 40_000;
const ALLOWED_EXTENSIONS = new Set(["KHR_materials_emissive_strength", "KHR_texture_transform", "KHR_materials_unlit", "EXT_meshopt_compression", "KHR_mesh_quantization"]);
const GLTF_ATTRIBUTE_NAME = /^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+|JOINTS_\d+|WEIGHTS_\d+|_[A-Z0-9_]+)$/;

function extensionKeys(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 12 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) { for (const item of value) extensionKeys(item, depth + 1, out); return out; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "extensions" && child && typeof child === "object") out.push(...Object.keys(child as object));
    extensionKeys(child, depth + 1, out);
  }
  return out;
}

function itemShapeOk(raw: Record<string, unknown>): boolean {
  const list = (key: string) => (raw[key] as unknown[] | undefined) ?? [];
  const index = (value: unknown, size: number) => value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < size);
  const used = list("extensionsUsed"), declared = new Set(used);
  for (const name of [...used, ...list("extensionsRequired")]) if (typeof name !== "string" || !ALLOWED_EXTENSIONS.has(name)) return false;
  if (extensionKeys(raw).some((name) => !ALLOWED_EXTENSIONS.has(name) || !declared.has(name))) return false;
  if (list("animations").length) return false;
  const nodes = list("nodes"), meshes = list("meshes"), accessors = list("accessors");
  if (nodes.length > MAX_NODES) return false;
  for (const node of nodes) {
    const n = node as { mesh?: unknown; skin?: unknown; children?: unknown } | null;
    if (!n || typeof n !== "object" || !index(n.mesh, meshes.length) || !index(n.skin, list("skins").length)) return false;
    if (n.children !== undefined && (!Array.isArray(n.children) || n.children.some((c) => !Number.isSafeInteger(c) || c < 0 || c >= nodes.length))) return false;
  }
  for (const scene of list("scenes")) {
    const roots = (scene as { nodes?: unknown } | null)?.nodes;
    if (!scene || typeof scene !== "object" || (roots !== undefined && (!Array.isArray(roots) || roots.some((r) => !Number.isSafeInteger(r) || r < 0 || r >= nodes.length)))) return false;
  }
  if (raw.scene !== undefined && !index(raw.scene, list("scenes").length)) return false;
  // Skin joints must be node numbers and no more than the parts; loaders allocate one entry per joint.
  for (const skin of list("skins")) {
    const joints = (skin as { joints?: unknown } | null)?.joints;
    if (!skin || typeof skin !== "object" || !Array.isArray(joints) || joints.length > nodes.length || joints.some((j) => !Number.isSafeInteger(j) || j < 0 || j >= nodes.length)) return false;
  }
  // A loop in the part tree makes loaders recurse forever.
  const state = new Uint8Array(nodes.length);
  const cyclic = (i: number): boolean => {
    if (state[i] === 1) return true;
    if (state[i] === 2) return false;
    state[i] = 1;
    for (const c of ((nodes[i] as { children?: number[] }).children ?? [])) if (cyclic(c)) return true;
    state[i] = 2;
    return false;
  };
  for (let i = 0; i < nodes.length; i++) if (cyclic(i)) return false;
  const meshTriangles: number[] = [], meshDraws: number[] = [];
  for (const mesh of meshes) {
    const primitives = (mesh as { primitives?: unknown } | null)?.primitives;
    if (!mesh || typeof mesh !== "object" || !Array.isArray(primitives)) return false;
    let triangles = 0;
    for (const p of primitives) {
      const primitive = p as { attributes?: unknown; targets?: unknown; indices?: unknown; mode?: unknown } | null;
      if (!primitive || typeof primitive !== "object" || (primitive.mode ?? 4) !== 4) return false;
      if (primitive.targets !== undefined && (!Array.isArray(primitive.targets) || primitive.targets.length)) return false;
      const attributes = primitive.attributes as Record<string, unknown> | undefined;
      if (!attributes || typeof attributes !== "object" || Array.isArray(attributes) || Object.keys(attributes).some((name) => !GLTF_ATTRIBUTE_NAME.test(name))) return false;
      const at = primitive.indices ?? attributes.POSITION;
      if (!Number.isSafeInteger(at) || (at as number) < 0 || (at as number) >= accessors.length) return false;
      const drawn = Math.floor((Number((accessors[at as number] as { count?: unknown } | null)?.count) || 0) / 3);
      if (drawn < 1) return false;
      triangles += drawn;
    }
    meshTriangles.push(triangles);
    meshDraws.push(primitives.length);
  }
  // A mesh used by many parts is drawn that many times, so count per part.
  let triangles = 0, draws = 0;
  for (const node of nodes) {
    const mesh = (node as { mesh?: number }).mesh;
    if (mesh === undefined) continue;
    triangles += meshTriangles[mesh] ?? 0;
    draws += meshDraws[mesh] ?? 0;
  }
  if (draws > MAX_DRAWS || triangles > MAX_TRIANGLES) return false;
  const images = list("images") as { mimeType?: unknown }[];
  return images.length <= MAX_IMAGES && images.every((image) => image && typeof image === "object" && ["image/png", "image/jpeg", "image/webp"].includes(String(image.mimeType)));
}
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const isCount = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

function imageSize(d: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (d.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(12) === 0x49484452) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (d.length >= 4 && d[0] === 0xff && d[1] === 0xd8) {
    let i = 2;
    for (let guard = 0; guard < 10_000 && i + 4 <= d.length; guard++) {
      if (d[i] !== 0xff) return null;
      const marker = d[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = (d[i + 2] << 8) | d[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && i + 9 <= d.length) return { height: (d[i + 5] << 8) | d[i + 6], width: (d[i + 7] << 8) | d[i + 8] };
      if (length < 2) return null;
      i += 2 + length;
    }
    return null;
  }
  const ascii = (at: number, n: number) => String.fromCharCode(...d.subarray(at, at + n));
  if (d.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (kind === "VP8L") return { width: 1 + (((d[22] & 0x3f) << 8) | d[21]), height: 1 + (((d[24] & 0x0f) << 10) | (d[23] << 2) | ((d[22] & 0xc0) >> 6)) };
    if (kind === "VP8X") return { width: 1 + (d[24] | (d[25] << 8) | (d[26] << 16)), height: 1 + (d[27] | (d[28] << 8) | (d[29] << 16)) };
  }
  return null;
}

type Gltf = { accessors?: { count?: unknown; type?: unknown; componentType?: unknown; bufferView?: unknown; sparse?: { count?: unknown } }[]; bufferViews?: { buffer?: unknown; byteOffset?: unknown; byteLength?: unknown }[]; buffers?: unknown[]; images?: { bufferView?: unknown; uri?: unknown }[]; meshes?: unknown[]; nodes?: unknown[] };

// Loaders read these lists by index, so an object like {"0": …} in place of an array would skip the count caps. Lists must be arrays.
const GLTF_LISTS = ["accessors", "animations", "bufferViews", "buffers", "cameras", "images", "materials", "meshes", "nodes", "samplers", "scenes", "skins", "textures", "extensionsUsed", "extensionsRequired"];

function withinBudget(json: Gltf, bytes: ArrayBuffer, bin: { start: number; length: number } | undefined): boolean {
  if (!json || typeof json !== "object" || Array.isArray(json)) return false;
  for (const key of GLTF_LISTS) {
    const value = (json as Record<string, unknown>)[key];
    if (value !== undefined && !Array.isArray(value)) return false;
  }
  if (!itemShapeOk(json as Record<string, unknown>)) return false;
  if (!isCount(json.meshes?.length ?? 0, MAX_MESHES) || !isCount(json.nodes?.length ?? 0, MAX_NODES) || (json.buffers?.length ?? 0) > 1) return false;
  // The single buffer is the BIN chunk. A buffer with its own uri would make the loader read other bytes than the ones checked here.
  for (const buffer of json.buffers ?? []) {
    if (!buffer || typeof buffer !== "object" || (buffer as { uri?: unknown }).uri !== undefined) return false;
  }
  let total = 0;
  for (const a of json.accessors ?? []) {
    const size = TYPE_SIZE[String(a.type)], component = COMPONENT_BYTES[Number(a.componentType)];
    if (!size || !component || !isCount(a.count, MAX_ACCESSOR_COUNT)) return false;
    if (a.bufferView === undefined && a.sparse === undefined) return false;
    if (a.sparse !== undefined && !isCount(a.sparse.count, MAX_ACCESSOR_COUNT)) return false;
    total += (a.count as number) * size * component;
    if (total > MAX_ACCESSOR_BYTES) return false;
  }
  const images = json.images ?? [];
  if (images.length > MAX_IMAGES) return false;
  for (const image of images) {
    if (!image || typeof image !== "object" || image.uri !== undefined) return false;
    const view = Number.isInteger(image.bufferView) ? json.bufferViews?.[image.bufferView as number] : undefined;
    if (!view || view.buffer !== 0 || !bin) return false;
    const start = Number(view.byteOffset ?? 0), length = Number(view.byteLength);
    if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length <= 0 || length > MAX_IMAGE_BYTES || start + length > bin.length) return false;
    const dims = imageSize(new Uint8Array(bytes, bin.start + start, length));
    if (!dims || dims.width > MAX_IMAGE_SIDE || dims.height > MAX_IMAGE_SIDE) return false;
  }
  return true;
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
    const text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes, chunks[0].start, chunks[0].length));
    return glbJsonIsSelfContained(text) && withinBudget(JSON.parse(text), bytes, chunks[1]);
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
