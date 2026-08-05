import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CredentialSummary, CredentialType } from "../types";
import { CredentialManager } from "./CredentialManager";

const credentialTypes: CredentialType[] = [
  {
    id: "http.bearer",
    display_name: "HTTP Bearer 令牌",
    node_type_ids: ["http.request"],
    fields: [{ id: "token", label: "令牌", secret: true }],
  },
];

const credentials: CredentialSummary[] = [
  {
    id: "cred_token",
    type_id: "http.bearer",
    name: "测试环境令牌",
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
  },
];

describe("CredentialManager", () => {
  it("creates a typed local credential and clears its secret input after saving", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <CredentialManager
        credentialTypes={credentialTypes}
        credentials={credentials}
        onClose={vi.fn()}
        onCreate={onCreate}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText("测试环境令牌")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("凭据名称"), { target: { value: "预发令牌" } });
    fireEvent.change(screen.getByLabelText("令牌"), { target: { value: "very-secret-token" } });
    fireEvent.click(screen.getByRole("button", { name: "保存凭据" }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        type_id: "http.bearer",
        name: "预发令牌",
        data: { token: "very-secret-token" },
      })
    );
    expect(screen.getByLabelText("令牌")).toHaveValue("");
  });
});
