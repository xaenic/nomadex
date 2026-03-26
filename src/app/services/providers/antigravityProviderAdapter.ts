import {
  GENERIC_REQUEST_MARKER_PATTERN,
  type ProviderAdapter,
} from "./providerAdapter";

export const antigravityProviderAdapter: ProviderAdapter = {
  id: "antigravity",
  displayName: "Antigravity",
  description: "CLI provider scaffold for Antigravity sessions.",
  transportLabel: "scaffolded CLI adapter",
  availability: "scaffolded",
  transportKind: "cli",
  defaultModel: null,
  wsProxyPath: "/antigravity-ws",
  authCompletePath: "/antigravity-auth/complete",
  localImagePath: "/antigravity-local-image",
  localBrowsePath: "/antigravity-local-browse/",
  uploadRootDirName: "antigravity/images",
  uploadFilesDirName: "antigravity/files",
  requestHeading: "# My request for Antigravity:",
  requestMarkerPattern: GENERIC_REQUEST_MARKER_PATTERN,
};
