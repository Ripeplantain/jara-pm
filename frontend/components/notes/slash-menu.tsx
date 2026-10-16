"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import type { IconName } from "@/components/icon";
import { BLOCK_MENU } from "@/lib/types/note";
import type { BlockType } from "@/lib/types/note";

export type MenuChoice =
  | { kind: "type"; type: BlockType }
  | { kind: "link"; target: "card" | "board" };

const EXTRA: { label: string; hint: string; icon: IconName; choice: MenuChoice }[] = [
  {
    label: "Link a card",
    hint: "Point at a card on a board",
    icon: "square-check",
    choice: { kind: "link", target: "card" },
  },
  {
    label: "Link a board",
    hint: "Point at a whole board",
    icon: "layout-grid",
    choice: { kind: "link", target: "board" },
  },
];

/**
 * The "/" menu. A listbox rather than a popup of buttons, so arrow keys and Escape behave the
 * way the rest of the app's menus do and a screen reader announces the active option.
 */
export function SlashMenu({
  onChoose,
  onClose,
}: {
  onChoose: (choice: MenuChoice) => void;
  onClose: () => void;
}) {
  const items = useMemo(
    () => [
      ...BLOCK_MENU.map((entry) => ({
        label: entry.label,
        hint: entry.hint,
        icon: entry.icon as IconName,
        choice: { kind: "type", type: entry.type } as MenuChoice,
      })),
      ...EXTRA,
    ],
    [],
  );
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const keys = ["ArrowDown", "ArrowUp", "Enter", "Escape"];
      if (!keys.includes(event.key)) return;
      // Captured and stopped here, so the block's own handler never sees it. Without this the
      // Enter that picks an option also splits the block, and the text the user types next
      // lands in a stray block below the one they just chose.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowDown") setActive((i) => (i + 1) % items.length);
      else if (event.key === "ArrowUp") setActive((i) => (i - 1 + items.length) % items.length);
      else if (event.key === "Enter") onChoose(items[active].choice);
      else onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, items, onChoose, onClose]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="slash-menu" role="presentation">
      <p className="menu-label">Turn into</p>
      <ul className="slash-menu-list" role="listbox" aria-label="Block type" ref={list}>
        {items.map((item, index) => (
          <li
            key={item.label}
            role="option"
            aria-selected={index === active}
            className={index === active ? "active" : undefined}
          >
            <button type="button" onMouseEnter={() => setActive(index)} onClick={() => onChoose(item.choice)}>
              <Icon name={item.icon} size="sm" />
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="command-hint">↑↓ to choose · Enter to apply · Esc to dismiss</p>
    </div>
  );
}
