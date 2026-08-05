import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  FilePlus2,
  KeyRound,
  Maximize2,
  PackageOpen,
  Play,
  Redo2,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Undo2,
  Variable,
  type LucideIcon,
} from "lucide-react";
import {
  groupCommandPalette,
  searchCommandPalette,
  type CommandPaletteCommand,
  type CommandPaletteIcon,
} from "../lib/commandPalette";
import { DialogBackdrop } from "./DialogBackdrop";

export type { CommandPaletteCommand, CommandPaletteIcon } from "../lib/commandPalette";

type CommandPaletteProps = {
  commands: CommandPaletteCommand[];
  onClose: () => void;
};

const commandIcons: Record<CommandPaletteIcon, LucideIcon> = {
  cancel: Square,
  credentials: KeyRound,
  environments: Boxes,
  fit: Maximize2,
  new: FilePlus2,
  packages: PackageOpen,
  redo: Redo2,
  refresh: RefreshCw,
  run: Play,
  save: Save,
  settings: Settings2,
  undo: Undo2,
  validate: ShieldCheck,
  variables: Variable,
};

function nextEnabledIndex(commands: CommandPaletteCommand[], currentIndex: number, direction: 1 | -1): number {
  if (commands.length === 0 || commands.every((command) => command.disabled)) {
    return -1;
  }
  for (let offset = 1; offset <= commands.length; offset += 1) {
    const index = (currentIndex + direction * offset + commands.length) % commands.length;
    if (!commands[index].disabled) {
      return index;
    }
  }
  return -1;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const filteredCommands = useMemo(() => searchCommandPalette(commands, query), [commands, query]);
  const groups = useMemo(() => groupCommandPalette(filteredCommands), [filteredCommands]);
  const [selectedIndex, setSelectedIndex] = useState(() => nextEnabledIndex(filteredCommands, -1, 1));

  useEffect(() => {
    setSelectedIndex(nextEnabledIndex(filteredCommands, -1, 1));
  }, [filteredCommands]);

  useEffect(() => {
    if (selectedIndex < 0) {
      return;
    }
    document
      .getElementById(`command-palette-option-${filteredCommands[selectedIndex]?.id}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [filteredCommands, selectedIndex]);

  function runCommand(command: CommandPaletteCommand) {
    if (command.disabled) {
      return;
    }
    onClose();
    command.onSelect();
  }

  return (
    <DialogBackdrop onClose={onClose}>
      <section aria-label="命令面板" aria-modal="true" className="command-palette" role="dialog">
        <div className="command-palette-search">
          <Search aria-hidden="true" size={18} strokeWidth={2} />
          <input
            aria-controls="command-palette-list"
            aria-label="搜索命令"
            aria-autocomplete="list"
            aria-activedescendant={selectedIndex >= 0 ? `command-palette-option-${filteredCommands[selectedIndex]?.id}` : undefined}
            aria-expanded="true"
            autoComplete="off"
            autoFocus
            placeholder="搜索工作流、画布或资源操作"
            role="combobox"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((current) =>
                  nextEnabledIndex(filteredCommands, current, event.key === "ArrowDown" ? 1 : -1),
                );
              } else if (event.key === "Enter" && selectedIndex >= 0) {
                event.preventDefault();
                runCommand(filteredCommands[selectedIndex]);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-palette-results" id="command-palette-list" role="listbox">
          {groups.length > 0 ? groups.map((group) => (
            <section className="command-palette-group" key={group.label}>
              <h2>{group.label}</h2>
              {group.commands.map((command) => {
                const commandIndex = filteredCommands.indexOf(command);
                const Icon = commandIcons[command.icon];
                return (
                  <button
                    aria-disabled={command.disabled || undefined}
                    aria-selected={commandIndex === selectedIndex}
                    className={commandIndex === selectedIndex ? "is-selected" : undefined}
                    id={`command-palette-option-${command.id}`}
                    key={command.id}
                    role="option"
                    title={command.disabledReason}
                    type="button"
                    onClick={() => runCommand(command)}
                    onMouseMove={() => {
                      if (!command.disabled) {
                        setSelectedIndex(commandIndex);
                      }
                    }}
                  >
                    <Icon aria-hidden="true" size={17} strokeWidth={2} />
                    <span>{command.label}</span>
                    {command.disabled && command.disabledReason ? <em>{command.disabledReason}</em> : null}
                    {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                  </button>
                );
              })}
            </section>
          )) : (
            <p className="command-palette-empty">没有匹配的命令</p>
          )}
        </div>
        <footer>
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 执行</span>
        </footer>
      </section>
    </DialogBackdrop>
  );
}
