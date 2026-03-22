import {
  GENERIC_REQUEST_MARKER_PATTERN,
  type ProviderAdapter,
} from "./providerAdapter";

export const qwenCodeProviderAdapter: ProviderAdapter = {
  id: "qwen-code",
  displayName: "Qwen Code",
  description: "Headless Qwen Code turns through the local Nomadex bridge.",
  transportLabel: "local Qwen Code CLI",
  availability: "ready",
  transportKind: "cli",
  defaultModel: "default",
  installCommand: "npm i -g @qwen-code/qwen-code@latest",
  wsProxyPath: "/codex-ws",
  authCompletePath: "/codex-auth/complete",
  localImagePath: "/codex-local-image",
  localBrowsePath: "/codex-local-browse/",
  uploadRootDirName: ".qwen-code-web/uploads",
  uploadFilesDirName: ".qwen-code-web/uploads/files",
  requestHeading: "# My request for Qwen Code:",
  requestMarkerPattern: GENERIC_REQUEST_MARKER_PATTERN,
};
