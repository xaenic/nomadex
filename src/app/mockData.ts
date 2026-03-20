import { queryOptions } from "@tanstack/react-query";

import type { ReasoningEffort, Tool } from "../protocol";
import type { InputModality } from "../protocol/InputModality";
import type { Model, McpServerStatus, Thread, ThreadItem, Turn, UserInput } from "../protocol/v2";

export type WorkspaceMode = "chat" | "review" | "skills" | "mcp" | "settings";
export type InspectorTab = "ops" | "agents" | "skills" | "mcp" | "review" | "settings";
export type WorkspaceSection = "chat" | "ops" | "agents" | "review" | "skills" | "mcp" | "settings";

export type MentionAttachment = {
  id: string;
  name: string;
  path: string;
  kind: "file" | "directory";
};

export type SkillCard = {
  id: string;
  name: string;
  description: string;
  path: string;
  scope: "user" | "workspace" | "system";
  enabled: boolean;
  source: "installed" | "remote";
  tags: string[];
};

export type RemoteSkillCard = SkillCard & {
  repo: string;
  downloads: string;
};

export type ApprovalRequest = {
  id: string;
  kind: "command" | "patch" | "permissions" | "mcp" | "question";
  title: string;
  detail: string;
  risk: "low" | "medium" | "high";
  state: "pending" | "approved" | "declined" | "submitted";
  threadId?: string;
  turnId?: string | null;
  itemId?: string | null;
  method?: string;
  command?: string;
  files?: string[];
  serverName?: string;
  availableDecisions?: string[];
  questions?: Array<{
    id: string;
    header: string;
    question: string;
    isSecret: boolean;
    isOther: boolean;
    options: Array<{
      label: string;
      description: string;
    }>;
  }>;
  form?: string;
};

export type TerminalSession = {
  id: string;
  title: string;
  command: string;
  cwd: string;
  processId: string;
  status: "running" | "idle" | "failed";
  background: boolean;
  lastEvent: string;
  log: string[];
};

export type ModelReroute = {
  id: string;
  from: string;
  to: string;
  reason: string;
  at: string;
};

export type ReviewFinding = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  file: string;
  line: number;
  summary: string;
  status: "open" | "fixed" | "accepted";
};

export type ThreadPlan = {
  explanation: string;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
};

export type SettingsState = {
  model: string;
  reasoningEffort: ReasoningEffort;
  approvalPolicy: "untrusted" | "on-failure" | "on-request" | "never";
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  collaborationMode: "default" | "plan";
  personality: "none" | "friendly" | "pragmatic";
  webSearch: boolean;
  analytics: boolean;
  hideRateLimitNudge: boolean;
};

export type FeatureFlag = {
  name: string;
  stage: "beta" | "underDevelopment" | "stable" | "deprecated" | "removed";
  enabled: boolean;
};

export type AccountState = {
  planType: string;
  workspace: string;
  authMode: string;
  loggedIn: boolean;
  requiresOpenaiAuth: boolean;
  loginInProgress: boolean;
  pendingLoginId: string | null;
  loginError: string | null;
  rateUsed: number;
  rateLimit: number;
  credits: string;
  usageWindows: Array<{
    id: string;
    label: string;
    usedPercent: number;
    windowDurationMins: number | null;
    resetsAt: number | null;
  }>;
};

export type StreamSpec = {
  key: string;
  threadId: string;
  turnId: string;
  itemId: string;
  field: "text" | "aggregatedOutput";
  visible: number;
  total: number;
  speed: number;
};

export type ThreadRecord = {
  thread: Thread;
  plan: ThreadPlan | null;
  steerSuggestions: string[];
  approvals: ApprovalRequest[];
  terminals: TerminalSession[];
  reroutes: ModelReroute[];
  review: ReviewFinding[];
  tokenUsage: {
    input: number;
    output: number;
    cached: number;
  };
};

export type CollaborationPreset = {
  name: string;
  mode: "default" | "plan";
  model: string;
  effort: ReasoningEffort;
};

export type DashboardData = {
  threads: ThreadRecord[];
  models: Model[];
  collaborationModes: CollaborationPreset[];
  settings: SettingsState;
  installedSkills: SkillCard[];
  remoteSkills: RemoteSkillCard[];
  mcpServers: McpServerStatus[];
  featureFlags: FeatureFlag[];
  account: AccountState;
  mentionCatalog: MentionAttachment[];
  directoryCatalog: MentionAttachment[];
  directoryCatalogRoot: string | null;
  lastSavedAt: string;
  streams: StreamSpec[];
  remoteSkillsError: string | null;
  transport: {
    mode: "mock" | "live";
    status: "connecting" | "connected" | "offline" | "error";
    endpoint: string;
    error: string | null;
  };
};

export type ComposerImage = {
  id: string;
  name: string;
  url: string;
  size: string;
};

export type ComposerFile = {
  id: string;
  name: string;
  size: string;
  file: File;
};

export type CreateTurnArgs = {
  threadId: string;
  prompt: string;
  mode: WorkspaceMode;
  settings: SettingsState;
  mentions: MentionAttachment[];
  skills: SkillCard[];
  images: ComposerImage[];
  steer: string | null;
};

export type CreateTurnResult = {
  turn: Turn;
  plan: ThreadPlan;
  streams: StreamSpec[];
  terminals: TerminalSession[];
  review: ReviewFinding[];
};

const WORKSPACE_CWD = "/home/allan/codex-console";
const now = Math.floor(Date.now() / 1000);

const reasoningOption = (effort: ReasoningEffort, description: string) => ({
  reasoningEffort: effort,
  description,
});

const modelModalities = (...items: InputModality[]): Array<InputModality> => items;

