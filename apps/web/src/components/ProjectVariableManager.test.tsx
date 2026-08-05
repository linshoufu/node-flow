import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectVariable } from "../types";
import { ProjectVariableManager } from "./ProjectVariableManager";

const variables: ProjectVariable[] = [
  {
    name: "base_url",
    value: "https://test.example.com",
    created_at: "2026-07-23T00:00:00Z",
    updated_at: "2026-07-23T00:00:00Z",
  },
];

describe("ProjectVariableManager", () => {
  it("creates a JSON project variable and validates the name", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectVariableManager
        variables={variables}
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("变量名称"), { target: { value: "retry_count" } });
    fireEvent.change(screen.getByLabelText("变量值 JSON"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存变量" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: "retry_count", value: 3 }));

    fireEvent.change(screen.getByLabelText("变量名称"), { target: { value: "bad-name" } });
    fireEvent.click(screen.getByRole("button", { name: "保存变量" }));
    expect(screen.getByRole("alert")).toHaveTextContent("变量名只能包含字母、数字和下划线");
  });
});
