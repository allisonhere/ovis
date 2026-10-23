import { useCallback, useEffect, useState } from "react";

import { ApiError, fetchNetwork, setNetworkMode } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import type { NetworkMode, NetworkStatus } from "../../shared/protocol.ts";
import { Segmented, SettingsRow } from "./SettingsControls.tsx";

/**
 * Who may open this server: this PC only, or this PC and its local network. The server (server/network.ts)
 * listens again on the new address at once, so the setting needs no restart. Shows nothing for a server
 * that has no such setting yet.
 */
export function NetworkPanel({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    fetchNetwork().then((next) => { if (current) setStatus(next); }, () => { /* an older server has no such route */ });
    return () => { current = false; };
  }, []);

  const choose = useCallback(async (mode: NetworkMode) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await setNetworkMode(mode));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.detail : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  if (status === null) return null;
  const description = status.mode === "lan"
    ? t("This PC and devices on your local network can open Ovis. Connections from anywhere else are refused.")
    : t("Only this PC can open Ovis. Other devices on the network cannot.");
  const fixed = readOnly || status.host_set;
  return (
    <SettingsRow
      label={t("Network access")}
      wide
      description={<>
        {description}
        {status.host_set && <span className="settings-condition">{t("HOST is set for this server, so it decides where Ovis listens.")}</span>}
        {!status.host_set && status.mode === "local" && status.lan_blocked !== null && <span className="settings-condition">{status.lan_blocked}</span>}
        {error !== null && <span className="settings-condition" role="alert">{error}</span>}
      </>}
    >
      {!fixed && (
        <Segmented<NetworkMode>
          label={t("Network access")}
          value={status.mode}
          options={[{ value: "local", label: t("This PC only") }, { value: "lan", label: t("Local network") }]}
          onChange={(mode) => { if (!busy && mode !== status.mode) void choose(mode); }}
        />
      )}
    </SettingsRow>
  );
}
