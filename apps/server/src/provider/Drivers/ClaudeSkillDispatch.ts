/**
 * Claude Code's only user-side invocation is a text block whose first character
 * is `/`: the harness expands `/name args` into the SKILL.md body, and every
 * character after the name (newlines included) arrives as `ARGUMENTS`. Only one
 * skill expands per message; a second `/x` becomes argument text
 *    (anthropics/claude-code#87113).
 */

import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";

export interface ClaudeSkillDispatch {
  readonly leadingText: string | undefined;
  /** `/name` plus the trailing text, ready to be the message's last text block. */
  readonly commandText: string;
  readonly skillName: string;
}

export function planClaudeSkillDispatch(
  prompt: string,
  skillNames: ReadonlySet<string>,
): ClaudeSkillDispatch | undefined {
  // The composer treats Markdown code as literal. Appending a delimiter makes
  // a final `$skill` visible to that same parser without changing its range in
  // the source prompt.
  const mentions = collectComposerInlineTokens(`${prompt} `).flatMap((token) =>
    token.type === "skill" && skillNames.has(token.value)
      ? [{ name: token.value, start: token.start, end: token.end }]
      : [],
  );
  const last = mentions.at(-1);
  if (!last) {
    return undefined;
  }

  const leading = prompt.slice(0, last.start);
  const trailing = prompt.slice(last.end);
  const leadingWithInlineSlashes = mentions
    .slice(0, -1)
    .reduceRight(
      (text, mention) =>
        `${text.slice(0, mention.start)}/${mention.name}${text.slice(mention.end)}`,
      leading,
    )
    .trimEnd();

  return {
    leadingText: leadingWithInlineSlashes.length > 0 ? leadingWithInlineSlashes : undefined,
    commandText: `/${last.name}${trailing}`.trimEnd(),
    skillName: last.name,
  };
}
