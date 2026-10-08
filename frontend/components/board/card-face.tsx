import { Avatar } from "@/components/shell/avatar";
import { dueState, shortDate } from "@/lib/dates";
import type { Card } from "@/lib/types/board";

/**
 * Everything a card shows at rest. Kept deliberately compact - a column has to show several
 * cards at once, so each badge earns its line.
 */
export function CardFace({ card }: { card: Card }) {
  const due = dueState(card.due_date, card.completed_at);
  const hasFooter =
    card.assignee || card.estimate !== null || card.checklist_total > 0 || card.comment_count > 0;

  return (
    <>
      {card.labels.length > 0 && (
        <ul className="card-labels" aria-label="Labels">
          {card.labels.map((label) => (
            <li key={label.id} className={`label-chip tint-${label.color}`}>
              {label.name}
            </li>
          ))}
        </ul>
      )}

      {(card.priority !== "none" || due !== "none") && (
        <p className="card-badges">
          {card.priority !== "none" && (
            <span className={`priority priority-${card.priority}`}>
              <span aria-hidden="true">●</span> {card.priority}
            </span>
          )}
          {card.due_date && (
            <span className={`due due-${due}`}>
              {due === "overdue" ? "Overdue · " : ""}
              {shortDate(card.due_date)}
            </span>
          )}
        </p>
      )}

      {hasFooter && (
        <p className="card-footer">
          {card.checklist_total > 0 && (
            <span
              className={`chip${card.checklist_done === card.checklist_total ? " complete" : ""}`}
              title="Checklist"
            >
              ☑ {card.checklist_done}/{card.checklist_total}
            </span>
          )}
          {card.comment_count > 0 && (
            <span className="chip" title={`${card.comment_count} comments`}>
              💬 {card.comment_count}
            </span>
          )}
          {card.estimate !== null && (
            <span className="chip" title="Estimate">
              {card.estimate} pt
            </span>
          )}
          {card.assignee && <Avatar user={card.assignee} size="sm" />}
        </p>
      )}
    </>
  );
}
