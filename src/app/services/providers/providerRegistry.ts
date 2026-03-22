import { antigravityProviderAdapter } from "./antigravityProviderAdapter";
import { codexProviderAdapter } from "./codexProviderAdapter";
import { geminiCliProviderAdapter } from "./geminiCliProviderAdapter";
import { githubCopilotProviderAdapter } from "./githubCopilotProviderAdapter";
import { opencodeProviderAdapter } from "./opencodeProviderAdapter";
import type { ProviderAdapter, ProviderId } from "./providerAdapter";
import { qwenCodeProviderAdapter } from "./qwenCodeProviderAdapter";

export const WORKSPACE_PROVIDER_STORAGE_KEY = "nomadex-provider";

const providerRegistry: Record<ProviderId, ProviderAdapter> = {
  codex: codexProviderAdapter,
  antigravity: antigravityProviderAdapter,
  "gemini-cli": geminiCliProviderAdapter,
  "github-copilot": githubCopilotProviderAdapter,
  opencode: opencodeProviderAdapter,
  "qwen-code": qwenCodeProviderAdapter,
};

export const DEFAULT_PROVIDER_ID: ProviderId = "codex";

export const listProviderAdapters = (): ProviderAdapter[] => Object.values(providerRegistry);

export const getProviderAdapter = (providerId: ProviderId = DEFAULT_PROVIDER_ID): ProviderAdapter =>
  providerRegistry[providerId];

export const isProviderId = (value: string | null | undefined): value is ProviderId =>
  Boolean(value && value in providerRegistry);

export const readStoredProviderId = (): ProviderId => {
  if (typeof window === "undefined") {
    return DEFAULT_PROVIDER_ID;
  }

  const stored = window.localStorage.getItem(WORKSPACE_PROVIDER_STORAGE_KEY);
  return isProviderId(stored) ? stored : DEFAULT_PROVIDER_ID;
};

export const persistProviderId = (providerId: ProviderId) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(WORKSPACE_PROVIDER_STORAGE_KEY, providerId);
};