const makeModel = ({
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
    reasoningOption(effort, `${displayName} supports ${effort} reasoning.`),
  ),
  defaultReasoningEffort,
  inputModalities,
  supportsPersonality: true,
  isDefault,
});

const models: Array<Model> = [
  makeModel({
    id: "gpt-5.4",
    displayName: "gpt-5.4",
    description: "Latest frontier agentic coding model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    inputModalities: modelModalities("text", "image"),
    isDefault: true,
  }),
  makeModel({
    id: "gpt-5.4-mini",
    displayName: "GPT-5.4-Mini",
    description: "Fast Codex model for low-latency editing and subagent work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    inputModalities: modelModalities("text", "image"),
  }),
  makeModel({
    id: "gpt-5.3-codex",
    displayName: "gpt-5.3-codex",
    description: "Frontier Codex-optimized model for deep coding passes.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    inputModalities: modelModalities("text", "image"),
  }),
  makeModel({
    id: "gpt-5.2-codex",
    displayName: "gpt-5.2-codex",
    description: "Strong baseline coding model with broad tool reliability.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    inputModalities: modelModalities("text"),
  }),
  makeModel({
    id: "gpt-5.1-codex-mini",
    displayName: "gpt-5.1-codex-mini",
    description: "Cheap and responsive codex mini for fanout and tight loops.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium", "high"],
    inputModalities: modelModalities("text"),
  }),
];

const mentionCatalog: Array<MentionAttachment> = [
  {
    id: "mention-shell",
    name: "src/app/CodexWorkspace.tsx",
    path: `${WORKSPACE_CWD}/src/app/CodexWorkspace.tsx`,
    kind: "file",
  },
  {
    id: "mention-data",
    name: "src/app/mockData.ts",
    path: `${WORKSPACE_CWD}/src/app/mockData.ts`,
    kind: "file",
  },
  {
    id: "mention-router",
    name: "src/router.tsx",
    path: `${WORKSPACE_CWD}/src/router.tsx`,
    kind: "file",
  },
  {
    id: "mention-css",
    name: "src/index.css",
    path: `${WORKSPACE_CWD}/src/index.css`,
    kind: "file",
  },
  {
    id: "mention-config",
    name: "~/.codex/config.toml",
    path: "/home/allan/.codex/config.toml",
    kind: "file",
  },
  {
    id: "mention-skills",
    name: "~/.codex/skills",
    path: "/home/allan/.codex/skills",
    kind: "directory",
  },
];

const installedSkills: Array<SkillCard> = [
  {
    id: "skill-frontend-design",
    name: "frontend-design",
    description: "Create distinctive, production-grade frontend interfaces.",
    path: "/home/allan/.codex/skills/frontend-design/SKILL.md",
    scope: "user",
    enabled: true,
    source: "installed",
    tags: ["ui", "react", "polish"],
  },
  {
    id: "skill-suppliers-guard",
    name: "suppliers-portal-docker-guard",
    description: "Enforce Docker-based validation on SuppliersPortal changes.",
    path: "/home/allan/.codex/skills/suppliers-portal-docker-guard/SKILL.md",
    scope: "user",
    enabled: true,
    source: "installed",
    tags: ["docker", "validation", "backend"],
  },
];

const remoteSkills: Array<RemoteSkillCard> = [
  {
    id: "remote-openai-docs",
    name: "openai-docs",
    description: "Use official OpenAI documentation and current product guidance.",
    path: "plugin://codex-market/openai-docs",
    scope: "system",
    enabled: false,
    source: "remote",
    tags: ["docs", "api", "official"],
    repo: "codex-marketplace/openai-docs",
    downloads: "19.2k",
  },
  {
    id: "remote-skill-installer",
    name: "skill-installer",
    description: "Install curated or repository-backed Codex skills.",
    path: "plugin://codex-market/skill-installer",
    scope: "system",
    enabled: false,
    source: "remote",
    tags: ["skills", "install", "marketplace"],
    repo: "codex-marketplace/skill-installer",
    downloads: "11.8k",
  },
  {
    id: "remote-skill-creator",
    name: "skill-creator",
    description: "Generate and refine reusable Codex skills from a workflow.",
    path: "plugin://codex-market/skill-creator",
    scope: "system",
    enabled: false,
    source: "remote",
    tags: ["skills", "authoring", "automation"],
    repo: "codex-marketplace/skill-creator",
    downloads: "8.4k",
  },
];

const tool = (name: string, description: string): Tool => ({
  name,
  title: name,
  description,
  inputSchema: {
    type: "object",
    additionalProperties: true,
  },
});

const mcpServers: Array<McpServerStatus> = [
  {
    name: "github",
    tools: {
      "issues.list": tool("issues.list", "List GitHub issues for a repository."),
      "pull_requests.create": tool("pull_requests.create", "Open a pull request from a branch."),
      "repo.read_file": tool("repo.read_file", "Read a file from a repository."),
    },
    resources: [
      {
        name: "openai/codex issues",
        title: "Issue Tracker",
        description: "Latest issues for the Codex repository.",
        uri: "repo://openai/codex/issues",
      },
    ],
    resourceTemplates: [
      {
        name: "Repository File",
        title: "Repository file",
        uriTemplate: "repo://{owner}/{repo}/blob/{ref}/{path}",
      },
    ],
    authStatus: "oAuth",
  },
  {
    name: "filesystem",
    tools: {
      "read_file": tool("read_file", "Read file contents."),
      "read_directory": tool("read_directory", "List directory contents."),
      "write_file": tool("write_file", "Write a file on disk."),
    },
    resources: [
      {
        name: "workspace",
        title: "Workspace root",
        description: "Primary writable project directory.",
        uri: `file://${WORKSPACE_CWD}`,
      },
    ],
    resourceTemplates: [],
    authStatus: "unsupported",
  },
  {
    name: "playwright",
    tools: {
      "browser_open": tool("browser_open", "Open a browser page."),
      "browser_click": tool("browser_click", "Click an element."),
      "browser_snapshot": tool("browser_snapshot", "Capture a viewport snapshot."),
    },
    resources: [],
    resourceTemplates: [],
    authStatus: "unsupported",
  },
  {
    name: "supabase",
    tools: {
      "sql.query": tool("sql.query", "Run a SQL query."),
      "functions.deploy": tool("functions.deploy", "Deploy an edge function."),
    },
    resources: [],
    resourceTemplates: [],
    authStatus: "notLoggedIn",
  },
];

