import type { ServerProviderSkill } from "@t3tools/contracts";

/**
 * Claude expands one skill per message only when `/name` starts the text block.
 * Everything after the name, including newlines or a second `/x`, becomes `ARGUMENTS`.
 * https://github.com/anthropics/claude-code/issues/87113
 */

import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";

export type ClaudeSkillTarget = Pick<ServerProviderSkill, "path" | "userInvocationOnly">;

export interface ClaudeSkillDispatch {
  /** The whole prompt with mentions as `/name`, or `undefined` when the mention opens it. */
  readonly leadingText: string | undefined;
  /** `/name` plus the trailing text, ready to be the message's last text block. */
  readonly commandText: string;
}

export function planClaudeSkillDispatch(
  prompt: string,
  skills: ReadonlyMap<string, ClaudeSkillTarget>,
): ClaudeSkillDispatch | undefined {
  // The composer treats Markdown code as literal. Appending a delimiter makes
  // a final `$skill` visible to that same parser without changing its range in
  // the source prompt.
  const mentions = collectComposerInlineTokens(`${prompt} `).flatMap((token) => {
    if (token.type !== "skill") return [];
    const skill = skills.get(token.value);
    return skill ? [{ name: token.value, skill, start: token.start, end: token.end }] : [];
  });
  const last = mentions.at(-1);
  if (!last) {
    return undefined;
  }

  // Only the final skill gets native expansion. Earlier user-only skills need
  // a fallback to their raw file because Claude's Skill tool refuses them.
  const annotated = new Set([last.name]);
  let promptWithInlineSlashes = "";
  let cursor = 0;
  for (const mention of mentions) {
    promptWithInlineSlashes += `${prompt.slice(cursor, mention.start)}/${mention.name}`;
    if (mention.skill.userInvocationOnly === true && !annotated.has(mention.name)) {
      promptWithInlineSlashes += ` [The user invoked this skill. Follow the instructions at: ${mention.skill.path}]`;
      annotated.add(mention.name);
    }
    cursor = mention.end;
  }
  promptWithInlineSlashes = `${promptWithInlineSlashes}${prompt.slice(cursor)}`.trimEnd();

  return {
    leadingText:
      prompt.slice(0, last.start).trim().length > 0 ? promptWithInlineSlashes : undefined,
    commandText: `/${last.name}${prompt.slice(last.end)}`.trimEnd(),
  };
}
