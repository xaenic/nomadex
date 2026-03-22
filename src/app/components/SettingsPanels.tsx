import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import clsx from "clsx";

import type { DashboardData, SettingsState } from "../mockData";
import {
  approvalModeFromSettings,
  settingsPatchFromApprovalMode,
} from "../workspaceHelpers";
import type {
  ToastTone,
  UiThemeId,
  UiThemeOption,
  WorkspaceActions,
} from "../workspaceTypes";

const formatRateReset = (resetsAt: number | null) => {
  if (!resetsAt) {
    return "Reset time unavailable";
  }

  const resetDate = new Date(resetsAt * 1000);
  const now = Date.now();
  const diff = resetDate.getTime() - now;

  if (diff <= 1000 * 60 * 60 * 24) {
    return `Resets ${resetDate.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  return `Resets ${resetDate.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
};

const skillMatchesQuery = (
  skill: {
    name: string;
    description: string;
    tags?: string[];
    repo?: string;
    downloads?: string;
    scope?: string;
  },
  query: string,
) => {
  if (!query) {
    return true;
  }

  const haystack = [
    skill.name,
    skill.description,
    skill.scope ?? "",
    skill.repo ?? "",
    skill.downloads ?? "",
    ...(skill.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
};

export const SkillsLibraryModal = memo(function SkillsLibraryModal({
  snapshot,
  actions,
  onClose,
  pushToast,
}: {
  snapshot: DashboardData;
  actions: WorkspaceActions;
  onClose: () => void;
  pushToast: (message: string, tone: ToastTone) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const enabledCount = useMemo(
    () => snapshot.installedSkills.filter((skill) => skill.enabled).length,
    [snapshot.installedSkills],
  );
  const filteredInstalledSkills = useMemo(
    () =>
      snapshot.installedSkills.filter((skill) =>
        skillMatchesQuery(skill, normalizedQuery),
      ),
    [normalizedQuery, snapshot.installedSkills],
  );
  const filteredRemoteSkills = useMemo(
    () =>
      snapshot.remoteSkills.filter((skill) =>
        skillMatchesQuery(skill, normalizedQuery),
      ),
    [normalizedQuery, snapshot.remoteSkills],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="skills-library-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="skills-library-modal">
        <div className="skills-library-hero">
          <div className="skills-library-copy">
            <div className="skills-library-kicker">Nomadex Skill Library</div>
            <div className="skills-library-title">
              Manage installed and remote skills in one place
            </div>
            <div className="skills-library-subtitle">
              Toggle what stays active globally, browse marketplace packs, and
              keep the composer focused on actual prompts instead of setup.
            </div>
          </div>
          <button
            aria-label="Close skill library"
            className="skills-library-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="skills-library-toolbar">
          <div className="skills-library-stats">
            <div className="skills-library-stat">
              <strong>{snapshot.installedSkills.length}</strong>
              <span>Installed</span>
            </div>
            <div className="skills-library-stat">
              <strong>{enabledCount}</strong>
              <span>Enabled</span>
            </div>
            <div className="skills-library-stat">
              <strong>{snapshot.remoteSkills.length}</strong>
              <span>Marketplace</span>
            </div>
          </div>
          <input
            autoFocus
            className="skills-library-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills, tags, repo, or description…"
            value={query}
          />
        </div>

        <div className="skills-library-grid">
          <section className="skills-library-pane">
            <div className="skills-library-pane-head">
              <div>
                <div className="skills-library-pane-title">Installed</div>
                <div className="skills-library-pane-copy">
                  Toggle globally available skills and inspect their local path.
                </div>
              </div>
              <span className="skills-library-pane-count">
                {filteredInstalledSkills.length}
              </span>
            </div>

            <div className="skills-library-list">
              {filteredInstalledSkills.length === 0 ? (
                <div className="skills-library-empty">
                  No installed skills matched this search.
                </div>
              ) : (
                filteredInstalledSkills.map((skill) => (
                  <article
                    className={clsx(
                      "skills-library-card installed",
                      skill.enabled && "enabled",
                    )}
                    key={skill.id}
                  >
                    <div className="skills-library-card-head">
                      <div>
                        <div className="skills-library-card-title">
                          {skill.name}
                        </div>
                        <div className="skills-library-card-meta">
                          <span className="skills-library-chip">
                            {skill.scope}
                          </span>
                          <span
                            className={clsx(
                              "skills-library-chip",
                              skill.enabled && "live",
                            )}
                          >
                            {skill.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </div>
                      <button
                        className={clsx(
                          "skills-library-action",
                          skill.enabled && "active",
                        )}
                        onClick={() => void actions.toggleInstalledSkill(skill.id)}
                        type="button"
                      >
                        {skill.enabled ? "Disable" : "Enable"}
                      </button>
                    </div>
                    <div className="skills-library-card-description">
                      {skill.description}
                    </div>
                    {skill.tags.length > 0 ? (
                      <div className="skills-library-tag-row">
                        {skill.tags.map((tag) => (
                          <span className="skills-library-tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <code className="skills-library-path">{skill.path}</code>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="skills-library-pane marketplace">
            <div className="skills-library-pane-head">
              <div>
                <div className="skills-library-pane-title">Marketplace</div>
                <div className="skills-library-pane-copy">
                  Install remote skills into your local workspace catalog.
                </div>
              </div>
              <span className="skills-library-pane-count">
                {filteredRemoteSkills.length}
              </span>
            </div>

            <div className="skills-library-list">
              {filteredRemoteSkills.length === 0 ? (
                <div className="skills-library-empty">
                  No marketplace skills matched this search.
                </div>
              ) : (
                filteredRemoteSkills.map((skill) => (
                  <article
                    className="skills-library-card remote"
                    key={skill.id}
                  >
                    <div className="skills-library-card-head">
                      <div>
                        <div className="skills-library-card-title">
                          {skill.name}
                        </div>
                        <div className="skills-library-card-meta">
                          <span className="skills-library-chip">
                            {skill.downloads} downloads
                          </span>
                          <span className="skills-library-chip">
                            {skill.repo}
                          </span>
                        </div>
                      </div>
                      <button
                        className="skills-library-action install"
                        onClick={() => {
                          void actions.installSkill(skill.id);
                          pushToast(`Installing ${skill.name}`, "ok");
                        }}
                        type="button"
                      >
                        Install
                      </button>
                    </div>
                    <div className="skills-library-card-description">
                      {skill.description}
                    </div>
                    {skill.tags.length > 0 ? (
                      <div className="skills-library-tag-row">
                        {skill.tags.map((tag) => (
                          <span className="skills-library-tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
});

export const ThemePickerPanel = memo(function ThemePickerPanel({
  activeTheme,
  onClose,
  onSelect,
  themes,
}: {
  activeTheme: UiThemeId;
  onClose: () => void;
  onSelect: (themeId: UiThemeId) => void;
  themes: Array<UiThemeOption>;
}) {
  return (
    <div
      className="theme-picker-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div id="tpicker">
        <div className="tpicker-head">
          <div>
            <div className="tpicker-title">Theme</div>
            <div className="tpicker-subtitle">
              Shell palettes for Nomadex.
            </div>
          </div>
          <button
            className="tpicker-close"
            onClick={onClose}
            type="button"
            aria-label="Close theme picker"
          >
            ×
          </button>
        </div>
        <div className="tpicker-grid">
          {themes.map((theme) => (
            <button
              className={clsx("theme-card", activeTheme === theme.id && "active")}
              key={theme.id}
              onClick={() => onSelect(theme.id)}
              type="button"
            >
              <div className="theme-card-preview">
                <span className="theme-card-surface" style={{ background: theme.swatches[0] }} />
                <span className="theme-card-accent" style={{ background: theme.swatches[1] }} />
                <span className="theme-card-accent" style={{ background: theme.swatches[2] }} />
              </div>
              <div className="theme-card-copy">
                <div className="theme-card-name">
                  {theme.name}
                  <span className="theme-card-mode">{theme.mode}</span>
                </div>
                <div className="theme-card-description">{theme.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

export const ConfigPanel = memo(function ConfigPanel({
  snapshot,
  activeThreadLabel,
  actions,
  pushToast,
  selectModel,
  activeTheme,
  onOpenSkills,
  onOpenTheme,
}: {
  snapshot: DashboardData;
  activeThreadLabel: string;
  actions: WorkspaceActions;
  pushToast: (message: string, tone: ToastTone) => void;
  selectModel: (modelId: string) => Promise<void>;
  activeTheme: UiThemeId;
  onOpenSkills: () => void;
  onOpenTheme: () => void;
}) {
  const [mobileCallbackUrl, setMobileCallbackUrl] = useState("");
  const activeThemeLabel =
    activeTheme.charAt(0).toUpperCase() + activeTheme.slice(1);

  const handleChatGptLogin = useCallback(async () => {
    try {
      const authUrl = await actions.startChatGptLogin();
      if (authUrl) {
        window.open(authUrl, "_blank", "noopener,noreferrer");
      }
      pushToast(
        snapshot.account.loggedIn
          ? "Opened ChatGPT account switch"
          : "Opened ChatGPT sign-in",
        "ok",
      );
      pushToast(
        "If mobile redirects to localhost:1455, paste that callback URL below.",
        "",
      );
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Failed to start ChatGPT login",
        "err",
      );
    }
  }, [actions, pushToast, snapshot.account.loggedIn]);

  const handleCompleteMobileLogin = useCallback(async () => {
    if (!mobileCallbackUrl.trim()) {
      pushToast("Paste the full callback URL first", "warn");
      return;
    }

    try {
      await actions.completeChatGptLogin(mobileCallbackUrl.trim());
      setMobileCallbackUrl("");
      pushToast("Mobile sign-in completed", "ok");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Failed to complete mobile sign-in",
        "err",
      );
    }
  }, [actions, mobileCallbackUrl, pushToast]);

  const handleApiKeyLogin = useCallback(async () => {
    const apiKey = window.prompt(
      snapshot.account.authMode === "apiKey"
        ? "Enter the replacement API key"
        : "Enter your OpenAI API key",
      "",
    );

    if (!apiKey?.trim()) {
      return;
    }

    try {
      await actions.loginWithApiKey(apiKey.trim());
      pushToast("API key account connected", "ok");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Failed to connect API key",
        "err",
      );
    }
  }, [actions, pushToast, snapshot.account.authMode]);

  const handleLogout = useCallback(async () => {
    try {
      await actions.logoutAccount();
      pushToast("Signed out of account", "ok");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Failed to sign out",
        "err",
      );
    }
  }, [actions, pushToast]);

  const handleRefreshAccount = useCallback(async () => {
    try {
      await actions.refreshAccount();
      pushToast("Account status refreshed", "ok");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Failed to refresh account",
        "err",
      );
    }
  }, [actions, pushToast]);

  return (
    <div className="config-stack">
      <div className="sg">
        <div className="sg-t">Account</div>
        <div className="account-card">
          <div className="account-head">
            <div>
              <strong>
                {snapshot.account.loggedIn
                  ? snapshot.account.workspace
                  : "No active account"}
              </strong>
              <div className="account-copy">
                {snapshot.account.planType} · {snapshot.account.authMode}
              </div>
            </div>
            <span
              className={clsx(
                "account-badge",
                snapshot.account.loggedIn ? "ok" : "off",
              )}
            >
              {snapshot.account.loginInProgress
                ? "Signing in…"
                : snapshot.account.loggedIn
                  ? "Active"
                  : "Signed out"}
            </span>
          </div>
          <div className="account-meta">
            <span>{snapshot.account.credits}</span>
            {snapshot.account.requiresOpenaiAuth ? (
              <span>OpenAI auth required</span>
            ) : null}
          </div>
          <div className="usage-limit-list">
            {snapshot.account.usageWindows.map((windowEntry) => (
              <div className="usage-limit-card" key={windowEntry.id}>
                <div className="usage-limit-head">
                  <strong>{windowEntry.label}</strong>
                  <span>{Math.round(windowEntry.usedPercent)}% used</span>
                </div>
                <div className="usage-limit-bar">
                  <span
                    className="usage-limit-fill"
                    style={{
                      width: `${Math.max(0, Math.min(100, windowEntry.usedPercent))}%`,
                    }}
                  />
                </div>
                <div className="usage-limit-copy">
                  {formatRateReset(windowEntry.resetsAt)}
                </div>
              </div>
            ))}
            {snapshot.account.usageWindows.length === 0 ? (
              <div className="usage-limit-empty">
                Sign in to view your account usage windows.
              </div>
            ) : null}
          </div>
          <div className="account-actions">
            <button
              className="mini-action"
              type="button"
              onClick={() => void handleRefreshAccount()}
            >
              Refresh
            </button>
            <button
              className="mini-action"
              type="button"
              onClick={() => void handleChatGptLogin()}
            >
              {snapshot.account.authMode === "chatgpt"
                ? "Switch ChatGPT"
                : "Use ChatGPT"}
            </button>
            <button
              className="mini-action"
              type="button"
              onClick={() => void handleApiKeyLogin()}
            >
              {snapshot.account.authMode === "apiKey"
                ? "Replace API key"
                : "Use API key"}
            </button>
            {snapshot.account.loggedIn ? (
              <button
                className="mini-action danger"
                type="button"
                onClick={() => void handleLogout()}
              >
                Log out
              </button>
            ) : null}
          </div>
          {snapshot.account.loginInProgress ? (
            <div className="account-helper">
              <div className="account-helper-copy">
                On mobile, if ChatGPT returns to <code>localhost:1455</code>,
                copy that full URL and paste it here. You can also replace the
                failed callback host with{" "}
                <code>
                  {typeof window !== "undefined" ? window.location.origin : ""}
                </code>{" "}
                and keep the same path/query.
              </div>
              <div className="account-callback-form">
                <input
                  className="account-callback-input"
                  placeholder="http://localhost:1455/auth/callback?code=…&state=…"
                  value={mobileCallbackUrl}
                  onChange={(event) => setMobileCallbackUrl(event.target.value)}
                />
                <button
                  className="mini-action"
                  type="button"
                  onClick={() => void handleCompleteMobileLogin()}
                >
                  Finish mobile login
                </button>
              </div>
            </div>
          ) : null}
          {snapshot.account.loginError ? (
            <div className="account-error">{snapshot.account.loginError}</div>
          ) : null}
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">Model</div>
        <div className="sr">
          <span className="sl">model</span>
          <select
            className="ssel"
            value={snapshot.settings.model}
            onChange={(event) => void selectModel(event.target.value)}
          >
            {snapshot.models.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="sr">
          <span className="sl">reasoning_effort</span>
          <select
            className="ssel"
            value={snapshot.settings.reasoningEffort}
            onChange={(event) =>
              void actions.updateSettings({
                reasoningEffort: event.target.value as SettingsState["reasoningEffort"],
              })
            }
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="xhigh">xhigh</option>
          </select>
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">Approval &amp; Sandbox</div>
        <div className="sr">
          <span className="sl">approval_policy</span>
          <select
            className="ssel"
            value={approvalModeFromSettings(snapshot.settings)}
            onChange={(event) =>
              void actions.updateSettings(
                settingsPatchFromApprovalMode(
                  event.target.value as ReturnType<typeof approvalModeFromSettings>,
                ),
              )
            }
          >
            <option value="auto">auto</option>
            <option value="ro">read-only</option>
            <option value="fa">full-access</option>
          </select>
        </div>
        <div className="sr">
          <span className="sl">sandbox</span>
          <select
            className="ssel"
            value={snapshot.settings.sandboxMode}
            onChange={(event) =>
              void actions.updateSettings({
                sandboxMode: event.target.value as SettingsState["sandboxMode"],
              })
            }
          >
            <option value="workspace-write">workspace-write</option>
            <option value="read-only">read-only</option>
            <option value="danger-full-access">danger-full-access</option>
          </select>
        </div>
        <div className="sr">
          <span className="sl">web_search</span>
          <div
            className={clsx("tog", snapshot.settings.webSearch && "on")}
            onClick={() =>
              void actions.updateSettings({
                webSearch: !snapshot.settings.webSearch,
              })
            }
            role="button"
            tabIndex={0}
            onKeyDown={() => undefined}
          />
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">Appearance</div>
        <div className="config-shortcut-card appearance-shortcut-card">
          <div className="config-shortcut-copy">
            <strong>{activeThemeLabel} theme active</strong>
            <span>
              Ambient background, shell surfaces, and persistent palette
              selection.
            </span>
          </div>
          <button className="mini-action" onClick={onOpenTheme} type="button">
            Open Theme Picker
          </button>
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">Skills</div>
        <div className="config-shortcut-card skill-shortcut-card">
          <div className="config-shortcut-copy">
            <strong>Skills moved into a dedicated library</strong>
            <span>
              {snapshot.installedSkills.length} installed ·{" "}
              {snapshot.installedSkills.filter((skill) => skill.enabled).length}{" "}
              enabled · {snapshot.remoteSkills.length} available to install
            </span>
          </div>
          <button className="mini-action" onClick={onOpenSkills} type="button">
            Open Skills Library
          </button>
        </div>
      </div>

      <div className="sg">
        <div className="sg-t">MCP</div>
        {snapshot.mcpServers.map((server) => (
          <div className="mcp-card" key={server.name}>
            <div className="mcp-head">
              <strong>{server.name}</strong>
              <span>{server.authStatus}</span>
            </div>
            <div className="mcp-tools">
              {Object.keys(server.tools).slice(0, 4).join(" · ")}
            </div>
            <button
              className="mini-action"
              type="button"
              onClick={() => void actions.toggleMcpAuth(server.name)}
            >
              {server.authStatus === "notLoggedIn" ? "Connect" : "Refresh"}
            </button>
          </div>
        ))}
      </div>

      <div className="sg">
        <div className="sg-t">
          Feature Flags{" "}
          <button
            className="feature-refresh"
            type="button"
            onClick={() => pushToast("Feature flags refreshed", "ok")}
          >
            ⟳
          </button>
        </div>
        {snapshot.featureFlags.map((flag) => (
          <div className="sr" key={flag.name}>
            <span className="sl">
              {flag.name} <small>({flag.stage})</small>
            </span>
            <div
              className={clsx("tog", flag.enabled && "on")}
              onClick={() => void actions.toggleFeatureFlag(flag.name)}
              role="button"
              tabIndex={0}
              onKeyDown={() => undefined}
            />
          </div>
        ))}
      </div>

      <div className="config-preview">
        <div className="config-title">Session config snapshot</div>
        <div># Nomadex workspace config</div>
        <div>model = "{snapshot.settings.model}"</div>
        <div>approval_policy = "{snapshot.settings.approvalPolicy}"</div>
        <div>model_reasoning_effort = "{snapshot.settings.reasoningEffort}"</div>
        <div>web_search = "{snapshot.settings.webSearch ? "live" : "disabled"}"</div>
        <br />
        <div>[features]</div>
        {snapshot.featureFlags.slice(0, 4).map((flag) => (
          <div key={flag.name}>
            {flag.name} = {flag.enabled ? "true" : "false"}
          </div>
        ))}
        <br />
        <div># active thread</div>
        <div>thread = "{activeThreadLabel}"</div>
      </div>
    </div>
  );
});
