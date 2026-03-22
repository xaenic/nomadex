import { codexProviderAdapter } from "./codexProviderAdapter";
import type { ProviderAdapter } from "./providerAdapter";

export type ProviderId = "codex";

const providerRegistry: Record<ProviderId, ProviderAdapter> = {
  codex: codexProviderAdapter,
};

export const DEFAULT_PROVIDER_ID: ProviderId = "codex";

export const listProviderAdapters = (): ProviderAdapter[] => Object.values(providerRegistry);

export const getProviderAdapter = (providerId: ProviderId = DEFAULT_PROVIDER_ID): ProviderAdapter =>
  providerRegistry[providerId];

export const activeProviderAdapter = getProviderAdapter();
