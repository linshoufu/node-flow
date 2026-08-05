import { describe, expect, it } from "vitest";
import type { NodeType, NodeUpgradeSummary } from "../types";
import { formatNodeUpgradeDetails, formatNodeUpgradeSummary } from "./nodeVersionUpgrades";


const nodeTypes: NodeType[] = [
  {
    id: "http.request",
    name: "HTTP Request",
    displayName: "HTTP 请求",
    category: "Network",
    description: "Request",
    inputs: {},
    outputs: {},
    configSchema: {},
  },
];

describe("node version upgrades", () => {
  it("formats a concise Chinese summary using the display node name", () => {
    const upgrades: NodeUpgradeSummary[] = [
      {
        nodeId: "request",
        path: "nodes.request",
        nodeType: "http.request",
        fromVersion: 1,
        toVersion: 2,
      },
    ];

    expect(formatNodeUpgradeSummary(upgrades, nodeTypes)).toEqual(["HTTP 请求：v1 升级到 v2"]);
  });

  it("formats added, changed, and removed config values for confirmation", () => {
    const upgrade = {
      nodeId: "request",
      path: "nodes.request",
      nodeType: "http.request",
      fromVersion: 1,
      toVersion: 2,
      configChanges: [
        { path: "config.endpoint", kind: "added", before: null, after: "https://api.example.test" },
        { path: "config.retry", kind: "changed", before: 1, after: 3 },
        { path: "config.legacy", kind: "removed", before: { token: "old" }, after: null },
      ],
      migrationNotes: ["v1 到 v2：新增 config.endpoint；修改 config.retry；删除 config.legacy"],
    } as NodeUpgradeSummary;

    expect(formatNodeUpgradeDetails(upgrade)).toEqual({
      changes: [
        "新增 config.endpoint：https://api.example.test",
        "修改 config.retry：1 -> 3",
        '删除 config.legacy：{"token":"old"}',
      ],
      migrationNotes: ["v1 到 v2：新增 config.endpoint；修改 config.retry；删除 config.legacy"],
    });
  });
});
