"use client";

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardActions } from "@/components/board/actions";
import { AiPanel } from "@/components/ai/ai-panel";
import { AddForm } from "@/components/board/add-form";
import { CardDrawer } from "@/components/board/card-drawer";
import { ColumnDeleteDialog } from "@/components/board/column-delete-dialog";
import type { DeleteChoice } from "@/components/board/column-delete-dialog";
import { ColumnView } from "@/components/board/column-view";
import { EditableTitle } from "@/components/board/editable-title";
import { EMPTY_FILTERS, FilterBar } from "@/components/board/filter-bar";
import type { Filters } from "@/components/board/filter-bar";
import { SprintBar } from "@/components/board/sprint-bar";
import * as state from "@/lib/board-state";
import { api, RequestError } from "@/lib/api/browser";
import { applyFilters } from "@/lib/filters";
import type { AppliedChange, PendingAction } from "@/lib/types/ai";
import type { Board, Column } from "@/lib/types/board";
import type { Label } from "@/lib/types/label";
import type { Sprint } from "@/lib/types/sprint";
import type { Member, Role } from "@/lib/types/workspace";
import { canWrite as roleCanWrite } from "@/lib/types/workspace";

const numId = (id: string | number) => Number(String(id).split("-")[1]);
const message = (err: unknown) =>
  err instanceof RequestError ? err.message : "Something went wrong. Please try again.";

interface Props {
  initial: Board;
  members: Member[];
  labels: Label[];
  sprints: Sprint[];
  role: Role;
  meId: number;
}