const featureFlags: Array<FeatureFlag> = [
  { name: "multi_agent", stage: "stable", enabled: true },
  { name: "shell_tool", stage: "stable", enabled: true },
  { name: "skill_mcp_dependency_install", stage: "stable", enabled: true },
  { name: "guardian_approval", stage: "beta", enabled: false },
  { name: "realtime_conversation", stage: "underDevelopment", enabled: false },
  { name: "responses_websockets_v2", stage: "underDevelopment", enabled: false },
  { name: "image_generation", stage: "underDevelopment", enabled: false },
];

const settings: SettingsState = {
  model: "gpt-5.4",
  reasoningEffort: "xhigh",
  approvalPolicy: "on-request",
  sandboxMode: "workspace-write",
  collaborationMode: "default",
  personality: "pragmatic",
  webSearch: true,
  analytics: true,
  hideRateLimitNudge: true,
};

const collaborationModes: Array<CollaborationPreset> = [
  {
    name: "Default",
    mode: "default",
    model: "gpt-5.4",
    effort: "medium",
  },
  {
    name: "Plan",
    mode: "plan",
    model: "gpt-5.4",
    effort: "xhigh",
  },
];

const account: AccountState = {
  planType: "ChatGPT Pro",
  workspace: "allan@local",
  authMode: "chatgpt",
  loggedIn: true,
  requiresOpenaiAuth: false,
  loginInProgress: false,
  pendingLoginId: null,
  loginError: null,
  rateUsed: 68,
  rateLimit: 100,
  credits: "Remote metered, local tools unrestricted",
  usageWindows: [
    {
      id: "five-hour",
      label: "5-hour",
      usedPercent: 68,
      windowDurationMins: 300,
      resetsAt: now + 60 * 90,
    },
    {
      id: "weekly",
      label: "Weekly",
      usedPercent: 41,
      windowDurationMins: 60 * 24 * 7,
      resetsAt: now + 60 * 60 * 24 * 3,
    },
  ],
};

const textInput = (text: string): UserInput => ({
  type: "text",
  text,
  text_elements: [],
});

const mentionInput = (mention: MentionAttachment): UserInput => ({
  type: "mention",
  name: mention.name,
  path: mention.path,
});

const skillInput = (skill: SkillCard): UserInput => ({
  type: "skill",
  name: skill.name,
  path: skill.path,
});

const localImageInput = (path: string): UserInput => ({
  type: "localImage",
  path,
});

const imageInput = (url: string): UserInput => ({
  type: "image",
  url,
});

const streamFor = (
  threadId: string,
  turnId: string,
  itemId: string,
  field: StreamSpec["field"],
  text: string,
  speed: number,
  visible = 0,
): StreamSpec => ({
  key: `${itemId}:${field}`,
  threadId,
  turnId,
  itemId,
  field,
  total: text.length,
  visible,
  speed,
});

