// Ports kmp/.../ui/components/CommandPaletteModel.kt -- pure data shaping
// for the Ctrl+K/Cmd+K command palette (EMB-218/#18g). See
// screens/CommandPalette.tsx for the UI half.
import { fuzzyMatchRank, fuzzyMatches } from "./fuzzyMatch";
import type { Project, ProjectSession } from "../api/types";

export type CommandPaletteItem =
  | { kind: "project"; id: string; projectId: string; label: string; sublabel: null }
  | { kind: "session"; id: string; projectId: string; sessionName: string; label: string; sublabel: string };

function projectLabel(project: Project): string {
  return project.name.trim().length > 0 ? project.name : project.id;
}

/**
 * Flattens the sidebar's project+session tree into a plain searchable list
 * -- takes the same two shapes webShellStore's state already holds (rather
 * than the whole state object), so this stays a pure-data module that only
 * knows about domain models, not one specific store's shape.
 */
export function buildCommandPaletteItems(
  projects: Project[],
  sessionsByProjectId: Record<string, ProjectSession[]>,
): CommandPaletteItem[] {
  const projectItems: CommandPaletteItem[] = projects.map((project) => ({
    kind: "project",
    id: `project:${project.id}`,
    projectId: project.id,
    label: projectLabel(project),
    sublabel: null,
  }));
  const sessionItems: CommandPaletteItem[] = projects.flatMap((project) =>
    (sessionsByProjectId[project.id] ?? []).map(
      (session): CommandPaletteItem => ({
        kind: "session",
        id: `session:${project.id}:${session.name}`,
        projectId: project.id,
        sessionName: session.name,
        label: session.name,
        sublabel: projectLabel(project),
      }),
    ),
  );
  return [...projectItems, ...sessionItems];
}

function itemRank(query: string, item: CommandPaletteItem): number {
  const sublabelRank = item.sublabel !== null ? fuzzyMatchRank(query, item.sublabel) : Number.MAX_SAFE_INTEGER;
  return Math.min(fuzzyMatchRank(query, item.label), sublabelRank);
}

export function filterAndRankItems(items: CommandPaletteItem[], query: string): CommandPaletteItem[] {
  return items
    .filter((item) => fuzzyMatches(query, item.label) || (item.sublabel !== null && fuzzyMatches(query, item.sublabel)))
    .slice()
    .sort((a, b) => itemRank(query, a) - itemRank(query, b));
}
