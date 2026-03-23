import type { ReasoningEffort } from "../../../protocol";
import type { InputModality } from "../../../protocol/InputModality";
import type { Model } from "../../../protocol/v2";
import type { ProviderId } from "./providerAdapter";

const providerReasoningOption = (
  effort: ReasoningEffort,
  description: string,
) => ({
  reasoningEffort: effort,
  description,
});

const providerModelModalities = (...modalities: Array<InputModality>) =>
  modalities;

const makeProviderModel = ({
  id,
  displayName,
  description,
  defaultReasoningEffort,
  supportedReasoningEfforts,
  inputModalities,
  isDefault = false,
}: {
  id: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: Array<ReasoningEffort>;
  inputModalities: Array<InputModality>;
  isDefault?: boolean;
}): Model => ({
  id,
  model: id,
  upgrade: null,
  upgradeInfo: null,
  availabilityNux: null,
  displayName,
  description,
  hidden: false,
  supportedReasoningEfforts: supportedReasoningEfforts.map((effort) =>
    providerReasoningOption(
      effort,
      `${displayName} supports ${effort} reasoning.`,
    ),
  ),
  defaultReasoningEffort,
  inputModalities,
  supportsPersonality: true,
  isDefault,
});

const EMPTY_PROVIDER_MODELS: Array<Model> = [];

const OPENCODE_FREE_MODELS: Array<Model> = [
  makeProviderModel({
    id: "opencode/big-pickle",
    displayName: "Big Pickle",
    description: "OpenCode Zen free model. Limited-time free access.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
    inputModalities: providerModelModalities("text"),
    isDefault: true,
  }),
  makeProviderModel({
    id: "opencode/minimax-m2.5-free",
    displayName: "MiniMax M2.5 Free",
    description: "OpenCode Zen free model. Limited-time free access.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
    inputModalities: providerModelModalities("text"),
  }),
  makeProviderModel({
    id: "opencode/mimo-v2-pro-free",
    displayName: "MiMo V2 Pro Free",
    description: "OpenCode Zen free model. Limited-time free access.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
    inputModalities: providerModelModalities("text"),
  }),
  makeProviderModel({
    id: "opencode/mimo-v2-omni-free",
    displayName: "MiMo V2 Omni Free",
    description: "OpenCode Zen free model. Limited-time free access.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
    inputModalities: providerModelModalities("text"),
  }),
  makeProviderModel({
    id: "opencode/nemotron-3-super-free",
    displayName: "Nemotron 3 Super Free",
    description: "OpenCode Zen free model. Limited-time free access.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
    inputModalities: providerModelModalities("text"),
  }),
];

export const listProviderModels = (
  providerId: ProviderId,
  fallbackModels: Array<Model>,
): Array<Model> => {
  if (providerId === "opencode") {
    return OPENCODE_FREE_MODELS;
  }

  if (providerId === "codex") {
    return fallbackModels;
  }

  return EMPTY_PROVIDER_MODELS;
};

export const findProviderModel = (
  providerId: ProviderId,
  modelId: string,
  fallbackModels: Array<Model>,
): Model | null =>
  listProviderModels(providerId, fallbackModels).find(
    (entry) => entry.id === modelId,
  ) ?? null;
