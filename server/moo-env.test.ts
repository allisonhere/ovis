import { describe, expect, it } from "bun:test";
import { adoptMooEnv, cliSocketEnv, herdrBin } from "./moo-env.ts";
import { telemetryBlocked } from "./telemetry.ts";

describe("moo's plugin environment", () => {
  it("fills the herdr names this app reads", () => {
    const env: Record<string, string | undefined> = {
      MOO_SOCKET_PATH: "/m.sock", MOO_PLUGIN_ROOT: "/p", MOO_PLUGIN_STATE_DIR: "/s", MOO_PLUGIN_CONFIG_DIR: "/c", MOO_BIN_PATH: "/bin/moo",
    };
    adoptMooEnv(env);
    expect(env["HERDR_SOCKET_PATH"]).toBe("/m.sock");
    expect(env["HERDR_PLUGIN_ROOT"]).toBe("/p");
    expect(env["HERDR_PLUGIN_STATE_DIR"]).toBe("/s");
    expect(env["HERDR_PLUGIN_CONFIG_DIR"]).toBe("/c");
    expect(env["OVIS_HERDR_BIN"]).toBe("/bin/moo");
  });

  it("never override a variable that is already set", () => {
    const env: Record<string, string | undefined> = { MOO_SOCKET_PATH: "/moo", HERDR_SOCKET_PATH: "/herdr", MOO_BIN_PATH: "/m", OVIS_HERDR_BIN: "/mine" };
    adoptMooEnv(env);
    expect(env["HERDR_SOCKET_PATH"]).toBe("/herdr");
    expect(env["OVIS_HERDR_BIN"]).toBe("/mine");
  });

  it("leave an environment without moo's variables alone", () => {
    const env: Record<string, string | undefined> = { HERDR_SOCKET_PATH: "/h" };
    adoptMooEnv(env);
    expect(env["HERDR_SOCKET_PATH"]).toBe("/h");
    expect(Object.keys(env).sort()).toEqual(["HERDR_SOCKET_PATH", "OVIS_TELEMETRY"]);
  });

  it("send no usage counts unless they are switched on on purpose", () => {
    const off: Record<string, string | undefined> = {};
    adoptMooEnv(off);
    expect(telemetryBlocked(off)).toBe(true);
    const on: Record<string, string | undefined> = { OVIS_TELEMETRY: "1" };
    adoptMooEnv(on);
    expect(on["OVIS_TELEMETRY"]).toBe("1");
    expect(telemetryBlocked(on)).toBe(false);
  });

  it("drive moo unless told otherwise", () => {
    expect(herdrBin({})).toBe("moo");
    expect(herdrBin({ OVIS_HERDR_BIN: "/opt/herdr" })).toBe("/opt/herdr");
  });

  it("name the socket for either CLI", () => {
    expect(cliSocketEnv("/x.sock")).toEqual({ HERDR_SOCKET_PATH: "/x.sock", MOO_SOCKET_PATH: "/x.sock" });
  });
});
