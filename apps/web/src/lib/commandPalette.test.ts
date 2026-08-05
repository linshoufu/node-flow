import { describe, expect, it } from "vitest";
import { groupCommandPalette, searchCommandPalette, type CommandPaletteEntry } from "./commandPalette";

const commands: CommandPaletteEntry[] = [
  { id: "new", group: "工作流", label: "新建工作流", keywords: ["create", "新增"] },
  { id: "save", group: "工作流", label: "保存工作流", keywords: ["save"] },
  { id: "fit", group: "画布", label: "适应画布", keywords: ["fit", "居中"] },
  { id: "credentials", group: "资源", label: "打开凭据", keywords: ["credentials", "密钥"] },
];

describe("commandPalette", () => {
  it("searches labels, groups and aliases while preserving useful ranking", () => {
    expect(searchCommandPalette(commands, "工作流").map(({ id }) => id)).toEqual(["new", "save"]);
    expect(searchCommandPalette(commands, "save").map(({ id }) => id)).toEqual(["save"]);
    expect(searchCommandPalette(commands, "画布 居中").map(({ id }) => id)).toEqual(["fit"]);
    expect(searchCommandPalette(commands, "打开").map(({ id }) => id)).toEqual(["credentials"]);
  });

  it("returns all commands for an empty query and groups them by first appearance", () => {
    const result = searchCommandPalette(commands, "  ");
    expect(result).toEqual(commands);
    expect(groupCommandPalette(result)).toEqual([
      { label: "工作流", commands: commands.slice(0, 2) },
      { label: "画布", commands: [commands[2]] },
      { label: "资源", commands: [commands[3]] },
    ]);
  });
});
