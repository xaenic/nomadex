import {
  GENERIC_REQUEST_MARKER_PATTERN,
  type ProviderAdapter,
} from "./providerAdapter";

export const codexProviderAdapter: ProviderAdapter = {
  id: "codex",
  displayName: "Codex",
  description: "Live Codex bridge connected to the current Nomadex workspace.",
  transportLabel: "local agent bridge",
  availability: "ready",
  transportKind: "bridge",
  defaultModel: "gpt-5.4",
  wsProxyPath: "/codex-ws",
  authCompletePath: "/codex-auth/complete",
  localImagePath: "/codex-local-image",
  localBrowsePath: "/codex-local-browse/",
  uploadRootDirName: "codex/images",
  uploadFilesDirName: "codex/files",
  requestHeading: "# My request:",
  requestMarkerPattern: GENERIC_REQUEST_MARKER_PATTERN,
};
