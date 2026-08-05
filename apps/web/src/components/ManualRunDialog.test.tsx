import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualRunDialog } from "./ManualRunDialog";

describe("ManualRunDialog", () => {
  afterEach(() => cleanup());

  it("submits parsed JSON as one-time run input", () => {
    const onRun = vi.fn();
    render(<ManualRunDialog open onClose={vi.fn()} onRun={onRun} />);

    fireEvent.change(screen.getByLabelText("运行输入 JSON"), { target: { value: '{"case_id":17}' } });
    fireEvent.click(screen.getByRole("button", { name: "带输入运行" }));

    expect(onRun).toHaveBeenCalledWith({ case_id: 17 }, "default");
  });

  it("allows one-time execution to select a different environment", () => {
    const onRun = vi.fn();
    render(
      <ManualRunDialog
        defaultEnvironmentId="default"
        environments={[
          { id: "default", name: "默认环境", variables: {}, is_default: true, created_at: "", updated_at: "" },
          { id: "env_staging", name: "测试环境", variables: {}, is_default: false, created_at: "", updated_at: "" },
        ]}
        open
        onClose={vi.fn()}
        onRun={onRun}
      />
    );

    fireEvent.change(screen.getByLabelText("本次运行环境"), { target: { value: "env_staging" } });
    fireEvent.click(screen.getByRole("button", { name: "带输入运行" }));

    expect(onRun).toHaveBeenCalledWith({}, "env_staging");
  });

  it("keeps the dialog open and explains invalid JSON", () => {
    const onRun = vi.fn();
    render(<ManualRunDialog open onClose={vi.fn()} onRun={onRun} />);

    fireEvent.change(screen.getByLabelText("运行输入 JSON"), { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "带输入运行" }));

    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("运行输入不是有效的 JSON。");
  });
});
