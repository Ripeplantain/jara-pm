"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardActions } from "@/components/board/actions";
import { AddForm } from "@/components/board/add-form";
import { CardItem } from "@/components/board/card-item";
import { EditableTitle } from "@/components/board/editable-title";
import { ColumnSettings } from "@/components/board/column-settings";
import type { Column } from "@/lib/types/board";

interface Props {
  column: Column;
  columns: Column[];
  actions: BoardActions;
  canWrite: boolean;
  interactive: boolean;
  /** Element ids ("card-1", "column-2") touched by the AI, highlighted briefly. */
  changed: ReadonlySet<string>;
}

export function ColumnView({ column, columns, actions, changed, canWrite, interactive }: Props) {
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
        {canWrite && interactive && <button
          type="button"
          ref={setActivatorNodeRef}
          className="handle"
          aria-label={`Drag column ${column.title}`}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>}
        <span className="column-color" aria-hidden="true" />
        <h2 className="column-heading">
          {canWrite ? (
            <EditableTitle
              value={column.title}
              label="Column title"
              maxLength={200}
              className="column-title"
              onCommit={(title) => actions.renameColumn(column.id, title)}
            />
          ) : column.title}
        </h2>
        <span
          className={`count${column.over_wip_limit ? " over-limit" : ""}`}
          aria-label={
            column.wip_limit
              ? `${column.card_count} of ${column.wip_limit} cards${column.over_wip_limit ? ", over the limit" : ""}`
              : `${column.card_count} cards`
          }
          title={column.over_wip_limit ? "Over the work-in-progress limit" : undefined}
        >
          {column.card_count}
          {column.wip_limit !== null && <span aria-hidden="true">/{column.wip_limit}</span>}
        </span>
        {column.is_done && (
          <span className="pill pill-done" title="Cards that reach this column count as done">
            done
          </span>
        )}
        {canWrite && interactive && <button
          type="button"
          aria-label={`Move column ${column.title} left`}
          disabled={first}
          onClick={() => actions.moveColumnTo(column.id, column.position - 1)}
        >
          <span aria-hidden="true">←</span>
        </button>}
        {canWrite && interactive && <button
          type="button"
          aria-label={`Move column ${column.title} right`}
          disabled={last}
          onClick={() => actions.moveColumnTo(column.id, column.position + 1)}
        >
          <span aria-hidden="true">→</span>
        </button>}
        {canWrite && <ColumnSettings column={column} actions={actions} />}
      </header>
      {column.over_wip_limit && (
        <p className="wip-warning" role="status">
          Over its limit of {column.wip_limit}. Finish something before starting more.
        </p>
      )}
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
              canMove={interactive}
            />
          ))}
        </ul>
      </SortableContext>
      {actions.canWrite && (
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
