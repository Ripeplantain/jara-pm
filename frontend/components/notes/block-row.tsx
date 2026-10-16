"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/icon";
import type { BlockType } from "@/lib/types/note";

export interface Draft {
  /** Stable while the component is mounted, so React keys survive before the row has an id. */
  key: string;
  id?: number;
  type: BlockType;
  text: string;
  checked: boolean;
  indent: number;
  ref_card_id: number | null;
  ref_board_id: number | null;
  /** Resolved by the backend on read; empty when the target has been deleted. */
  ref_title: string;
  /** The board an embedded card sits on, also resolved on read. */
  ref_card_board_id: number | null;
}

const PLACEHOLDER: Partial<Record<BlockType, string>> = {
  paragraph: "Write, or press / for blocks",
  heading1: "Heading 1",
  heading2: "Heading 2",
  heading3: "Heading 3",
  bulleted: "List item",
  numbered: "List item",
  todo: "To-do",
  quote: "Quote",
  callout: "Callout",
  code: "Code",
};

interface Props {
  draft: Draft;
  canEdit: boolean;
  /** 1-based position in the current run of numbered blocks at this indent. */
  number: number;
  registerRef: (key: string, el: HTMLTextAreaElement | null) => void;
  onChange: (patch: Partial<Draft>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  menu?: React.ReactNode;
}

/** Grows with its content, so a long block never becomes a tiny scrolling box. */
function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}

export function BlockRow({
  draft,
  canEdit,
  number,
  registerRef,
  onChange,
  onKeyDown,
  onRemove,
  onMove,
  menu,
}: Props) {
  const areaRef = useAutoGrow(draft.text);

  const body = (() => {
    if (draft.type === "divider") {
      return <hr className="block-divider" />;
    }

    if (draft.type === "card_embed" || draft.type === "board_embed") {
      const isCard = draft.type === "card_embed";
      const href = isCard
        ? `/boards/${draft.ref_card_board_id}?card=${draft.ref_card_id}`
        : `/boards/${draft.ref_board_id}`;
      if (!draft.ref_title || (isCard && draft.ref_card_board_id === null)) {
        return (
          <p className="block-embed unavailable">
            <Icon name="info" size="sm" />
            {isCard ? "That card" : "That board"} is no longer available.
          </p>
        );
      }
      return (
        <Link className="block-embed" href={href}>
          <Icon name={isCard ? "square-check" : "layout-grid"} size="sm" />
          <strong>{draft.ref_title}</strong>
          <span>{isCard ? "Card" : "Board"}</span>
        </Link>
      );
    }

    if (!canEdit) {
      // Read-only: real elements, not disabled inputs, so the page reads as a document.
      const Tag =
        draft.type === "heading1"
          ? "h2"
          : draft.type === "heading2"
            ? "h3"
            : draft.type === "heading3"
              ? "h4"
              : draft.type === "quote"
                ? "blockquote"
                : draft.type === "code"
                  ? "pre"
                  : "p";
      return <Tag className="block-text">{draft.text}</Tag>;
    }

    return (
      <textarea
        ref={(el) => {
          areaRef.current = el;
          registerRef(draft.key, el);
        }}
        className="block-input"
        value={draft.text}
        rows={1}
        spellCheck
        placeholder={PLACEHOLDER[draft.type] ?? ""}
        aria-label={`${draft.type.replace("_", " ")} block`}
        onChange={(event) => onChange({ text: event.target.value })}
        onKeyDown={onKeyDown}
      />
    );
  })();

  const marker = (() => {
    if (draft.type === "bulleted") return <span className="block-marker" aria-hidden="true">•</span>;
    if (draft.type === "numbered") return <span className="block-marker" aria-hidden="true">{number}.</span>;
    if (draft.type === "todo") {
      return (
        <input
          type="checkbox"
          className="block-check"
          checked={draft.checked}
          disabled={!canEdit}
          aria-label={draft.text ? `Done: ${draft.text}` : "Mark this to-do done"}
          onChange={(event) => onChange({ checked: event.target.checked })}
        />
      );
    }
    if (draft.type === "callout") return <span className="block-marker" aria-hidden="true">💡</span>;
    return null;
  })();

  return (
    <li
      className={`block block-${draft.type}${draft.type === "todo" && draft.checked ? " done" : ""}`}
      style={{ "--block-indent": draft.indent } as React.CSSProperties}
    >
      <div className="block-line">
        {marker}
        {body}
        {canEdit && (
          <span className="block-actions">
            <button type="button" aria-label="Move this block up" onClick={() => onMove(-1)}>
              <Icon name="arrow-up" size="sm" />
            </button>
            <button type="button" aria-label="Move this block down" onClick={() => onMove(1)}>
              <Icon name="arrow-down" size="sm" />
            </button>
            <button type="button" aria-label="Delete this block" onClick={onRemove}>
              <Icon name="trash-2" size="sm" />
            </button>
          </span>
        )}
      </div>
      {menu}
    </li>
  );
}