export function BoardView({ initial, members, labels, sprints: initialSprints, role, meId }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [board, setBoard] = useState(initial);
  const [sprints, setSprints] = useState(initialSprints);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [grouping, setGrouping] = useState<"none" | "priority" | "assignee">("none");
  // Deep link: /boards/3?card=42 opens that card straight away.
  const [openCardId, setOpenCardId] = useState<number | null>(() => {
    const wanted = Number(params.get("card"));
    return Number.isInteger(wanted) && wanted > 0 ? wanted : null;
  });
  const canWrite = roleCanWrite(role);
  // Only during a card drag: a local preview. Nothing is persisted until the drop.
  const [preview, setPreview] = useState<Board | null>(null);
  const [active, setActive] = useState<{ type: "card" | "column"; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Column | null>(null);
  const [undo, setUndo] = useState<{ card: Board["columns"][number]["cards"][number]; busy: boolean } | null>(null);
  // Element ids the AI just touched, highlighted briefly.
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const clearTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(clearTimer.current), []);

  // Mutations run one at a time, in order. After any failure or move, the board is
  // reconciled from the server once the queue drains, which also serves as the rollback.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const dirty = useRef(false);

  function mutate(optimistic: ((b: Board) => Board) | null, op: () => Promise<void>, resync = false) {
    if (optimistic) setBoard(optimistic);
    pending.current++;
    chain.current = chain.current.then(async () => {
      try {
        await op();
        if (resync) dirty.current = true;
      } catch (err) {
        setError(message(err));
        dirty.current = true;
      }
      if (--pending.current === 0 && dirty.current) {
        dirty.current = false;
        try {
          const fresh = await api.getBoard(initial.id);
          if (pending.current === 0) setBoard(fresh);
        } catch {
          setError("Couldn't refresh the board. Reload the page to see the latest state.");
        }
      }
    });
  }

  /** Server state from an AI reply. If manual edits are still in flight, reconcile after they finish. */
  function applyServerBoard(fresh: Board) {
    if (pending.current === 0) setBoard(fresh);
    else dirty.current = true;
  }

  function highlight(changes: AppliedChange[]) {
    const ids = new Set<string>();
    for (const c of changes) {
      if (c.column_id) ids.add(`column-${c.column_id}`);
      if (c.card_id) ids.add(`card-${c.card_id}`);
    }
    setChanged(ids);
    clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setChanged(new Set()), 4000);
  }

  /** A user-confirmed AI deletion runs exactly like the manual delete. */
  function confirmPending(action: PendingAction) {
    if (action.proposal_token) {
      void api.confirmAi(action.board_id, action.proposal_token).then((res) => {
        applyServerBoard(res.board);
        highlight(res.changes);
      }).catch((err) => setError(message(err)));
    } else if (action.tool === "delete_card" && action.card_id) {
      const id = action.card_id;
      mutate((b) => state.removeCard(b, id), async () => {
        await api.deleteCard(id);
      });
    } else if (action.tool === "delete_column" && action.column_id) {
      const id = action.column_id;
      const move = action.move_cards_to ?? undefined;
      mutate((b) => state.removeColumn(b, id, move), async () => {
        await api.deleteColumn(id, { moveCardsTo: move, deleteCards: action.delete_cards });
      }, true);
    } else if (action.tool === "delete_board") {
      mutate(null, async () => {
        await api.deleteBoard(action.board_id);
        router.push("/");
        router.refresh();
      });
    }
  }

  const columnOf = (b: Board, cardId: number) => state.findCard(b, cardId)?.column;

  // The drawer reads from board state rather than holding its own copy, so an edit made in the
  // drawer and one made on the board can never disagree. A card that disappears (deleted by the
  // AI, or by someone else on a refresh) simply stops resolving, and the drawer stops rendering.
  const openCard = openCardId === null ? null : state.findCard(board, openCardId);

  const filtered = useMemo(() => applyFilters(board, filters, meId), [board, filters, meId]);
  const shown = preview ?? filtered;
  const displayColumns = useMemo(() => {
    if (grouping === "none") return shown.columns;
    const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 } as const;
    return shown.columns.map((column) => ({
      ...column,
      cards: [...column.cards].sort((a, b) => {
        if (grouping === "priority") return priorityRank[a.priority] - priorityRank[b.priority];
        return (a.assignee?.name ?? "Unassigned").localeCompare(b.assignee?.name ?? "Unassigned");
      }),
    }));
  }, [grouping, shown]);

  const actions: BoardActions = {
    renameColumn: (id, title) =>
      mutate((b) => state.updateColumn(b, id, { title }), async () => {
        await api.updateColumn(id, { title });
      }),
    moveColumnTo: (id, position) =>
      mutate((b) => state.moveColumn(b, id, position), async () => {
        await api.updateColumn(id, { position });
      }, true),
    updateColumnSettings: (id, patch) =>
      mutate((b) => state.updateColumn(b, id, patch), async () => {
        await api.updateColumn(id, patch);
      }, true),
    requestDeleteColumn: setDeleting,
    addCard: (columnId, title) =>
      new Promise<void>((resolve) => {
        mutate(null, async () => {
          try {
            const card = await api.createCard(columnId, title);
            setBoard((b) => state.addCard(b, card));
          } finally {
            resolve();
          }
        });
      }),
    openCard: (card) => setOpenCardId(card.id),
    moveCardTo: (cardId, columnId, position) => {
      const target = board.columns.find((c) => c.id === columnId);
      if (!target) return;
      const pos = position === "end" ? target.cards.length : position;
      mutate((b) => state.moveCard(b, cardId, columnId, pos), async () => {
        await api.moveCard(cardId, columnId, pos);
      }, true);
    },
    canWrite,
  };

  // --- drag and drop ------------------------------------------------------------------------

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragStart(e: DragStartEvent) {
    const type = e.active.data.current?.type as "card" | "column";
    const id = numId(e.active.id);
    if (type === "card") {
      setPreview(board);
      setActive({ type, title: state.findCard(board, id)?.card.title ?? "" });
    } else {
      setActive({ type, title: board.columns.find((c) => c.id === id)?.title ?? "" });
    }
  }

  /** Column id and insert index for whatever the pointer is over. */
  function target(b: Board, over: NonNullable<DragOverEvent["over"]>) {
    const id = numId(over.id);
    const type = over.data.current?.type;
    if (type === "card") {
      const col = columnOf(b, id);
      return col ? { columnId: col.id, index: col.cards.findIndex((c) => c.id === id) } : null;
    }
    const col = b.columns.find((c) => c.id === id);
    return col ? { columnId: col.id, index: col.cards.length } : null;
  }

  function onDragOver(e: DragOverEvent) {
    if (e.active.data.current?.type !== "card" || !e.over || !preview) return;
    const cardId = numId(e.active.id);
    const from = columnOf(preview, cardId);
    const to = target(preview, e.over);
    if (!from || !to || from.id === to.columnId) return; // same-column order is settled on drop
    const below = (e.active.rect.current.translated?.top ?? 0) > e.over.rect.top + e.over.rect.height;
    const index = e.over.data.current?.type === "card" && below ? to.index + 1 : to.index;
    setPreview(state.moveCard(preview, cardId, to.columnId, index));
  }

  function onDragEnd(e: DragEndEvent) {
    const type = e.active.data.current?.type;
    const id = numId(e.active.id);
    setActive(null);

    if (type === "column") {
      const to = e.over && target(board, e.over);
      const position = to ? board.columns.findIndex((c) => c.id === to.columnId) : -1;
      if (position >= 0 && position !== board.columns.find((c) => c.id === id)?.position) {
        actions.moveColumnTo(id, position);
      }
      return;
    }

    let result = preview ?? board;
    const to = e.over && target(result, e.over);
    const here = columnOf(result, id);
    if (to && here && to.columnId === here.id && e.over?.data.current?.type === "card") {
      result = state.moveCard(result, id, here.id, to.index); // reorder within the column
    }
    setPreview(null);

    const before = state.findCard(board, id);
    const after = state.findCard(result, id);
    if (!before || !after) return;
    if (before.column.id === after.column.id && before.card.position === after.card.position) return;
    // One persisted move, on drop only.
    actions.moveCardTo(id, after.column.id, after.card.position);
  }

  function onDragCancel() {
    setPreview(null);
    setActive(null);
  }

  // --- render -------------------------------------------------------------------------------

  const totalCards = board.columns.reduce((count, column) => count + column.cards.length, 0);
  const visibleCards = filtered.columns.reduce((count, column) => count + column.cards.length, 0);

  return (
    <div className="board">
      <div className="board-heading">
        <div className="board-heading-main">
          <Link className="back-link" href="/">
            <span aria-hidden="true">←</span> All boards
          </Link>
          <h1>
            {canWrite ? (
              <EditableTitle
                value={board.title}
                label="Board title"
                maxLength={200}
                className="board-title-button"
                onCommit={(title) =>
                  mutate((b) => ({ ...b, title }), async () => {
                    await api.updateBoard(board.id, { title });
                  })
                }
              />
            ) : (
              board.title
            )}
          </h1>
          {!canWrite && <p className="board-subtitle">You have view-only access to this board.</p>}
        </div>
        <div className="board-stats" aria-label="Board statistics">
          <Link className="stat-pill" href={`/boards/${board.id}/insights`}>
            Insights
          </Link>
          <span className="stat-pill">
            <strong>{board.columns.length}</strong> columns
          </span>
          <span className="stat-pill">
            <strong>{visibleCards === totalCards ? totalCards : `${visibleCards} of ${totalCards}`}</strong>{" "}
            cards
          </span>
        </div>
      </div>

      {error && (
        <div role="alert" className="error-banner">
          {error}{" "}
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {undo && (
        <div className="undo-toast" role="status">
          <span>Card archived.</span>
          <button
            type="button"
            disabled={undo.busy}
            onClick={async () => {
              setUndo((current) => current && { ...current, busy: true });
              try {
                const restored = await api.unarchiveCard(undo.card.id);
                setBoard((current) => state.addCard(current, restored));
                setUndo(null);
              } catch (err) {
                setError(message(err));
                setUndo(null);
              }
            }}
          >
            Undo
          </button>
        </div>
      )}

      <div className="board-controls">
        <SprintBar board={board} sprints={sprints} canWrite={canWrite} onSprintsChanged={setSprints} />
        <FilterBar filters={filters} members={members} labels={labels} onChange={setFilters} />
        <div className="board-view-options" aria-label="Board view options">
          <label>
            <span>Card density</span>
            <select value={density} onChange={(event) => setDensity(event.target.value as typeof density)}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <label>
            <span>Group cards</span>
            <select value={grouping} onChange={(event) => setGrouping(event.target.value as typeof grouping)}>
              <option value="none">None</option>
              <option value="priority">Priority</option>
              <option value="assignee">Assignee</option>
            </select>
          </label>
          <span className="muted">Keyboard users can move cards with the ↑ and ↓ controls.</span>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className={`columns density-${density}`}>
          <SortableContext
            items={shown.columns.map((c) => `column-${c.id}`)}
            strategy={horizontalListSortingStrategy}
          >
            {displayColumns.map((column) => (
              <ColumnView
                key={column.id}
                column={column}
                columns={shown.columns}
                actions={actions}
                changed={changed}
                canWrite={canWrite}
                interactive={grouping === "none"}
              />
            ))}
          </SortableContext>
          {canWrite && <div className="column add-column">
            <AddForm
              label="Add column"
              placeholder="Column title"
              maxLength={200}
              onSubmit={(title) =>
                new Promise<void>((resolve) =>
                  mutate(null, async () => {
                    try {
                      const column = await api.createColumn(board.id, title);
                      setBoard((b) => state.addColumn(b, { ...column, cards: column.cards ?? [] }));
                    } finally {
                      resolve();
                    }
                  }),
                )
              }
            />
          </div>}
        </div>
        <DragOverlay>
          {active && <div className={`${active.type} overlay`}>{active.title}</div>}
        </DragOverlay>
      </DndContext>

      {canWrite && (
        <AiPanel
          boardId={board.id}
          onBoard={applyServerBoard}
          onChanges={highlight}
          onConfirm={confirmPending}
        />
      )}

      {board.columns.length === 0 && <p>This board has no columns yet. Add one to get started.</p>}

      {openCard && (
        <CardDrawer
          key={openCard.card.id}
          card={openCard.card}
          column={openCard.column}
          columns={board.columns}
          members={members}
          labels={labels}
          sprints={sprints}
          canWrite={canWrite}
          meId={meId}
          onCardChanged={(card) => setBoard((b) => state.replaceCard(b, card))}
          onArchived={(cardId) => {
            const archived = openCard?.card;
            setOpenCardId(null);
            setBoard((b) => state.removeCard(b, cardId));
            if (archived) setUndo({ card: archived, busy: false });
          }}
          onOpenCard={(next) => setOpenCardId(next.id)}
          onClose={() => setOpenCardId(null)}
        />
      )}

      {deleting && (
        <ColumnDeleteDialog
          column={board.columns.find((c) => c.id === deleting.id) ?? deleting}
          others={board.columns.filter((c) => c.id !== deleting.id)}
          onCancel={() => setDeleting(null)}
          onConfirm={(choice: DeleteChoice) => {
            const column = deleting;
            setDeleting(null);
            mutate((b) => state.removeColumn(b, column.id, choice.moveCardsTo), async () => {
              await api.deleteColumn(column.id, choice);
            }, true);
          }}
        />
      )}
    </div>
  );
}
