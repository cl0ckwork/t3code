export type ComposerInlineToken =
  | {
      readonly type: "mention";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly type: "skill";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    };

export interface CollectComposerInlineTokensOptions {
  readonly preserveTrailingFrom?: ReadonlyArray<ComposerInlineToken>;
  /**
   * Frontends may render known provider slash skills as inline chips. This is
   * intentionally opt-in: server-side skill extraction remains `$`-only so a
   * provider command such as `/plan` can never become a Codex skill input.
   */
  readonly knownSlashSkillNames?: ReadonlySet<string>;
}

interface MarkdownCodeRange {
  readonly start: number;
  readonly end: number;
  readonly isUnclosed: boolean;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function lineEndAfter(text: string, start: number): number {
  const newline = text.indexOf("\n", start);
  return newline === -1 ? text.length : newline + 1;
}

/**
 * Returns Markdown source ranges where composer syntax is literal code rather
 * than an instruction. The composer intentionally uses lightweight source
 * parsing here: it runs on every draft update, while a full Markdown parser
 * would be both heavier and would not preserve the exact source ranges needed
 * by inline chips.
 */
function collectMarkdownCodeRanges(text: string): ReadonlyArray<MarkdownCodeRange> {
  const fencedRanges: MarkdownCodeRange[] = [];
  let lineStart = 0;
  let openFence: { readonly marker: string; readonly start: number } | undefined;

  while (lineStart < text.length) {
    const lineEnd = lineEndAfter(text, lineStart);
    const line = text.slice(lineStart, lineEnd);
    const fence = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);

    if (!openFence) {
      if (fence && !isEscaped(text, lineStart + (fence[0].length - (fence[1]?.length ?? 0)))) {
        openFence = { marker: fence[1] ?? "", start: lineStart };
      }
    } else if (fence) {
      const marker = fence[1] ?? "";
      if (
        marker[0] === openFence.marker[0] &&
        marker.length >= openFence.marker.length &&
        /^[ \t]*(?:\n|$)/.test(line.slice(fence[0].length))
      ) {
        fencedRanges.push({ start: openFence.start, end: lineEnd, isUnclosed: false });
        openFence = undefined;
      }
    }

    lineStart = lineEnd;
  }

  if (openFence) {
    fencedRanges.push({ start: openFence.start, end: text.length, isUnclosed: true });
  }

  const inlineRanges: MarkdownCodeRange[] = [];
  let cursor = 0;
  let fenceIndex = 0;
  let openInline: { readonly marker: string; readonly start: number } | undefined;
  while (cursor < text.length) {
    let fencedRange = fencedRanges[fenceIndex];
    while (fencedRange && fencedRange.end <= cursor) {
      fenceIndex += 1;
      fencedRange = fencedRanges[fenceIndex];
    }
    if (fencedRange && fencedRange.start <= cursor) {
      cursor = fencedRange.end;
      continue;
    }

    if (text[cursor] !== "`" || isEscaped(text, cursor)) {
      cursor += 1;
      continue;
    }

    let markerEnd = cursor + 1;
    while (text[markerEnd] === "`") {
      markerEnd += 1;
    }
    const marker = text.slice(cursor, markerEnd);

    if (!openInline) {
      openInline = { marker, start: cursor };
    } else if (marker === openInline.marker) {
      inlineRanges.push({ start: openInline.start, end: markerEnd, isUnclosed: false });
      openInline = undefined;
    }
    cursor = markerEnd;
  }

  if (openInline) {
    inlineRanges.push({ start: openInline.start, end: text.length, isUnclosed: true });
  }

  return [...fencedRanges, ...inlineRanges].toSorted((left, right) => left.start - right.start);
}

function rangeOverlapsMarkdownCode(
  ranges: ReadonlyArray<MarkdownCodeRange>,
  start: number,
  end: number,
): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

/** True when the composer cursor is inside a fenced or inline Markdown code span. */
export function isComposerMarkdownCodePosition(text: string, position: number): boolean {
  const cursor = Math.max(0, Math.min(text.length, Math.floor(position)));
  return collectMarkdownCodeRanges(text).some(
    (range) =>
      range.start <= cursor && (cursor < range.end || (range.isUnclosed && cursor === range.end)),
  );
}

/**
 * A skill name may start with a digit, but compact monetary amounts and
 * numeric expressions like "$20", "$20k", "$100M", and "$1e6" must stay prose:
 * the composer chips any matched `$name` token, known or not. Tokens beginning
 * with digits must not match numbers with currency/exponent suffixes, and must
 * contain at least one letter.
 */