const threadUiShellTurnOneItems: Array<ThreadItem> = [
  {
    type: "userMessage",
    id: "item-user-1",
    content: [
      textInput(
        "Build a VS Code-style web UI for Codex Console with streaming messages, plans, subagents, skills, MCP, settings, and background terminals.",
      ),
      mentionInput(mentionCatalog[1]),
      skillInput(installedSkills[0]),
      localImageInput("/home/allan/ui.jpg"),
    ],
  },
  {
    type: "reasoning",
    id: "item-reason-1",
    summary: [
      "Use the Codex app-server protocol as the UI contract.",
      "Keep the shell dense, keyboard-forward, and session-centric.",
    ],
    content: [
      "Map the extension into a three-column layout: thread rail, conversation stack, inspector rail.",
      "Represent Codex items directly so terminals, diffs, approvals, and subagent actions do not collapse into generic chat bubbles.",
    ],
  },
  {
    type: "plan",
    id: "item-plan-1",
    text: "Scaffold the app shell, mirror Codex thread items, then layer live streaming and the right-side operational panels.",
  },
  {
    type: "commandExecution",
    id: "item-cmd-1",
    command: "npm install @tanstack/react-router @tanstack/react-query @tanstack/react-virtual lucide-react clsx",
    cwd: WORKSPACE_CWD,
    processId: "pty-22041",
    status: "completed",
    commandActions: [
      {
        type: "unknown",
        command: "npm install @tanstack/react-router @tanstack/react-query @tanstack/react-virtual lucide-react clsx",
      },
    ],
    aggregatedOutput: [
      "added 194 packages",
      "audited 195 packages in 11s",
      "0 vulnerabilities",
    ].join("\n"),
    exitCode: 0,
    durationMs: 11234,
  },
  {
    type: "fileChange",
    id: "item-diff-1",
    status: "completed",
    changes: [
      {
        path: "src/app/CodexWorkspace.tsx",
        kind: { type: "update", move_path: null },
        diff: "@@ -1,4 +1,88 @@\n-import App from './App'\n+export function CodexWorkspaceProvider() {\n+  // protocol-shaped UI state\n+}",
      },
      {
        path: "src/router.tsx",
        kind: { type: "add" },
        diff: "@@ -0,0 +1,42 @@\n+createRootRoute()\n+createRoute({ path: '/thread/$threadId' })",
      },
      {
        path: "src/index.css",
        kind: { type: "update", move_path: null },
        diff: "@@ -1,4 +1,120 @@\n+:root {\n+  --bg: #081018;\n+}",
      },
    ],
  },
  {
    type: "dynamicToolCall",
    id: "item-tool-1",
    tool: "fuzzyFileSearch",
    arguments: {
      query: "thread item renderer",
      cwd: WORKSPACE_CWD,
    },
    status: "completed",
    contentItems: [
      {
        type: "inputText",
        text: "Matched src/app/CodexWorkspace.tsx, src/app/mockData.ts, and src/router.tsx",
      },
    ],
    success: true,
    durationMs: 212,
  },
  {
    type: "mcpToolCall",
    id: "item-mcp-1",
    server: "filesystem",
    tool: "read_file",
    status: "completed",
    arguments: {
      path: "/home/allan/.codex/config.toml",
    },
    result: {
      content: [
        {
          type: "input_text",
          text: "model = 'gpt-5.4'\nmodel_reasoning_effort = 'xhigh'\npersonality = 'pragmatic'",
        },
      ],
      structuredContent: {
        model: "gpt-5.4",
        model_reasoning_effort: "xhigh",
        personality: "pragmatic",
      },
    },
    error: null,
    durationMs: 84,
  },
  {
    type: "webSearch",
    id: "item-search-1",
    query: "OpenAI Codex VS Code extension layout cues",
    action: {
      type: "search",
      query: "OpenAI Codex VS Code extension layout cues",
      queries: ["OpenAI Codex VS Code extension", "Codex app-server thread items"],
    },
  },
  {
    type: "imageView",
    id: "item-image-1",
    path: "/home/allan/ui.jpg",
  },
  {
    type: "collabAgentToolCall",
    id: "item-agentcall-1",
    tool: "spawnAgent",
    status: "completed",
    senderThreadId: "thread-ui-shell",
    receiverThreadIds: ["thread-agent-render"],
    prompt: "Draft the inspector rail structure and list the files it should own.",
    model: "gpt-5.4-mini",
    reasoningEffort: "medium",
    agentsStates: {
      "thread-agent-render": {
        status: "completed",
        message: "Inspector rail scaffolded and ready for integration.",
      },
    },
  },
  {
    type: "agentMessage",
    id: "item-agent-1",
    phase: "final_answer",
    text: [
      "The workspace is structured around real Codex concepts instead of generic chat UI.",
      "",
      "This pass locks in the shell, stream-safe item renderers, and the operating surfaces for approvals, subagents, skills, MCP, and settings.",
      "",
      "Next I’d tighten the live response cadence and the steer application flow so follow-up turns feel closer to the extension.",
    ].join("\n"),
  },
  {
    type: "contextCompaction",
    id: "item-compact-1",
  },
];

const threadUiShellTurnTwoItems: Array<ThreadItem> = [
  {
    type: "userMessage",
    id: "item-user-2",
    content: [
      textInput(
        "Keep the shell dense like the extension. Show model switching, approvals, live terminals, code review, and steer application without hiding them behind too many clicks.",
      ),
    ],
  },
  {
    type: "reasoning",
    id: "item-reason-2",
    summary: [
      "Expose operational state inline, not in modal flows.",
      "Stream the answer while terminals and approvals update beside it.",
    ],
    content: [
      "Dedicate the right rail to stateful operational panels and keep the center stack focused on the active turn.",
      "Treat steer as a first-class composer affordance instead of a buried setting.",
    ],
  },
  {
    type: "plan",
    id: "item-plan-2",
    text: "Finish the message stream animation, pin the inspector tabs, surface review and model reroute states, then polish mobile collapse behavior.",
  },
  {
    type: "commandExecution",
    id: "item-cmd-2",
    command: "npm run build",
    cwd: WORKSPACE_CWD,
    processId: "pty-22097",
    status: "inProgress",
    commandActions: [{ type: "unknown", command: "npm run build" }],
    aggregatedOutput: [
      "> codex-console@0.0.0 build",
      "> tsc -b && vite build",
      "",
      "vite v8.0.1 building for production...",
      "transforming modules...",
      "rendering chunks...",
    ].join("\n"),
    exitCode: null,
    durationMs: null,
  },
  {
    type: "mcpToolCall",
    id: "item-mcp-2",
    server: "github",
    tool: "issues.list",
    status: "completed",
    arguments: {
      owner: "openai",
      repo: "codex",
      label: "ui",
    },
    result: {
      content: [
        {
          issue_count: 6,
          open_threads: 2,
        },
      ],
      structuredContent: {
        issues: [
          { id: 412, title: "Stream delta cursor feels late on long answers" },
          { id: 408, title: "Inspector tabs should preserve selection per thread" },
        ],
      },
    },
    error: null,
    durationMs: 426,
  },
  {
    type: "collabAgentToolCall",
    id: "item-agentcall-2",
    tool: "wait",
    status: "inProgress",
    senderThreadId: "thread-ui-shell",
    receiverThreadIds: ["thread-agent-render"],
    prompt: "Wait for inspector polish checks.",
    model: "gpt-5.4-mini",
    reasoningEffort: "medium",
    agentsStates: {
      "thread-agent-render": {
        status: "running",
        message: "Verifying compact layout and keyboard affordances.",
      },
    },
  },
  {
    type: "imageGeneration",
    id: "item-imagegen-1",
    status: "completed",
    revisedPrompt: "Generate a muted dark control-room moodboard with VS Code density and sharper hierarchy.",
    result: "Moodboard ready in the design tray.",
  },
  {
    type: "agentMessage",
    id: "item-agent-2",
    phase: "commentary",
    text: [
      "The live shell is nearly there.",
      "",
      "I’m keeping the center column focused on the active turn while the inspector carries approvals, background terminals, subagent state, skill install flows, MCP auth, and settings mutations. The next step is smoothing the final stream so the response and steer application feel immediate instead of bolted on.",
    ].join("\n"),
  },
];

