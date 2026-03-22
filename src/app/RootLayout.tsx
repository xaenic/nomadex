import { Outlet } from "@tanstack/react-router";

import { WorkspaceProvider } from "./WorkspaceShell";

export function RootLayout() {
  return (
    <WorkspaceProvider>
      <Outlet />
    </WorkspaceProvider>
  );
}