const SKILL_TOKEN_REGEX =
  /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s)/gu;
const SLASH_SKILL_TOKEN_REGEX = /(^|\s)\/([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s)/g;
const MENTION_TOKEN_REGEX = /(^|\s)@(?:"((?:\\.|[^"\\])*)"|([^\s@"]+))(?=\s)/g;
/**
 * The label body is bounded rather than `*`. Unbounded, every whitespace in
 * the composer is a candidate start: the engine scans the rest of the text for
 * a closing `]`, fails, and rescans from the next whitespace — quadratic on
 * input like " [[[[[…". A cap makes each attempt constant-bounded.
 *
 * Only a basename ever survives the `label !== basename` check below, so this
 * cannot reject a link a user could meaningfully write; the longest filename
 * any common filesystem allows is 255.
 */
const MAX_FILE_LINK_LABEL_LENGTH = 512;
const FILE_LINK_TOKEN_REGEX = new RegExp(
  `(^|\\s)\\[((?:\\\\.|[^\\]\\\\]){0,${MAX_FILE_LINK_LABEL_LENGTH}})\\]\\(([^)\\s]+)\\)(?=\\s)`,
  "g",
);
const URI_SCHEME_REGEX = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:[\\/]/;
// Autocomplete emits canonical file links, so ambiguous bare @scope/package text stays a package.
const SCOPED_PACKAGE_REFERENCE_REGEX =
  /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?:\/[^\s@"]+)*$/;

function collectMentionTokens(text: string): ComposerInlineToken[] {
  const matches: ComposerInlineToken[] = [];

  for (const match of text.matchAll(FILE_LINK_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const label = (match[2] ?? "").replace(/\\(.)/g, "$1");
    const encodedPath = match[3] ?? "";
    let path = encodedPath;
    try {
      path = decodeURIComponent(encodedPath);
    } catch {
      // Preserve malformed source rather than dropping a user-authored token.
    }
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const basename = separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
    const hasExternalScheme = URI_SCHEME_REGEX.test(path) && !WINDOWS_DRIVE_PATH_REGEX.test(path);
    if (!path || hasExternalScheme || label !== basename) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "mention",
      value: path,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  for (const match of text.matchAll(MENTION_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const quotedPath = match[2];
    const path = quotedPath !== undefined ? quotedPath.replace(/\\(.)/g, "$1") : (match[3] ?? "");
    if (!path || (quotedPath === undefined && SCOPED_PACKAGE_REFERENCE_REGEX.test(path))) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "mention",
      value: path,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  return matches;
}

export function collectComposerInlineTokens(
  text: string,
  options: CollectComposerInlineTokensOptions = {},
): ReadonlyArray<ComposerInlineToken> {
  const markdownCodeRanges = collectMarkdownCodeRanges(text);
  const matches = collectMentionTokens(text).filter(
    (match) => !rangeOverlapsMarkdownCode(markdownCodeRanges, match.start, match.end),
  );

  for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const value = match[2] ?? "";
    if (!value) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    if (rangeOverlapsMarkdownCode(markdownCodeRanges, start, end)) {
      continue;
    }
    matches.push({
      type: "skill",
      value,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  const knownSlashSkillNames = options.knownSlashSkillNames;
  if (knownSlashSkillNames && knownSlashSkillNames.size > 0) {
    for (const match of text.matchAll(SLASH_SKILL_TOKEN_REGEX)) {
      const fullMatch = match[0];
      const prefix = match[1] ?? "";
      const value = match[2] ?? "";
      if (!value || !knownSlashSkillNames.has(value)) {
        continue;
      }
      const start = (match.index ?? 0) + prefix.length;
      const end = start + fullMatch.length - prefix.length;
      if (rangeOverlapsMarkdownCode(markdownCodeRanges, start, end)) {
        continue;
      }
      matches.push({
        type: "skill",
        value,
        source: text.slice(start, end),
        start,
        end,
      });
    }
  }

  for (const token of options.preserveTrailingFrom ?? []) {
    if (
      token.end === text.length &&
      text.slice(token.start, token.end) === token.source &&
      !rangeOverlapsMarkdownCode(markdownCodeRanges, token.start, token.end) &&
      !matches.some(
        (match) =>
          match.type === token.type && match.start === token.start && match.end === token.end,
      )
    ) {
      matches.push(token);
    }
  }

  return [...matches].sort((left, right) => left.start - right.start);
}