const threadReviewItems: Array<ThreadItem> = [
  {
    type: "userMessage",
    id: "item-review-user",
    content: [textInput("Review the latest UI shell changes and focus on bugs, regressions, and missing tests.")],
  },
  {
    type: "enteredReviewMode",
    id: "item-review-enter",
    review: "src/app/CodexWorkspace.tsx against previous workspace shell",
  },
  {
    type: "reasoning",
    id: "item-review-reason",
    summary: ["Prioritize correctness over polish.", "Check stream lifecycle and attachment handling."],
    content: [
      "Compare pending stream completion behavior with turn finalization.",
      "Look for image URL leaks, approval state drift, and lost panel selection on thread switches.",
    ],
  },
  {
    type: "commandExecution",
    id: "item-review-cmd",
    command: "npm run build",
    cwd: WORKSPACE_CWD,
    processId: "pty-21902",
    status: "completed",
    commandActions: [{ type: "unknown", command: "npm run build" }],
    aggregatedOutput: "tsc -b completed\nvite build completed",
    exitCode: 0,
    durationMs: 6032,
  },
  {
    type: "agentMessage",
    id: "item-review-agent",
    phase: "final_answer",
    text: [
      "Findings",
      "1. High: stream completion can leave the latest turn visually active if no terminal delta is attached.",
      "2. Medium: installed skill toggles do not currently annotate the next turn payload.",
      "3. Low: the inspector tab focus treatment relies mostly on color contrast.",
    ].join("\n"),
  },
  {
    type: "exitedReviewMode",
    id: "item-review-exit",
    review: "Review completed",
  },
];

const uiShellTurns: Array<Turn> = [
  {
    id: "turn-shell-1",
    items: threadUiShellTurnOneItems,
    status: "completed",
    error: null,
  },
  {
    id: "turn-shell-2",
    items: threadUiShellTurnTwoItems,
    status: "inProgress",
    error: null,
  },
];

const reviewTurns: Array<Turn> = [
  {
    id: "turn-review-1",
    items: threadReviewItems,
    status: "completed",
    error: null,
  },
];

