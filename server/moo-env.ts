/**
 * moo hands a plugin MOO_* where herdr handed HERDR_*, and its CLI answers to MOO_SOCKET_PATH.
 * The rest of this codebase reads the herdr names, so each one moo set fills the name it goes by
 * here; a variable that is already set always wins. Entry points apply it to their own
 * environment through adopt-legacy-env.ts (and scripts/plugin.ts, which runs without it).
 *
 * Upstream reports anonymous usage counts to its author's server unless OVIS_TELEMETRY=0. This
 * fork runs for its owner, who never agreed to that, so the counts are off until OVIS_TELEMETRY=1
 * is set on purpose.
 */

/** moo variable -> the variable this codebase reads */
const ADOPTED: Record<string, string> = {
  MOO_SOCKET_PATH: "HERDR_SOCKET_PATH",
  MOO_PLUGIN_ROOT: "HERDR_PLUGIN_ROOT",
  MOO_PLUGIN_STATE_DIR: "HERDR_PLUGIN_STATE_DIR",
  MOO_PLUGIN_CONFIG_DIR: "HERDR_PLUGIN_CONFIG_DIR",
  MOO_BIN_PATH: "OVIS_HERDR_BIN",
};

/** Fills each unset herdr-named variable from the moo one it stands for, in place. */
export function adoptMooEnv(env: Record<string, string | undefined>): void {
  for (const [moo, herdr] of Object.entries(ADOPTED)) {
    if (env[moo] !== undefined && env[herdr] === undefined) env[herdr] = env[moo];
  }
  if (env["OVIS_TELEMETRY"] === undefined) env["OVIS_TELEMETRY"] = "0";
}

/** The CLI this server drives: OVIS_HERDR_BIN, else moo from the PATH. */
export function herdrBin(env: Record<string, string | undefined> = process.env): string {
  return env["OVIS_HERDR_BIN"] || "moo";
}

/** What the CLI needs to reach `socketPath`: moo reads MOO_SOCKET_PATH, herdr HERDR_SOCKET_PATH. */
export function cliSocketEnv(socketPath: string): Record<string, string> {
  return { HERDR_SOCKET_PATH: socketPath, MOO_SOCKET_PATH: socketPath };
}
