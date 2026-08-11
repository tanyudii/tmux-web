// Diff-line rendering for ChangesDialog.tsx -- ports the read side of
// kmp/.../ui/terminal/ChangesDialog.kt's TmuxDiffDialog, consuming
// domain/diffLineParser.ts's already-computed ParsedDiff/DiffHunk/DiffRow
// structures (parsing itself happens in stores/changesStore.ts).
//
// Deliberately not ported: per-token syntax highlighting
// (domain/syntaxHighlighter.ts). Add/delete/context coloring already
// carries the information a diff review actually needs; tokenizing every
// line for keyword/string/comment color is a visual nice-to-have, not
// covered by this pass -- noted rather than silently dropped.
import { For, Show } from "solid-js";
import type { ParsedDiff } from "../domain/diffLineParser";

export interface DiffViewProps {
  parsedDiff: ParsedDiff;
}

export function DiffView(props: DiffViewProps) {
  return (
    <div class="tw-diff-view">
      <div class="tw-diff-view__summary">
        <span class="tw-diff-view__additions">+{props.parsedDiff.additions}</span>
        <span class="tw-diff-view__deletions">-{props.parsedDiff.deletions}</span>
      </div>
      <For each={props.parsedDiff.hunks}>
        {(hunk) => (
          <div class="tw-diff-view__hunk">
            <div class="tw-diff-view__hunk-header">{hunk.header}</div>
            <For each={hunk.lines}>
              {(row) => (
                <div class="tw-diff-view__row" data-row-type={row.type}>
                  <span class="tw-diff-view__lineno">{row.oldLineNo ?? ""}</span>
                  <span class="tw-diff-view__lineno">{row.newLineNo ?? ""}</span>
                  <span class="tw-diff-view__content">
                    <Show when={row.segments} fallback={row.content}>
                      <For each={row.segments ?? []}>
                        {(segment) => (
                          <span classList={{ "tw-diff-view__segment--changed": segment.changed }}>
                            {segment.text}
                          </span>
                        )}
                      </For>
                    </Show>
                  </span>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
