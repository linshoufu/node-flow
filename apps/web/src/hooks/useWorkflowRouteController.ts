import { useCallback, useEffect, useRef } from "react";
import {
  parseWorkflowRoute,
  workflowRoutePath,
  type WorkflowRoute,
} from "../lib/workflowRoute";

export type WorkflowRouteRequestSource = "initial" | "popstate";

type UseWorkflowRouteControllerOptions = {
  onRouteRequested: (
    route: WorkflowRoute,
    source: WorkflowRouteRequestSource,
  ) => Promise<WorkflowRoute | null> | WorkflowRoute | null;
};

type NavigateWorkflowRouteOptions = {
  replace?: boolean;
};

export function useWorkflowRouteController({
  onRouteRequested,
}: UseWorkflowRouteControllerOptions) {
  const requestRef = useRef(onRouteRequested);
  const acceptedRouteRef = useRef<WorkflowRoute>({ kind: "new" });
  const requestSequenceRef = useRef(0);
  requestRef.current = onRouteRequested;

  const writeRoute = useCallback((route: WorkflowRoute, { replace = false }: NavigateWorkflowRouteOptions = {}) => {
    requestSequenceRef.current += 1;
    acceptedRouteRef.current = route;
    const path = workflowRoutePath(route);
    if (window.location.pathname === path) {
      return;
    }
    if (replace) {
      window.history.replaceState(null, "", path);
    } else {
      window.history.pushState(null, "", path);
    }
  }, []);

  useEffect(() => {
    let active = true;

    function applyRouteResult(
      acceptedRoute: WorkflowRoute | null,
      previousRoute: WorkflowRoute,
      requestId: number,
    ) {
      if (!active || requestSequenceRef.current !== requestId) {
        return;
      }
      if (!acceptedRoute) {
        window.history.replaceState(null, "", workflowRoutePath(previousRoute));
        return;
      }

      acceptedRouteRef.current = acceptedRoute;
      const acceptedPath = workflowRoutePath(acceptedRoute);
      if (window.location.pathname !== acceptedPath) {
        window.history.replaceState(null, "", acceptedPath);
      }
    }

    async function requestCurrentRoute(source: WorkflowRouteRequestSource) {
      const requestedRoute = parseWorkflowRoute(window.location.pathname);
      const previousRoute = acceptedRouteRef.current;
      const requestId = ++requestSequenceRef.current;
      const acceptedRoute = await requestRef.current(requestedRoute, source);
      applyRouteResult(acceptedRoute, previousRoute, requestId);
    }

    function handlePopState() {
      void requestCurrentRoute("popstate");
    }

    queueMicrotask(() => {
      if (active) {
        void requestCurrentRoute("initial");
      }
    });
    window.addEventListener("popstate", handlePopState);
    return () => {
      active = false;
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return {
    navigate: writeRoute,
  };
}
