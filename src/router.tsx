import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { BlankWorkspacePage, CodexWorkspaceProvider } from "./app/CodexWorkspace";

const rootRoute = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <CodexWorkspaceProvider>
      <Outlet />
    </CodexWorkspaceProvider>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: BlankWorkspacePage,
});

const threadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/threads",
  component: BlankWorkspacePage,
});

const legacyThreadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/thread/$threadId",
  component: BlankWorkspacePage,
});

const threadIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/threads/$threadId",
  component: BlankWorkspacePage,
});

const threadSectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/threads/$threadId/$section",
  component: BlankWorkspacePage,
});

const routeTree = rootRoute.addChildren([indexRoute, threadsRoute, legacyThreadRoute, threadIndexRoute, threadSectionRoute]);

export const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