const threads: Array<ThreadRecord> = [
  {
    thread: {
      id: "thread-ui-shell",
      preview: "Build a full Codex Console workspace in React + TanStack.",
      ephemeral: false,
      modelProvider: "openai",
      createdAt: now - 3600,
      updatedAt: now - 8,
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
      path: `${WORKSPACE_CWD}/.codex/sessions/thread-ui-shell.jsonl`,
      cwd: WORKSPACE_CWD,
      cliVersion: "0.115.0",
      source: "appServer",
      agentNickname: null,
      agentRole: null,
      gitInfo: {
        sha: "cc92fe7",
        branch: "feature/codex-web-shell",
        originUrl: "git@github.com:xaenic/codex-console.git",
      },
      name: "Codex Console workspace",
      turns: uiShellTurns,
    },
    plan: {
      explanation: "Mirror the extension’s density while keeping the web shell legible and touch-friendly.",
      steps: [
        { step: "Map thread item types into rich UI cards", status: "completed" },
        { step: "Wire live response streaming and cursor treatment", status: "inProgress" },
        { step: "Expose approvals, terminals, and reroutes in the inspector", status: "completed" },
        { step: "Polish mobile collapse behavior", status: "pending" },
      ],
    },
    steerSuggestions: [
      "Match the VS Code extension information density.",
      "Keep the answer terse and operational.",
      "Show subagent progress inline with the active turn.",
    ],
    approvals: [
      {
        id: "approval-install",
        kind: "command",
        title: "Approve dependency install",
        detail: "Allow npm to add TanStack and UI dependencies to the workspace.",
        risk: "medium",
        state: "pending",
        command: "npm install @tanstack/react-router @tanstack/react-query @tanstack/react-virtual lucide-react clsx",
      },
      {
        id: "approval-write",
        kind: "patch",
        title: "Approve file writes",
        detail: "Allow Codex to update the new web UI source tree.",
        risk: "medium",
        state: "pending",
        files: [
          `${WORKSPACE_CWD}/src/app/CodexWorkspace.tsx`,
          `${WORKSPACE_CWD}/src/router.tsx`,
          `${WORKSPACE_CWD}/src/index.css`,
        ],
      },
    ],
    terminals: [
      {
        id: "terminal-build",
        title: "Build watcher",
        command: "npm run build -- --watch",
        cwd: WORKSPACE_CWD,
        processId: "pty-22097",
        status: "running",
        background: true,
        lastEvent: "6 seconds ago",
        log: [
          "$ npm run build -- --watch",
          "vite v8.0.1 building for production...",
          "transforming modules...",
          "rendering chunks...",
          "watching for changes...",
        ],
      },
      {
        id: "terminal-app-server",
        title: "Codex app-server bridge",
        command: "codex app-server --listen ws://127.0.0.1:3900",
        cwd: WORKSPACE_CWD,
        processId: "pty-22014",
        status: "idle",
        background: true,
        lastEvent: "24 seconds ago",
        log: [
          "$ codex app-server --listen ws://127.0.0.1:3900",
          "Listening on ws://127.0.0.1:3900",
          "Client connected: codex-console-web",
        ],
      },
      {
        id: "terminal-lint",
        title: "Lint pass",
        command: "npm run lint",
        cwd: WORKSPACE_CWD,
        processId: "pty-21990",
        status: "idle",
        background: false,
        lastEvent: "2 minutes ago",
        log: ["$ npm run lint", "0 errors", "0 warnings"],
      },
    ],
    reroutes: [
      {
        id: "reroute-1",
        from: "gpt-5.4",
        to: "gpt-5.4-mini",
        reason: "Rate-limit nudge suppressed; assistant continued in mini for live drafting.",
        at: "1 minute ago",
      },
    ],
    review: [
      {
        id: "finding-1",
        severity: "high",
        title: "Streaming turn can stay visually active",
        file: `${WORKSPACE_CWD}/src/app/CodexWorkspace.tsx`,
        line: 742,
        summary: "Turn completion depends on stream finalization and can miss the no-terminal path.",
        status: "open",
      },
      {
        id: "finding-2",
        severity: "medium",
        title: "Generated turn ids can collide in rapid sends",
        file: `${WORKSPACE_CWD}/src/app/mockData.ts`,
        line: 564,
        summary: "Millisecond-based ids are fine for demos but not for concurrent thread fanout.",
        status: "open",
      },
      {
        id: "finding-3",
        severity: "low",
        title: "Inspector focus treatment is color-led",
        file: `${WORKSPACE_CWD}/src/index.css`,
        line: 618,
        summary: "Selected tab state should add a shape or weight change for clearer accessibility.",
        status: "open",
      },
    ],
    tokenUsage: {
      input: 14562,
      output: 6102,
      cached: 3098,
    },
  },
  {
    thread: {
      id: "thread-review",
      preview: "Review the Codex workspace shell for bugs and regressions.",
      ephemeral: false,
      modelProvider: "openai",
      createdAt: now - 9800,
      updatedAt: now - 420,
      status: { type: "idle" },
      path: `${WORKSPACE_CWD}/.codex/sessions/thread-review.jsonl`,
      cwd: WORKSPACE_CWD,
      cliVersion: "0.115.0",
      source: "cli",
      agentNickname: null,
      agentRole: null,
      gitInfo: {
        sha: "5ffb882",
        branch: "review/ui-shell",
        originUrl: "git@github.com:xaenic/codex-console.git",
      },
      name: "Review workspace shell",
      turns: reviewTurns,
    },
    plan: {
      explanation: "Scan the shell for correctness gaps before adding backend transport.",
      steps: [
        { step: "Inspect stream lifecycle", status: "completed" },
        { step: "Check attachment handling", status: "completed" },
        { step: "Summarize findings with file references", status: "completed" },
      ],
    },
    steerSuggestions: ["Keep findings first.", "Call out missing tests before polish issues."],
    approvals: [],
    terminals: [
      {
        id: "terminal-review-build",
        title: "Review build run",
        command: "npm run build",
        cwd: WORKSPACE_CWD,
        processId: "pty-21902",
        status: "idle",
        background: false,
        lastEvent: "7 minutes ago",
        log: ["$ npm run build", "tsc -b completed", "vite build completed"],
      },
    ],
    reroutes: [],
    review: [],
    tokenUsage: {
      input: 4822,
      output: 1118,
      cached: 901,
    },
  },
  {
    thread: {
      id: "thread-agent-render",
      preview: "Subagent assigned to inspector rail polish.",
      ephemeral: true,
      modelProvider: "openai",
      createdAt: now - 1300,
      updatedAt: now - 42,
      status: { type: "idle" },
      path: null,
      cwd: WORKSPACE_CWD,
      cliVersion: "0.115.0",
      source: {
        subAgent: {
          thread_spawn: {
            parent_thread_id: "thread-ui-shell",
            depth: 1,
            agent_nickname: "renderer-sync",
            agent_role: "Own the inspector rail layout and mobile collapse behavior.",
          },
        },
      },
      agentNickname: "renderer-sync",
      agentRole: "Inspector rail polish",
      gitInfo: null,
      name: "Subagent: renderer-sync",
      turns: [],
    },
    plan: null,
    steerSuggestions: [],
    approvals: [],
    terminals: [],
    reroutes: [],
    review: [],
    tokenUsage: {
      input: 1890,
      output: 402,
      cached: 120,
    },
  },
  {
    thread: {
      id: "thread-skill-install",
      preview: "Install marketplace-backed skills and sync them into the composer.",
      ephemeral: false,
      modelProvider: "openai",
      createdAt: now - 24200,
      updatedAt: now - 5100,
      status: { type: "idle" },
      path: `${WORKSPACE_CWD}/.codex/sessions/thread-skill-install.jsonl`,
      cwd: WORKSPACE_CWD,
      cliVersion: "0.115.0",
      source: "cli",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: "Install remote skills",
      turns: [],
    },
    plan: null,
    steerSuggestions: ["Pin installed skills above marketplace suggestions."],
    approvals: [],
    terminals: [],
    reroutes: [],
    review: [],
    tokenUsage: {
      input: 2181,
      output: 523,
      cached: 0,
    },
  },
  {
    thread: {
      id: "thread-mcp-setup",
      preview: "Wire MCP auth state, server reload, and tool catalog rendering.",
      ephemeral: false,
      modelProvider: "openai",
      createdAt: now - 40200,
      updatedAt: now - 8200,
      status: { type: "idle" },
      path: `${WORKSPACE_CWD}/.codex/sessions/thread-mcp-setup.jsonl`,
      cwd: WORKSPACE_CWD,
      cliVersion: "0.115.0",
      source: "cli",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: "MCP setup",
      turns: [],
    },
    plan: null,
    steerSuggestions: ["Surface auth state and tools on the same card."],
    approvals: [],
    terminals: [],
    reroutes: [],
    review: [],
    tokenUsage: {
      input: 1494,
      output: 301,
      cached: 0,
    },
  },
];

