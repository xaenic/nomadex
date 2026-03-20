import { Outlet } from "@tanstack/react-router";

import { CodexWorkspaceProvider } from "./CodexWorkspace";

export function RootLayout() {
  return (
    <CodexWorkspaceProvider>
      <Outlet />
    </CodexWorkspaceProvider>
  );
}
