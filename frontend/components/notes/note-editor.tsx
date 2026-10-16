"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BlockRow } from "@/components/notes/block-row";
import type { Draft } from "@/components/notes/block-row";
import { WorkPicker } from "@/components/work-picker";
import type { WorkChoice } from "@/components/work-picker";
import { SlashMenu } from "@/components/notes/slash-menu";
import type { MenuChoice } from "@/components/notes/slash-menu";
import { api, RequestError } from "@/lib/api/browser";
import { MAX_INDENT } from "@/lib/types/note";
import type { BlockType, Note, NoteBlock, NoteBlockInput } from "@/lib/types/note";

/** Pressing Enter in one of these starts another of the same, the way a list should. */
const CONTINUING = new Set<BlockType>(["bulleted", "numbered", "todo"]);
/** Blocks with no text of their own: Backspace removes them instead of merging into them. */
const TEXTLESS = new Set<BlockType>(["divider", "card_embed", "board_embed"]);

const SAVE_DELAY = 900;

type SaveState = "idle" | "saving" | "saved" | "error";

let counter = 0;
const nextKey = () => `b${++counter}`;

function fromBlock(block: NoteBlock): Draft {
  return { ...block, key: nextKey() };
}

function toInput(draft: Draft): NoteBlockInput {
  return {
    id: draft.id,
    type: draft.type,
    text: draft.text,
    checked: draft.checked,
    indent: draft.indent,
    ref_card_id: draft.ref_card_id,
    ref_board_id: draft.ref_board_id,
  };
}

function blank(patch: Partial<Draft> = {}): Draft {
  return {
    key: nextKey(),
    type: "paragraph",
    text: "",
    checked: false,
    indent: 0,
    ref_card_id: null,
    ref_board_id: null,
    ref_title: "",
    ref_card_board_id: null,
    ...patch,
  };
}

/**
 * The page body: an ordered list of typed blocks.
 *
 * One textarea per block rather than a single contenteditable document. The block model is the
 * same either way, but a textarea cannot lose a caret, breaks no IME, and needs no custom
 * selection code - the cost is that formatting is per block rather than per word, which is a
 * trade worth making until inline marks are actually asked for.
 *
 * Saving is debounced and sends the whole body, which the backend applies in one transaction:
 * blocks that come back by id are updated in place, so an autosave never churns block identity
 * and a half-finished save can never leave the page empty.
 */
