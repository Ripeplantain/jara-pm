/** Mirror backend/app/schemas/labels.py. Colours are names, not hex: see globals.css. */
export const LABEL_COLORS = [
  "slate",
  "indigo",
  "cyan",
  "emerald",
  "amber",
  "rose",
  "violet",
] as const;

export type LabelColor = (typeof LABEL_COLORS)[number];

export interface Label {
  id: number;
  workspace_id: number;
  name: string;
  color: string;
}
