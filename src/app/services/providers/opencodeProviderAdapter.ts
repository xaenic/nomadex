import {
  GENERIC_REQUEST_MARKER_PATTERN,
  type ProviderAdapter,
} from "./providerAdapter";

export const opencodeProviderAdapter: ProviderAdapter = {
  id: "opencode",
  displayName: "OpenCode",
  description: "Headless OpenCode CLI turns through the local Nomadex bridge.",
  transportLabel: "local OpenCode CLI",
  availability: "ready",
  transportKind: "cli",
  defaultModel: "opencode/big-pickle",
  installCommand: "npm i -g opencode-ai@latest",
  wsProxyPath: "/codex-ws",
  authCompletePath: "/codex-auth/complete",
  localImagePath: "/codex-local-image",
  localBrowsePath: "/codex-local-browse/",
  uploadRootDirName: ".opencode-web/uploads",
  uploadFilesDirName: ".opencode-web/uploads/files",
  requestHeading: "# My request for OpenCode:",
  requestMarkerPattern: GENERIC_REQUEST_MARKER_PATTERN,
};
