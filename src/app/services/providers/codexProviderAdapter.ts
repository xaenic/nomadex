import type { ProviderAdapter } from "./providerAdapter";

export const codexProviderAdapter: ProviderAdapter = {
  id: "codex",
  displayName: "Codex",
  transportLabel: "local agent bridge",
  wsProxyPath: "/codex-ws",
  authCompletePath: "/codex-auth/complete",
  localImagePath: "/codex-local-image",
  localBrowsePath: "/codex-local-browse",
  uploadRootDirName: ".codex-web/uploads",
  uploadFilesDirName: ".codex-web/uploads/files",
  requestHeading: "# My request:",
  requestMarkerPattern:
    /(?:^|\n)\s{0,3}#{0,6}\s*my request(?:\s+for\s+(?:codex|nomadex|assistant))?\s*:?\s*/giu,
};
