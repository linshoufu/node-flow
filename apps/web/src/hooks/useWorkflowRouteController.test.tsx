import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkflowRouteController } from "./useWorkflowRouteController";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("useWorkflowRouteController", () => {
  it("requests the initial route once under StrictMode and canonicalizes it", async () => {
    window.history.replaceState(null, "", "/");
    const onRouteRequested = vi.fn().mockResolvedValue({ kind: "new" });
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;

    renderHook(() => useWorkflowRouteController({ onRouteRequested }), { wrapper });

    await waitFor(() => expect(window.location.pathname).toBe("/workflow/new"));
    expect(onRouteRequested).toHaveBeenCalledTimes(1);
    expect(onRouteRequested).toHaveBeenCalledWith({ kind: "new" }, "initial");
  });

  it("pushes workflow routes and replaces node selection routes", () => {
    const { result } = renderHook(() => useWorkflowRouteController({
      onRouteRequested: vi.fn().mockResolvedValue({ kind: "new" }),
    }));

    act(() => result.current.navigate({ kind: "workflow", workflowId: "wf-1" }));
    expect(window.location.pathname).toBe("/workflow/wf-1");

    act(() => result.current.navigate(
      { kind: "workflow", workflowId: "wf-1", nodeId: "node 1" },
      { replace: true },
    ));
    expect(window.location.pathname).toBe("/workflow/wf-1/node%201");
  });

  it("accepts browser navigation and restores the previous route when rejected", async () => {
    window.history.replaceState(null, "", "/workflow/wf-1");
    const onRouteRequested = vi.fn()
      .mockResolvedValueOnce({ kind: "workflow", workflowId: "wf-1" })
      .mockResolvedValueOnce(null);
    renderHook(() => useWorkflowRouteController({ onRouteRequested }));
    await waitFor(() => expect(onRouteRequested).toHaveBeenCalledTimes(1));

    window.history.pushState(null, "", "/workflow/wf-2");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));

    await waitFor(() => expect(onRouteRequested).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(window.location.pathname).toBe("/workflow/wf-1"));
    expect(onRouteRequested).toHaveBeenLastCalledWith(
      { kind: "workflow", workflowId: "wf-2" },
      "popstate",
    );
  });

  it("ignores an older browser navigation response", async () => {
    const first = deferred<{ kind: "workflow"; workflowId: string }>();
    const second = deferred<{ kind: "workflow"; workflowId: string }>();
    const onRouteRequested = vi.fn((route: { kind: string; workflowId?: string }) => {
      if (route.workflowId === "wf-slow") {
        return first.promise;
      }
      if (route.workflowId === "wf-fast") {
        return second.promise;
      }
      return Promise.resolve({ kind: "new" } as const);
    });
    renderHook(() => useWorkflowRouteController({ onRouteRequested }));
    await waitFor(() => expect(window.location.pathname).toBe("/workflow/new"));

    window.history.pushState(null, "", "/workflow/wf-slow");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    window.history.pushState(null, "", "/workflow/wf-fast");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));

    second.resolve({ kind: "workflow", workflowId: "wf-fast" });
    await waitFor(() => expect(window.location.pathname).toBe("/workflow/wf-fast"));
    first.resolve({ kind: "workflow", workflowId: "wf-slow" });
    await act(async () => first.promise);
    expect(window.location.pathname).toBe("/workflow/wf-fast");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
