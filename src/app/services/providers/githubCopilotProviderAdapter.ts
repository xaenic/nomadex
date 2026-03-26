import {
  GENERIC_REQUEST_MARKER_PATTERN,
  type ProviderAdapter,
} from "./providerAdapter";

export const githubCopilotProviderAdapter: ProviderAdapter = {
  id: "github-copilot",
  displayName: "GitHub Copilot",
  description: "CLI provider scaffold for GitHub Copilot coding sessions.",
  transportLabel: "scaffolded CLI adapter",
  availability: "scaffolded",
  transportKind: "cli",
  defaultModel: null,
  wsProxyPath: "/github-copilot-ws",
  authCompletePath: "/github-copilot-auth/complete",
  localImagePath: "/github-copilot-local-image",
  localBrowsePath: "/github-copilot-local-browse/",
  uploadRootDirName: "github-copilot/images",
  uploadFilesDirName: "github-copilot/files",
  requestHeading: "# My request for GitHub Copilot:",
  requestMarkerPattern: GENERIC_REQUEST_MARKER_PATTERN,
};
