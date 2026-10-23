/**
 * Ovis run as a moo plugin lives only as long as the moo server it serves. A plugin is not
 * supervised by moo, so Ovis watches the server itself: once the server has answered, and then
 * stays unreachable for a grace period, Ovis stops. The grace period lets a quick stop and start
 * of the server (or an update's handover) pass without churn; moo's startup hook starts Ovis again
 * with the next server.
 *
 * OVIS_STOP_WITH_MOO=0 keeps Ovis running without its server. A server that was never reached is not
 * "gone": a manual start before moo, or by hand outside a plugin, never stops itself.
 */

export const HOST_POLL_MS = 2_000;
const DEFAULT_GRACE_MS = 10_000;

export class HostWatch {
  private seen = false;
  private goneSince: number | null = null;

  constructor(private readonly graceMs: number) {}

  /** Report one probe of the server; true once it was seen alive and has been unreachable for the grace period. */
  observe(alive: boolean, now: number): boolean {
    if (alive) {
      this.seen = true;
      this.goneSince = null;
      return false;
    }
    if (!this.seen) return false;
    this.goneSince ??= now;
    return now - this.goneSince >= this.graceMs;
  }
}

/** Is this Ovis a moo plugin whose lifetime follows the server's? */
export function stopsWithHost(env: Record<string, string | undefined>): boolean {
  if (env["HERDR_PLUGIN_ROOT"] === undefined) return false;
  return !["0", "false", "off", "no"].includes((env["OVIS_STOP_WITH_MOO"] ?? "").trim().toLowerCase());
}

/** The grace period, in ms: OVIS_HOST_GRACE_MS when it is a positive number, else ten seconds. */
export function hostGraceMs(env: Record<string, string | undefined>): number {
  const set = Number(env["OVIS_HOST_GRACE_MS"]);
  return Number.isFinite(set) && set > 0 ? set : DEFAULT_GRACE_MS;
}
