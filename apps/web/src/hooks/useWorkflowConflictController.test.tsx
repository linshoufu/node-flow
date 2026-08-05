import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkflowConflictController } from "./useWorkflowConflictController";

function versionConflict(expectedVersion = 3, currentVersion = 4) {
  return new Error(
    `API 409: ${JSON.stringify({
      detail: {
        code: "workflow_version_conflict",
        current_version: currentVersion,
        expected_version: expectedVersion,
        message: "版本冲突",
      },
    })}`,
  );
}

describe("useWorkflowConflictController", () => {
  it("忽略普通错误", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWorkflowConflictController({
      documentId: "workflow-1",
      onMessage,
    }));

    let handled = true;
    act(() => {
      handled = result.current.openWorkflowConflict("save", new Error("offline"));
    });

    expect(handled).toBe(false);
    expect(result.current.conflict).toBeNull();
    expect(result.current.isOpen).toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("解析版本并打开冲突弹窗", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWorkflowConflictController({
      documentId: "workflow-1",
      onMessage,
    }));

    let handled = false;
    act(() => {
      handled = result.current.openWorkflowConflict("rollback", versionConflict());
    });

    expect(handled).toBe(true);
    expect(result.current.conflict).toEqual({
      action: "rollback",
      currentVersion: 4,
      expectedVersion: 3,
    });
    expect(result.current.isOpen).toBe(true);
    expect(onMessage).toHaveBeenCalledWith("检测到工作流版本冲突，当前页面修改仍然保留。");
  });

  it("关闭弹窗后保留冲突，并允许再次打开", () => {
    const { result } = renderHook(() => useWorkflowConflictController({
      documentId: "workflow-1",
      onMessage: vi.fn(),
    }));
    act(() => result.current.openWorkflowConflict("save", versionConflict()));

    act(() => result.current.closeWorkflowConflict());
    expect(result.current.conflict).not.toBeNull();
    expect(result.current.isOpen).toBe(false);

    act(() => result.current.reopenWorkflowConflict());
    expect(result.current.isOpen).toBe(true);
  });

  it("清除冲突时同步关闭弹窗", () => {
    const { result } = renderHook(() => useWorkflowConflictController({
      documentId: "workflow-1",
      onMessage: vi.fn(),
    }));
    act(() => result.current.openWorkflowConflict("save", versionConflict()));

    act(() => result.current.clearWorkflowConflict());

    expect(result.current.conflict).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it("切换工作流时丢弃旧冲突", () => {
    const { result, rerender } = renderHook(
      ({ documentId }) => useWorkflowConflictController({ documentId, onMessage: vi.fn() }),
      { initialProps: { documentId: "workflow-1" } },
    );
    act(() => result.current.openWorkflowConflict("save", versionConflict()));

    rerender({ documentId: "workflow-2" });

    expect(result.current.conflict).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });
});