const threadUiShellCommandLive = threadUiShellTurnTwoItems.find(
  (item): item is Extract<ThreadItem, { type: "commandExecution" }> => item.id === "item-cmd-2" && item.type === "commandExecution",
);

const threadUiShellAgentLive = threadUiShellTurnTwoItems.find(
  (item): item is Extract<ThreadItem, { type: "agentMessage" }> => item.id === "item-agent-2" && item.type === "agentMessage",
);

const threadUiShellStreams: Array<StreamSpec> = [
  streamFor("thread-ui-shell", "turn-shell-2", "item-cmd-2", "aggregatedOutput", threadUiShellCommandLive?.aggregatedOutput ?? "", 16),
  streamFor("thread-ui-shell", "turn-shell-2", "item-agent-2", "text", threadUiShellAgentLive?.text ?? "", 9),
];

const initialDashboardData: DashboardData = {
  threads: [],
  models,
  collaborationModes,
  settings,
  installedSkills,
  remoteSkills,
  mcpServers,
  featureFlags,
  account,
  mentionCatalog,
  directoryCatalog: mentionCatalog,
  directoryCatalogRoot: WORKSPACE_CWD,
  lastSavedAt: "just now",
  streams: [],
  remoteSkillsError: null,
  transport: {
    mode: "mock",
    status: "offline",
    endpoint: "ws://127.0.0.1:3901",
    error: "Codex app-server is not connected.",
  },
};

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const dashboardQueryOptions = queryOptions({
  queryKey: ["codex-dashboard"],
  queryFn: async () => {
    await delay(180);
    return structuredClone(initialDashboardData);
  },
  staleTime: Number.POSITIVE_INFINITY,
});

export const createFallbackDashboardData = () => structuredClone(initialDashboardData);

export const createMockDemoDashboardData = () =>
  structuredClone({
    ...initialDashboardData,
    threads,
    streams: threadUiShellStreams,
    transport: {
      mode: "mock" as const,
      status: "offline" as const,
      endpoint: "ws://127.0.0.1:3901",
      error: "Demo data only.",
    },
  });

export const createBlankThreadRecord = (threadId: string, title: string, currentSettings: SettingsState): ThreadRecord => ({
  thread: {
    id: threadId,
    preview: title,
    ephemeral: false,
    modelProvider: "openai",
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
    status: { type: "idle" },
    path: null,
    cwd: WORKSPACE_CWD,
    cliVersion: "0.115.0",
    source: "appServer",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: title,
    turns: [],
  },
  plan: {
    explanation: `New ${currentSettings.collaborationMode} thread initialized for ${title}.`,
    steps: [
      { step: "Capture the goal", status: "completed" },
      { step: "Run the first turn", status: "pending" },
    ],
  },
  steerSuggestions: [
    "Keep the first answer brief and gather context fast.",
    "Prefer concrete file references over generic guidance.",
  ],
  approvals: [],
  terminals: [],
  reroutes: [],
  review: [],
  tokenUsage: {
    input: 0,
    output: 0,
    cached: 0,
  },
});

const sentenceFromPrompt = (prompt: string) => {
  const clean = prompt.trim().replace(/\s+/g, " ");
  if (clean.length <= 88) {
    return clean;
  }

  return `${clean.slice(0, 85)}...`;
};

