"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardActions } from "@/components/board/actions";
import { AddForm } from "@/components/board/add-form";
import { CardItem } from "@/components/board/card-item";
import { EditableTitle } from "@/components/board/editable-title";
import type { Column } from "@/lib/types/board";

interface Props {
  column: Column;
  columns: Column[];
  actions: BoardActions;
  /** Element ids ("card-1", "column-2") touched by the AI, highlighted briefly. */
  changed: ReadonlySet<string>;
}

export function ColumnView({ column, columns, actions, changed }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `column-${column.id}`, data: { type: "column" } });
  const { setNodeRef: setDropRef } = useDroppable({ id: `drop-${column.id}`, data: { type: "drop" } });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition,
  };
  const first = column.position === 0;
  const last = column.position === columns.length - 1;

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`column${isDragging ? " dragging" : ""}${changed.has(`column-${column.id}`) ? " changed" : ""}`}
      aria-label={`Column ${column.title}`}
    >
      <header className="column-header">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="handle"
          aria-label={`Drag column ${column.title}`}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <span className="column-color" aria-hidden="true" />
        <h2 className="column-heading">
          <EditableTitle
            value={column.title}
            label="Column title"
            maxLength={200}
            className="column-title"
            onCommit={(title) => actions.renameColumn(column.id, title)}
          />
        </h2>
        <span className="count" aria-label={`${column.cards.length} cards`}>
          {column.cards.length}
        </span>
        <button
          type="button"
          aria-label={`Move column ${column.title} left`}
          disabled={first}
          onClick={() => actions.moveColumnTo(column.id, column.position - 1)}
        >
          <span aria-hidden="true">←</span>
        </button>
        <button
          type="button"
          aria-label={`Move column ${column.title} right`}
          disabled={last}
          onClick={() => actions.moveColumnTo(column.id, column.position + 1)}
        >
          <span aria-hidden="true">→</span>
        </button>
        <button
          type="button"
          aria-label={`Delete column ${column.title}`}
          onClick={() => actions.requestDeleteColumn(column)}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <SortableContext
        items={column.cards.map((c) => `card-${c.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <ul ref={setDropRef} className="cards">
          {column.cards.map((card, i) => (
            <CardItem
              key={card.id}
              card={card}
              index={i}
              count={column.cards.length}
              columns={columns}
              actions={actions}
              changed={changed.has(`card-${card.id}`)}
            />
          ))}
        </ul>
      </SortableContext>
      {(
        <AddForm
          label="Add card"
          placeholder="Card title"
          maxLength={300}
          onSubmit={(title) => actions.addCard(column.id, title)}
        />
      )}
    </section>
  );
}
