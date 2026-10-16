/** Mirror backend schemas in backend/app/schemas/notes.py. */
import type { User } from "@/lib/types/auth";

/** The fixed block vocabulary; mirrors BLOCK_TYPES in backend/app/models/note.py. */
export const BLOCK_TYPES = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bulleted",
  "numbered",
  "todo",
  "quote",
  "callout",
  "code",
  "divider",
  "card_embed",
  "board_embed",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const EMBED_TYPES: readonly BlockType[] = ["card_embed", "board_embed"];
export const MAX_INDENT = 5;

/** What the slash menu offers, in the order it offers it. */
export const BLOCK_MENU: { type: BlockType; label: string; hint: string; icon: string }[] = [
  { type: "paragraph", label: "Text", hint: "Plain paragraph", icon: "type" },
  { type: "heading1", label: "Heading 1", hint: "Large section title", icon: "heading-1" },
  { type: "heading2", label: "Heading 2", hint: "Section title", icon: "heading-2" },
  { type: "heading3", label: "Heading 3", hint: "Subsection title", icon: "heading-3" },
  { type: "bulleted", label: "Bulleted list", hint: "Unordered item", icon: "list" },
  { type: "numbered", label: "Numbered list", hint: "Ordered item", icon: "list-ordered" },
  { type: "todo", label: "To-do", hint: "Checkable task", icon: "square-check" },
  { type: "quote", label: "Quote", hint: "Set a passage apart", icon: "quote" },
  { type: "callout", label: "Callout", hint: "Draw attention", icon: "info" },
  { type: "code", label: "Code", hint: "Monospaced block", icon: "code" },
  { type: "divider", label: "Divider", hint: "Horizontal rule", icon: "minus" },
];

export type Visibility = "workspace" | "private";

export interface NoteBlock {
  id: number;
  type: BlockType;
  text: string;
  checked: boolean;
  indent: number;
  position: number;
  ref_card_id: number | null;
  ref_board_id: number | null;
  /** Resolved on read: the current title of the embedded card or board, empty if it is gone. */
  ref_title: string;
  /** Resolved on read: the board an embedded card sits on, for the deep link. */
  ref_card_board_id: number | null;
}

/** A block on the way to the server. `id` keeps an existing row through a save. */
export interface NoteBlockInput {
  id?: number;
  type: BlockType;
  text: string;
  checked: boolean;
  indent: number;
  ref_card_id?: number | null;
  ref_board_id?: number | null;
}

export interface NoteSummary {
  id: number;
  workspace_id: number;
  parent_id: number | null;
  title: string;
  icon: string;
  visibility: Visibility;
  position: number;
  owner: User | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Note extends NoteSummary {
  blocks: NoteBlock[];
}

/** A page found by search, with a window around the match. */
export interface NoteHit extends NoteSummary {
  excerpt: string;
}

/** The page tree, assembled from the flat list the API returns. */
export interface NoteNode extends NoteSummary {
  children: NoteNode[];
  depth: number;
}

/**
 * Nest a flat, ordered list of pages. The API orders roots first and then groups by parent, and
 * a visible page always has a visible parent, so one pass is enough.
 */
export function toTree(notes: NoteSummary[]): NoteNode[] {
  const nodes = new Map<number, NoteNode>();
  for (const note of notes) nodes.set(note.id, { ...note, children: [], depth: 0 });
  const roots: NoteNode[] = [];
  for (const note of notes) {
    const node = nodes.get(note.id)!;
    const parent = note.parent_id === null ? undefined : nodes.get(note.parent_id);
    if (parent) {
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Depth-first order, which is the order the tree is drawn in. */
export function flatten(nodes: NoteNode[]): NoteNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** A page's title as shown everywhere: untitled pages are normal while they are being written. */
export function noteTitle(note: { title: string }): string {
  return note.title.trim() || "Untitled";
}

export const UNTITLED = "Untitled";