export function NoteEditor({
  note,
  canEdit,
  workspaceId,
}: {
  note: Note;
  canEdit: boolean;
  workspaceId: number;
}) {
  const [blocks, setBlocks] = useState<Draft[]>(() =>
    note.blocks.length > 0 ? note.blocks.map(fromBlock) : [blank()],
  );
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ key: string; target: "card" | "board" } | null>(null);

  const dirty = useRef(false);
  const revision = useRef(0);
  const areas = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocus = useRef<{ key: string; caret: number } | null>(null);

  const registerRef = useCallback((key: string, el: HTMLTextAreaElement | null) => {
    if (el) areas.current.set(key, el);
    else areas.current.delete(key);
  }, []);

  function focusBlock(key: string, caret: number) {
    const el = areas.current.get(key);
    if (!el) return;
    el.focus();
    const at = Math.min(caret, el.value.length);
    el.setSelectionRange(at, at);
  }

  /** Structural edits say where the caret should land; this puts it there after the render. */
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    focusBlock(target.key, target.caret);
  }, [blocks]);

  function edit(next: Draft[] | ((current: Draft[]) => Draft[])) {
    revision.current += 1;
    dirty.current = true;
    setState("idle");
    setBlocks(next);
  }

  // Autosave. The revision check means a save that lands after further typing does not
  // overwrite what has been typed since; the next save settles it.
  useEffect(() => {
    if (!canEdit || !dirty.current) return;
    const mine = revision.current;
    const timer = setTimeout(async () => {
      setState("saving");
      try {
        const saved = await api.saveBlocks(note.id, blocks.map(toInput));
        if (revision.current === mine) {
          dirty.current = false;
          // Keep local keys and text; adopt the ids and anything the server resolved.
          setBlocks((current) =>
            current.length === saved.blocks.length
              ? current.map((draft, index) => ({
                  ...draft,
                  id: saved.blocks[index].id,
                  ref_title: saved.blocks[index].ref_title,
                  ref_card_board_id: saved.blocks[index].ref_card_board_id,
                }))
              : current,
          );
        }
        setState("saved");
        setError(null);
      } catch (err) {
        setState("error");
        setError(err instanceof RequestError ? err.message : "Couldn’t save your changes.");
      }
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [blocks, canEdit, note.id]);

  function patch(index: number, changes: Partial<Draft>) {
    edit((current) => current.map((draft, i) => (i === index ? { ...draft, ...changes } : draft)));
  }

  function remove(index: number) {
    edit((current) => {
      const next = current.filter((_, i) => i !== index);
      return next.length > 0 ? next : [blank()];
    });
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    edit((current) => {
      const next = [...current];
      const [lifted] = next.splice(index, 1);
      next.splice(target, 0, lifted);
      return next;
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>, index: number) {
    const draft = blocks[index];
    const area = event.currentTarget;
    const atStart = area.selectionStart === 0 && area.selectionEnd === 0;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // Enter on an empty list item ends the list rather than making another one.
      if (!draft.text && CONTINUING.has(draft.type)) {
        patch(index, { type: "paragraph", checked: false });
        return;
      }
      const caret = area.selectionStart;
      const before = draft.text.slice(0, caret);
      const after = draft.text.slice(caret);
      const created = blank({
        type: CONTINUING.has(draft.type) ? draft.type : "paragraph",
        text: after,
        indent: draft.indent,
      });
      pendingFocus.current = { key: created.key, caret: 0 };
      edit((current) => [
        ...current.slice(0, index),
        { ...current[index], text: before },
        created,
        ...current.slice(index + 1),
      ]);
      return;
    }

    if (event.key === "Backspace" && atStart) {
      if (draft.indent > 0) {
        event.preventDefault();
        patch(index, { indent: draft.indent - 1 });
        return;
      }
      if (index === 0) return;
      event.preventDefault();
      const previous = blocks[index - 1];
      if (TEXTLESS.has(previous.type)) {
        remove(index - 1);
        return;
      }
      pendingFocus.current = { key: previous.key, caret: previous.text.length };
      edit((current) => [
        ...current.slice(0, index - 1),
        { ...previous, text: previous.text + draft.text },
        ...current.slice(index + 1),
      ]);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const ceiling = Math.min(index === 0 ? 0 : blocks[index - 1].indent + 1, MAX_INDENT);
      patch(index, {
        indent: event.shiftKey ? Math.max(draft.indent - 1, 0) : Math.min(draft.indent + 1, ceiling),
      });
      return;
    }

    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      move(index, event.key === "ArrowUp" ? -1 : 1);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && draft.type === "todo") {
      event.preventDefault();
      patch(index, { checked: !draft.checked });
      return;
    }

    // Walking off the end of one block into the next is what a document should do. Nothing
    // changes, so the caret is moved straight away rather than through a render.
    if (event.key === "ArrowUp" && atStart && index > 0) {
      event.preventDefault();
      focusBlock(blocks[index - 1].key, blocks[index - 1].text.length);
      return;
    }
    if (
      event.key === "ArrowDown" &&
      area.selectionStart === draft.text.length &&
      index < blocks.length - 1
    ) {
      event.preventDefault();
      focusBlock(blocks[index + 1].key, 0);
    }
  }

  function onChangeText(index: number, draft: Draft, changes: Partial<Draft>) {
    // "/" on its own opens the block menu instead of being written into the page.
    if (changes.text === "/" && !draft.text) {
      setMenuKey(draft.key);
      return;
    }
    patch(index, changes);
  }

  function choose(index: number, draft: Draft, choice: MenuChoice) {
    setMenuKey(null);
    if (choice.kind === "link") {
      setPicker({ key: draft.key, target: choice.target });
      return;
    }
    patch(index, { type: choice.type, text: "", checked: false });
    pendingFocus.current = { key: draft.key, caret: 0 };
  }

  function insertEmbed(index: number, choice: WorkChoice) {
    setPicker(null);
    const created = blank({
      type: choice.cardId ? "card_embed" : "board_embed",
      ref_card_id: choice.cardId ?? null,
      ref_board_id: choice.boardId ?? null,
      ref_title: choice.title,
      ref_card_board_id: null,
    });
    const after = blank();
    pendingFocus.current = { key: after.key, caret: 0 };
    edit((current) => {
      // The empty block the menu was opened from is replaced; a written one is kept.
      const here = current[index].text ? [current[index]] : [];
      return [...current.slice(0, index), ...here, created, after, ...current.slice(index + 1)];
    });
  }

  /** Numbering restarts whenever a run of numbered blocks at the same indent is broken. */
  function numberFor(index: number): number {
    const draft = blocks[index];
    let n = 1;
    for (let i = index - 1; i >= 0; i -= 1) {
      const previous = blocks[i];
      if (previous.type !== "numbered" || previous.indent !== draft.indent) break;
      n += 1;
    }
    return n;
  }

  return (
    <div className="note-editor">
      <ul className="note-blocks">
        {blocks.map((draft, index) => (
          <BlockRow
            key={draft.key}
            draft={draft}
            canEdit={canEdit}
            number={numberFor(index)}
            registerRef={registerRef}
            onChange={(changes) => onChangeText(index, draft, changes)}
            onKeyDown={(event) => onKeyDown(event, index)}
            onRemove={() => remove(index)}
            onMove={(delta) => move(index, delta)}
            menu={
              menuKey === draft.key ? (
                <SlashMenu
                  onChoose={(choice) => choose(index, draft, choice)}
                  onClose={() => setMenuKey(null)}
                />
              ) : picker?.key === draft.key ? (
                <WorkPicker
                  workspaceId={workspaceId}
                  target={picker.target}
                  onPick={(choice) => insertEmbed(index, choice)}
                  onCancel={() => setPicker(null)}
                />
              ) : undefined
            }
          />
        ))}
      </ul>

      {canEdit && (
        <div className="note-editor-foot">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              const created = blank();
              pendingFocus.current = { key: created.key, caret: 0 };
              edit((current) => [...current, created]);
            }}
          >
            Add a block
          </button>
          <p className="note-save-state" role="status">
            {state === "saving" && "Saving…"}
            {state === "saved" && "Saved"}
            {state === "error" && (error ?? "Couldn’t save")}
          </p>
        </div>
      )}
      {!canEdit && <p className="muted">Your role is read-only, so this page cannot be edited.</p>}
    </div>
  );
}
