import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CredentialSummary } from "../types";
import { EnvironmentManager } from "./EnvironmentManager";

const credentials: CredentialSummary[] = [
  {
    id: "cred_default",
    type_id: "http.bearer",
    name: "默认令牌",
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z",
  },
  {
    id: "cred_staging",
    type_id: "http.bearer",
    name: "测试令牌",
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z",
  },
  {
    id: "cred_header",
    type_id: "http.header",
    name: "请求头凭据",
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z",
  },
];

describe("EnvironmentManager", () => {
  it("creates an environment with a same-type credential mapping", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <EnvironmentManager
        credentials={credentials}
        environments={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("环境名称"), { target: { value: "测试环境" } });
    fireEvent.change(screen.getByLabelText("工作流凭据"), { target: { value: "cred_default" } });

    const targetSelect = screen.getByLabelText("环境实际凭据");
    expect(within(targetSelect).getByRole("option", { name: "测试令牌" })).toBeInTheDocument();
    expect(within(targetSelect).queryByRole("option", { name: "请求头凭据" })).not.toBeInTheDocument();

    fireEvent.change(targetSelect, { target: { value: "cred_staging" } });
    fireEvent.click(screen.getByRole("button", { name: "添加映射" }));
    const mappings = within(screen.getByLabelText("环境凭据映射"));
    expect(mappings.getByText("默认令牌")).toBeInTheDocument();
    expect(mappings.getByText("测试令牌")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存环境" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: "测试环境",
        variables: {},
        credential_overrides: { cred_default: "cred_staging" },
      })
    );
  });
});
