/**
 * Who may reach this server over the network: only this PC, or this PC and its local network.
 *
 * `lan` binds every interface and then answers only peers on a private address (isLanAddress), so
 * a router that forwards the port, or an interface with a public address, still gets nothing. The
 * decision is the connection's own address, never a header a client could forge. An explicit HOST
 * overrides the mode and its filter: whoever set it chose where the server answers.
 *
 * The mode lives in network.json in the state directory, beside devices.json, so the app, the
 * plugin command and a restart all agree on it.
 */
import { BlockList, isIP } from "node:net";
import { join } from "node:path";
import { lanExposed } from "./access.ts";
import type { Access } from "./access.ts";
import { badRequest, isJsonObject, jsonResponse } from "./http.ts";
import { readStateDocument, writeStateDocument } from "./state-document.ts";

import type { NetworkMode } from "../shared/protocol.ts";
export type { NetworkMode };
export const NETWORK_MODES: readonly NetworkMode[] = ["local", "lan"];

/** What `lan` lets in: loopback, private and link-local IPv4, and loopback, unique-local and link-local IPv6. */
const LAN = new BlockList();
for (const [network, prefix] of [["127.0.0.0", 8], ["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["169.254.0.0", 16]] as const) {
  LAN.addSubnet(network, prefix, "ipv4");
}
LAN.addAddress("::1", "ipv6");
LAN.addSubnet("fc00::", 7, "ipv6");
LAN.addSubnet("fe80::", 10, "ipv6");

/** Is `address` (as Bun reports a peer) on this PC or its local network? An unparseable address is not. */
export function isLanAddress(address: string): boolean {
  const bare = address.replace(/%.*$/, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare)?.[1] ?? bare;
  const family = isIP(mapped);
  return family === 0 ? false : LAN.check(mapped, family === 6 ? "ipv6" : "ipv4");
}

/** Where to listen: an explicit HOST, else the mode's address. */
export function bindHostname(envHost: string | undefined, mode: NetworkMode): string {
  return envHost || (mode === "lan" ? "0.0.0.0" : "127.0.0.1");
}

/** Whether the LAN-only filter is in force: the mode asks for it and no explicit HOST replaces it. */
export function lanOnly(envHost: string | undefined, mode: NetworkMode): boolean {
  return !envHost && mode === "lan";
}

/** Refuse a peer outside the local network while the filter is in force. No peer address fails closed. */
export function lanGateRefuses(filtering: boolean, peer: string | null): boolean {
  return filtering && (peer === null || !isLanAddress(peer));
}

/** Why `lan` cannot be turned on yet, or null: the same rule that warns about an open LAN address. */
export function lanEnableRefusal(input: { tokenConfigured: boolean; gated: boolean }): string | null {
  return lanExposed({ hostname: "0.0.0.0", ...input })
    ? "Set OVIS_TOKEN or pair a device first (Settings → Phone & devices, on this PC): until then anyone on the network would be let in."
    : null;
}

export class NetworkStore {
  private readonly path: string;
  private current: NetworkMode = "local";

  constructor(stateDir: string) {
    this.path = join(stateDir, "network.json");
    try {
      const read = readStateDocument(this.path);
      const mode = read.kind === "json" && isJsonObject(read.value) ? read.value["mode"] : undefined;
      if (mode === "lan") this.current = "lan";
      else if (read.kind === "malformed") console.error(`${this.path} is not valid JSON; the network mode stays local`);
    } catch (error) {
      console.error(`Cannot read ${this.path} (${(error as NodeJS.ErrnoException).code ?? "error"}); the network mode stays local`);
    }
  }

  get mode(): NetworkMode { return this.current; }

  /** Held only once it is on disk. */
  set(mode: NetworkMode): void {
    writeStateDocument(this.path, `${JSON.stringify({ mode })}\n`, false);
    this.current = mode;
  }
}

export interface NetworkContext {
  store: NetworkStore;
  /** HOST as the process was given it, if it was */
  envHost: string | undefined;
  /** the address the server is listening on now */
  bound: () => string;
  tokenConfigured: boolean;
  gated: () => boolean;
  /** listen again on the address the new mode asks for, once this response has gone out */
  apply: () => void;
}

export function networkStatus(context: NetworkContext) {
  const mode = context.store.mode;
  return {
    mode,
    bound: context.bound(),
    lan_only: lanOnly(context.envHost, mode),
    host_set: Boolean(context.envHost),
    lan_blocked: lanEnableRefusal({ tokenConfigured: context.tokenConfigured, gated: context.gated() }),
  };
}

export async function handleNetworkRequest(request: Request, access: Access, context: NetworkContext): Promise<Response> {
  const noStore = { "cache-control": "no-store" };
  if (request.method === "GET") return jsonResponse(networkStatus(context), 200, noStore);
  if (request.method !== "POST") return badRequest("method_not_allowed", "use GET or POST");
  if (access.level !== "full" || access.role !== "drive") {
    return jsonResponse({ error: { code: "forbidden", message: "changing the network mode needs a device that can drive" } }, 403);
  }
  if (context.envHost) {
    return jsonResponse({ error: { code: "host_set", message: `HOST=${context.envHost} is set, so it decides where Ovis listens; remove it to use this setting` } }, 409);
  }
  let body: unknown;
  try { body = await request.json(); } catch { return badRequest("invalid_json", "request body must be JSON"); }
  const mode = isJsonObject(body) ? body["mode"] : undefined;
  if (mode !== "local" && mode !== "lan") return badRequest("invalid_mode", `mode must be one of ${NETWORK_MODES.join(", ")}`);
  if (mode === "lan") {
    const blocked = lanEnableRefusal({ tokenConfigured: context.tokenConfigured, gated: context.gated() });
    if (blocked !== null) return jsonResponse({ error: { code: "lan_blocked", message: blocked } }, 409);
  }
  if (mode !== context.store.mode) {
    try { context.store.set(mode); }
    catch (error) { return jsonResponse({ error: { code: "network_write_failed", message: (error as Error).message } }, 500); }
    context.apply();
  }
  return jsonResponse(networkStatus(context), 200, noStore);
}
