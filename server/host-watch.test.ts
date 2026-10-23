import { describe, expect, it } from "bun:test";
import { HostWatch, hostGraceMs, stopsWithHost } from "./host-watch.ts";

describe("watching the server a plugin runs for", () => {
  it("stops only after a server that was there has been gone for the grace period", () => {
    const watch = new HostWatch(10_000);
    expect(watch.observe(true, 0)).toBe(false);
    expect(watch.observe(false, 1_000)).toBe(false);
    expect(watch.observe(false, 10_999)).toBe(false);
    expect(watch.observe(false, 11_000)).toBe(true);
    expect(watch.observe(false, 20_000)).toBe(true);
  });

  it("forgives a server that comes back inside the grace period, and starts counting again", () => {
    const watch = new HostWatch(10_000);
    watch.observe(true, 0);
    expect(watch.observe(false, 5_000)).toBe(false);
    expect(watch.observe(true, 9_000)).toBe(false);
    expect(watch.observe(false, 12_000)).toBe(false);
    expect(watch.observe(false, 21_999)).toBe(false);
    expect(watch.observe(false, 22_000)).toBe(true);
  });

  it("never stops for a server it has not reached yet", () => {
    const watch = new HostWatch(1_000);
    for (const now of [0, 5_000, 60_000]) expect(watch.observe(false, now)).toBe(false);
  });
});

describe("when Ovis follows its server", () => {
  it("only as a plugin, and unless switched off", () => {
    expect(stopsWithHost({})).toBe(false);
    expect(stopsWithHost({ HERDR_PLUGIN_ROOT: "/p" })).toBe(true);
    expect(stopsWithHost({ HERDR_PLUGIN_ROOT: "/p", OVIS_STOP_WITH_MOO: "1" })).toBe(true);
    for (const off of ["0", "false", "off", "NO"]) expect(stopsWithHost({ HERDR_PLUGIN_ROOT: "/p", OVIS_STOP_WITH_MOO: off })).toBe(false);
  });

  it("waits ten seconds unless told a positive number", () => {
    expect(hostGraceMs({})).toBe(10_000);
    expect(hostGraceMs({ OVIS_HOST_GRACE_MS: "500" })).toBe(500);
    for (const bad of ["0", "-5", "soon", ""]) expect(hostGraceMs({ OVIS_HOST_GRACE_MS: bad })).toBe(10_000);
  });
});