const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const createSimulatedTurn = ({
  threadId,
  prompt,
  mode,
  settings: currentSettings,
  mentions,
  skills,
  images,
  steer,
}: CreateTurnArgs): CreateTurnResult => {
  const turnId = nextId("turn");
  const userMessageId = nextId("item-user");
  const reasoningId = nextId("item-reason");
  const planId = nextId("item-plan");
  const commandId = nextId("item-cmd");
  const agentId = nextId("item-agent");
  const reviewEnterId = nextId("item-review-enter");
  const reviewExitId = nextId("item-review-exit");
  const collabId = nextId("item-collab");
  const promptLine = sentenceFromPrompt(prompt || "Refine the active Codex thread.");

  const userContent: Array<ThreadItem> = [
    {
      type: "userMessage",
      id: userMessageId,
      content: [
        textInput(prompt || "Continue the active Codex task."),
        ...mentions.map(mentionInput),
        ...skills.map(skillInput),
        ...images.map((image) => imageInput(image.url)),
      ],
    },
  ];

  const reasoningItem: ThreadItem = {
    type: "reasoning",
    id: reasoningId,
    summary: [
      currentSettings.collaborationMode === "plan"
        ? "Stay explicit about the work plan and live state."
        : "Keep the response concise and directly actionable.",
      steer ? `Honor steer: ${steer}` : "No extra steer applied.",
    ],
    content: [
      `Drive the next turn around: ${promptLine}`,
      "Preserve the Codex surfaces for terminals, approvals, subagents, and config mutations.",
    ],
  };

  const plan: ThreadPlan = {
    explanation:
      mode === "review"
        ? "Run the review pass, classify findings, and keep the summary secondary."
        : "Execute the active turn while keeping the shell, inspector, and composer in sync.",
    steps:
      mode === "review"
        ? [
            { step: "Scan the changed surfaces", status: "completed" },
            { step: "Classify the top findings", status: "inProgress" },
            { step: "Draft the review summary", status: "pending" },
          ]
        : [
            { step: "Interpret the new request", status: "completed" },
            { step: "Update the active workspace surfaces", status: "inProgress" },
            { step: "Stream the final response", status: "pending" },
          ],
  };

  const planItem: ThreadItem = {
    type: "plan",
    id: planId,
    text: plan.explanation,
  };

  const commandText =
    mode === "review"
      ? "codex review --json"
      : currentSettings.webSearch
        ? "npm run build && codex --search"
        : "npm run build";

  const commandOutput =
    mode === "review"
      ? [
          "{",
          '  "summary": "3 findings, 1 high severity",',
          '  "focus": ["stream lifecycle", "composer attachments", "panel selection"]',
          "}",
        ].join("\n")
      : [
          "> tsc -b && vite build",
          "transforming modules...",
          "rendering chunks...",
          "inspector panels synchronized",
          "stream delta cursor stabilized",
        ].join("\n");

  const commandItem: ThreadItem = {
    type: "commandExecution",
    id: commandId,
    command: commandText,
    cwd: WORKSPACE_CWD,
    processId: nextId("pty"),
    status: "inProgress",
    commandActions: [{ type: "unknown", command: commandText }],
    aggregatedOutput: commandOutput,
    exitCode: null,
    durationMs: null,
  };

  const collabItem: ThreadItem | null =
    currentSettings.collaborationMode === "plan"
      ? (() => {
          const receiverThreadId = nextId("thread-agent");
          return {
          type: "collabAgentToolCall",
          id: collabId,
          tool: "spawnAgent",
          status: "inProgress",
          senderThreadId: threadId,
          receiverThreadIds: [receiverThreadId],
          prompt: "Check the inspector and terminal surfaces for any layout drift.",
          model: "gpt-5.4-mini",
          reasoningEffort: "medium",
          agentsStates: {
            [receiverThreadId]: {
              status: "running",
              message: "Reviewing compact layout and stream timing.",
            },
          },
        };
        })()
      : null;

  const agentText =
    mode === "review"
      ? [
          steer ? `Steer applied: ${steer}` : "Review mode active.",
          "",
          "Primary findings",
          `1. High: ${promptLine} introduces a stream lifecycle gap when the last turn has no terminal delta.`,
          "2. Medium: composer skill attachments are shown in the UI but not yet fed into the next simulated turn payload.",
          "3. Low: settings cards should persist section focus when you jump back into chat mode.",
        ].join("\n")
      : [
          steer ? `Steer applied: ${steer}` : "Turn accepted.",
          "",
          `I’m steering the next pass around: ${promptLine}`,
          "",
          "Active surfaces",
          "- chat stream remains live while the build terminal updates",
          "- approvals and subagent state stay visible in the inspector",
          "- model, effort, skills, MCP, and settings continue to mutate from the same shell",
          "",
          "If you want, the next iteration can replace the mock transport with a real Codex app-server websocket bridge.",
        ].join("\n");

  const agentItem: ThreadItem = {
    type: "agentMessage",
    id: agentId,
    phase: mode === "review" ? "final_answer" : "commentary",
    text: agentText,
  };

  const reviewFindingSeed = sentenceFromPrompt(prompt || "Review the current UI pass.");
  const review: Array<ReviewFinding> =
    mode === "review"
      ? [
          {
            id: nextId("finding"),
            severity: "high",
            title: "Turn completion depends on stream bookkeeping",
            file: `${WORKSPACE_CWD}/src/app/CodexWorkspace.tsx`,
            line: 782,
            summary: `The review request "${reviewFindingSeed}" exposed a path where the latest turn can remain active after the last delta renders.`,
            status: "open",
          },
          {
            id: nextId("finding"),
            severity: "medium",
            title: "Skill attachments are visible but not persisted",
            file: `${WORKSPACE_CWD}/src/app/CodexWorkspace.tsx`,
            line: 635,
            summary: "Installed skills are rendered as composer chips, but the simulated next turn does not yet use them as execution context.",
            status: "open",
          },
        ]
      : [];

  const items: Array<ThreadItem> = [
    ...userContent,
    ...(mode === "review"
      ? [
          {
            type: "enteredReviewMode",
            id: reviewEnterId,
            review: "Generated review turn",
          } satisfies ThreadItem,
        ]
      : []),
    reasoningItem,
    planItem,
    commandItem,
    ...(collabItem ? [collabItem] : []),
    agentItem,
    ...(mode === "review"
      ? [
          {
            type: "exitedReviewMode",
            id: reviewExitId,
            review: "Review turn completed",
          } satisfies ThreadItem,
        ]
      : []),
  ];

  const turn: Turn = {
    id: turnId,
    items,
    status: "inProgress",
    error: null,
  };

  const streams: Array<StreamSpec> = [
    streamFor(threadId, turnId, commandId, "aggregatedOutput", commandOutput, 18),
    streamFor(threadId, turnId, agentId, "text", agentText, 10),
  ];

  const terminals: Array<TerminalSession> =
    mode === "review"
      ? [
          {
            id: nextId("terminal-review"),
            title: "Review runner",
            command: commandText,
            cwd: WORKSPACE_CWD,
            processId: nextId("pty"),
            status: "running",
            background: false,
            lastEvent: "just now",
            log: ["$ codex review --json", "reviewing changed files...", "assembling findings..."],
          },
        ]
      : [
          {
            id: nextId("terminal-build"),
            title: "Turn build",
            command: commandText,
            cwd: WORKSPACE_CWD,
            processId: nextId("pty"),
            status: "running",
            background: true,
            lastEvent: "just now",
            log: ["$ npm run build", "transforming modules...", "updating live workspace shell..."],
          },
        ];

  return {
    turn,
    plan,
    streams,
    terminals,
    review,
  };
};
