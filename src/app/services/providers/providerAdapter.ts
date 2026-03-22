export type ProviderAdapter = {
  id: string;
  displayName: string;
  transportLabel: string;
  wsProxyPath: string;
  authCompletePath: string;
  localImagePath: string;
  localBrowsePath: string;
  uploadRootDirName: string;
  uploadFilesDirName: string;
  requestHeading: string;
  requestMarkerPattern: RegExp;
};

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
