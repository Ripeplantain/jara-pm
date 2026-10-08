"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardActions } from "@/components/board/actions";
import { CardFace } from "@/components/board/card-face";
import type { Card, Column } from "@/lib/types/board";

interface Props {
  card: Card;
  index: number;
  count: number;
  columns: Column[];
  actions: BoardActions;
  changed?: boolean;
  canMove: boolean;
}

export function CardItem({ card, index, count, columns, actions, changed, canMove }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `card-${card.id}`, data: { type: "card" } });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`card${isDragging ? " dragging" : ""}${changed ? " changed" : ""}`}
    >
      <div className="card-main">
        {actions.canWrite && canMove && <button
          type="button"
          ref={setActivatorNodeRef}
          className="handle"
          aria-label={`Drag card ${card.title}`}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>}
        <button
          type="button"
          className="card-title"
          aria-label={`Open card ${card.title}`}
          onClick={() => actions.openCard(card)}
        >
          {card.title}
        </button>
      </div>
      <CardFace card={card} />
      {actions.canWrite && canMove && (
        <div className="card-controls">
          <button
            type="button"
            aria-label={`Move card ${card.title} up`}
            disabled={index === 0}
            onClick={() => actions.moveCardTo(card.id, card.column_id, index - 1)}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move card ${card.title} down`}
            disabled={index === count - 1}
            onClick={() => actions.moveCardTo(card.id, card.column_id, index + 1)}
          >
            ↓
          </button>
          <select
            aria-label={`Move card ${card.title} to column`}
            value={card.column_id}
            onChange={(e) => actions.moveCardTo(card.id, Number(e.target.value), "end")}
          >
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      )}
    </li>
  );
}
