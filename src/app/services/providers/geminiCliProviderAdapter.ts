import {
  GENERIC_REQUEST_MARKER_PATTERN,
  type ProviderAdapter,
} from "./providerAdapter";

export const geminiCliProviderAdapter: ProviderAdapter = {
  id: "gemini-cli",
  displayName: "Gemini CLI",
  description: "CLI provider scaffold for Gemini CLI workspaces.",
  transportLabel: "scaffolded CLI adapter",
  availability: "scaffolded",
  transportKind: "cli",
  defaultModel: null,
  wsProxyPath: "/gemini-cli-ws",
  authCompletePath: "/gemini-cli-auth/complete",
  localImagePath: "/gemini-cli-local-image",
  localBrowsePath: "/gemini-cli-local-browse/",
  uploadRootDirName: ".gemini-cli-web/uploads",
  uploadFilesDirName: ".gemini-cli-web/uploads/files",
  requestHeading: "# My request for Gemini CLI:",
  requestMarkerPattern: GENERIC_REQUEST_MARKER_PATTERN,
};
