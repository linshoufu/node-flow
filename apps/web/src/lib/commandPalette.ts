export type CommandPaletteEntry = {
  id: string;
  label: string;
  group: string;
  keywords?: string[];
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
};

export type CommandPaletteIcon =
  | "cancel"
  | "credentials"
  | "environments"
  | "fit"
  | "new"
  | "packages"
  | "redo"
  | "refresh"
  | "run"
  | "save"
  | "settings"
  | "undo"
  | "validate"
  | "variables";

export type CommandPaletteCommand = CommandPaletteEntry & {
  icon: CommandPaletteIcon;
  onSelect: () => void;
};

export type CommandPaletteGroup<T extends CommandPaletteEntry = CommandPaletteEntry> = {
  label: string;
  commands: T[];
};

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function commandSearchScore(command: CommandPaletteEntry, query: string): number | null {
  if (!query) {
    return 0;
  }

  const label = normalizeSearchText(command.label);
  const group = normalizeSearchText(command.group);
  const keywords = normalizeSearchText(command.keywords?.join(" ") ?? "");
  const terms = query.split(" ").filter(Boolean);
  const searchableText = `${label} ${group} ${keywords}`;

  if (!terms.every((term) => searchableText.includes(term))) {
    return null;
  }
  if (label === query) {
    return 0;
  }
  if (label.startsWith(query)) {
    return 1;
  }
  if (label.includes(query)) {
    return 2;
  }
  if (keywords.includes(query)) {
    return 3;
  }
  if (group.includes(query)) {
    return 4;
  }
  return 5;
}

export function searchCommandPalette<T extends CommandPaletteEntry>(
  commands: T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeSearchText(query);
  return commands
    .map((command, index) => ({
      command,
      index,
      score: commandSearchScore(command, normalizedQuery),
    }))
    .filter((item): item is typeof item & { score: number } => item.score !== null)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ command }) => command);
}

export function groupCommandPalette<T extends CommandPaletteEntry>(commands: T[]): CommandPaletteGroup<T>[] {
  const groups = new Map<string, T[]>();
  commands.forEach((command) => {
    const group = groups.get(command.group) ?? [];
    group.push(command);
    groups.set(command.group, group);
  });
  return [...groups].map(([label, groupedCommands]) => ({ label, commands: groupedCommands }));
}
