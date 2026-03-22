export type ProviderId =
  | "codex"
  | "antigravity"
  | "opencode"
  | "qwen-code"
  | "gemini-cli"
  | "github-copilot";

export type ProviderAvailability = "ready" | "scaffolded";
export type ProviderTransportKind = "bridge" | "cli";

export type ProviderAdapter = {
  id: ProviderId;
  displayName: string;
  description: string;
  transportLabel: string;
  availability: ProviderAvailability;
  transportKind: ProviderTransportKind;
  defaultModel: string | null;
  installCommand?: string;
  wsProxyPath: string;
  authCompletePath: string;
  localImagePath: string;
  localBrowsePath: string;
  uploadRootDirName: string;
  uploadFilesDirName: string;
  requestHeading: string;
  requestMarkerPattern: RegExp;
};

export const GENERIC_REQUEST_MARKER_PATTERN =
  /(?:^|\n)\s{0,3}#{0,6}\s*my request(?:\s+for\s+[^:\n]+)?\s*:?\s*/giu;

const trimWorkspaceRoot = (cwd: string) => cwd.replace(/[\\/]+$/u, "");

const joinWorkspacePath = (cwd: string, relativePath: string) =>
  `${trimWorkspaceRoot(cwd)}/${relativePath.replace(/^\/+/u, "")}`;

export const buildProviderUploadRoot = (
  adapter: ProviderAdapter,
  cwd: string,
) => joinWorkspacePath(cwd, adapter.uploadRootDirName);

export const buildProviderFilesUploadRoot = (
  adapter: ProviderAdapter,
  cwd: string,
) => joinWorkspacePath(cwd, adapter.uploadFilesDirName);

export const buildProviderOptimisticUploadPath = (
  adapter: ProviderAdapter,
  cwd: string,
  fileName: string,
) => `${buildProviderUploadRoot(adapter, cwd)}/${fileName}`;

export const buildProviderOptimisticFileUploadPath = (
  adapter: ProviderAdapter,
  cwd: string,
  fileName: string,
) => `${buildProviderFilesUploadRoot(adapter, cwd)}/${fileName}`;

export const buildProviderImageUrl = (
  adapter: ProviderAdapter,
  pathValue: string,
) => `${adapter.localImagePath}?path=${encodeURIComponent(pathValue)}`;

export const buildProviderBrowseUrl = (
  adapter: ProviderAdapter,
  pathValue: string,
) => `${adapter.localBrowsePath}${encodeURI(pathValue)}`;

export const providerIsReady = (adapter: ProviderAdapter) =>
  adapter.availability === "ready";
