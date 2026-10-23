import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Access } from "./access.ts";
import { bindHostname, handleNetworkRequest, isLanAddress, lanEnableRefusal, lanGateRefuses, lanOnly, NetworkStore, type NetworkContext } from "./network.ts";

describe("which addresses are on the local network", () => {
  it("accepts this PC and the private ranges, edges included", () => {
    for (const address of ["127.0.0.1", "127.8.9.10", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.168.255.254", "169.254.1.1", "::1", "fd00::1", "fc12:3456::9", "fe80::1", "fe80::1%eth0", "::ffff:192.168.1.20", "::ffff:127.0.0.1"]) {
      expect(isLanAddress(address), address).toBe(true);
    }
  });

  it("refuses everything else: public, tailnet, just outside a private range, and what is not an address", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "100.64.0.1", "172.15.255.255", "172.32.0.1", "192.167.1.1", "192.169.1.1", "11.0.0.1", "169.253.1.1", "2606:4700::1", "fec0::1", "::ffff:8.8.8.8", "", "localhost", "not-an-ip", "192.168.1"]) {
      expect(isLanAddress(address), address).toBe(false);
    }
  });
});

describe("where to listen and whether to filter", () => {
  it("listens on loopback unless the mode or HOST says otherwise", () => {
    expect(bindHostname(undefined, "local")).toBe("127.0.0.1");
    expect(bindHostname(undefined, "lan")).toBe("0.0.0.0");
    expect(bindHostname("", "lan")).toBe("0.0.0.0");
    expect(bindHostname("10.0.0.5", "local")).toBe("10.0.0.5");
    expect(bindHostname("10.0.0.5", "lan")).toBe("10.0.0.5");
  });

  it("filters only for the lan mode with no explicit HOST", () => {
    expect(lanOnly(undefined, "lan")).toBe(true);
    expect(lanOnly(undefined, "local")).toBe(false);
    expect(lanOnly("0.0.0.0", "lan")).toBe(false);
  });

  it("refuses an outside or unknown peer only while filtering", () => {
    expect(lanGateRefuses(true, "8.8.8.8")).toBe(true);
    expect(lanGateRefuses(true, null)).toBe(true);
    expect(lanGateRefuses(true, "192.168.1.9")).toBe(false);
    expect(lanGateRefuses(false, "8.8.8.8")).toBe(false);
    expect(lanGateRefuses(false, null)).toBe(false);
  });

  it("will not turn the lan on while nothing would gate it", () => {
    expect(lanEnableRefusal({ tokenConfigured: false, gated: false })).toContain("OVIS_TOKEN");
    expect(lanEnableRefusal({ tokenConfigured: true, gated: false })).toBeNull();
    expect(lanEnableRefusal({ tokenConfigured: false, gated: true })).toBeNull();
  });
});

describe("the stored mode", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ovis-network-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("starts local, keeps a change, and is read again by the next process", () => {
    const store = new NetworkStore(dir);
    expect(store.mode).toBe("local");
    store.set("lan");
    expect(store.mode).toBe("lan");
    expect(new NetworkStore(dir).mode).toBe("lan");
    store.set("local");
    expect(new NetworkStore(dir).mode).toBe("local");
  });

  it("stays local, never wider, when the file is damaged or says something else", () => {
    writeFileSync(join(dir, "network.json"), "not json");
    expect(new NetworkStore(dir).mode).toBe("local");
    writeFileSync(join(dir, "network.json"), JSON.stringify({ mode: "everywhere" }));
    expect(new NetworkStore(dir).mode).toBe("local");
  });
});

describe("the /api/network route", () => {
  let dir: string;
  let applied: number;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ovis-network-")); applied = 0; });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const drive: Access = { level: "full", via: "local", role: "drive" };
  const context = (over: Partial<NetworkContext> = {}): NetworkContext => ({
    store: new NetworkStore(dir), envHost: undefined, bound: () => "127.0.0.1", tokenConfigured: true, gated: () => false, apply: () => { applied++; }, ...over,
  });
  const post = (body: unknown, access: Access, ctx: NetworkContext) =>
    handleNetworkRequest(new Request("http://x/api/network", { method: "POST", body: JSON.stringify(body) }), access, ctx);

  it("reports the mode, where it listens and why the lan is not available", async () => {
    const response = await handleNetworkRequest(new Request("http://x/api/network"), drive, context({ tokenConfigured: false }));
    const status = await response.json() as Record<string, unknown>;
    expect(status).toMatchObject({ mode: "local", bound: "127.0.0.1", lan_only: false, host_set: false });
    expect(String(status["lan_blocked"])).toContain("OVIS_TOKEN");
  });

  it("switches to the lan and back, applying each change once", async () => {
    const ctx = context();
    expect((await post({ mode: "lan" }, drive, ctx)).status).toBe(200);
    expect(ctx.store.mode).toBe("lan");
    expect(applied).toBe(1);
    expect((await post({ mode: "lan" }, drive, ctx)).status).toBe(200);
    expect(applied).toBe(1);
    expect((await post({ mode: "local" }, drive, ctx)).status).toBe(200);
    expect(applied).toBe(2);
  });

  it("refuses the lan with no token and no paired device, and leaves the mode alone", async () => {
    const ctx = context({ tokenConfigured: false });
    const response = await post({ mode: "lan" }, drive, ctx);
    expect(response.status).toBe(409);
    expect(ctx.store.mode).toBe("local");
    expect(applied).toBe(0);
    expect((await post({ mode: "lan" }, drive, context({ tokenConfigured: false, gated: () => true }))).status).toBe(200);
  });

  it("refuses a caller who cannot drive, an explicit HOST, and a bad body", async () => {
    expect((await post({ mode: "lan" }, { level: "full", via: "device", role: "watch" }, context())).status).toBe(403);
    expect((await post({ mode: "lan" }, { level: "none", reason: "token_required" }, context())).status).toBe(403);
    expect((await post({ mode: "lan" }, drive, context({ envHost: "0.0.0.0" }))).status).toBe(409);
    expect((await post({ mode: "anywhere" }, drive, context())).status).toBe(400);
    expect((await handleNetworkRequest(new Request("http://x/api/network", { method: "POST", body: "{" }), drive, context())).status).toBe(400);
    expect((await handleNetworkRequest(new Request("http://x/api/network", { method: "DELETE" }), drive, context())).status).toBe(400);
    expect(applied).toBe(0);
  });
});
