import { sectionLines } from './items.ts';
import type { GoalBlock } from './types.ts';

const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/;

/**
 * The `## Goal` section of a task file as paragraphs and list items of plain
 * text, for the task details on the progress page. Nested list items are
 * flattened; the task file has the full structure.
 */
export function extractGoal(markdown: string): GoalBlock[] {
  const blocks: GoalBlock[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: plainText(paragraph.join(' ')) });
      paragraph = [];
    }
  };

  for (const line of sectionLines(markdown, 'Goal')) {
    const item = LIST_ITEM.exec(line);
    const last = blocks.at(-1);
    if (item !== null) {
      endParagraph();
      blocks.push({ kind: 'item', text: plainText(item[1] ?? '') });
    } else if (line.trim() === '') {
      endParagraph();
    } else if (/^\s/.test(line) && paragraph.length === 0 && last?.kind === 'item') {
      // An indented line continues the list item above it.
      last.text = `${last.text} ${plainText(line.trim())}`;
    } else {
      paragraph.push(line.trim());
    }
  }
  endParagraph();
  return blocks;
}

/**
 * Inline Markdown as plain text: `[text](href)` becomes `text`, `<https://…>`
 * becomes the URL, and `**strong**` loses its markers. Code spans are left as
 * they are, backticks included, so the page can show them as code.
 */
function plainText(markdown: string): string {
  // Code spans are set aside first, so a link text can hold one and code is never rewritten.
  const codes: string[] = [];
  const masked = markdown.replace(/`[^`]*`/g, (code) => `${CODE}${codes.push(code) - 1}${CODE}`);
  return masked
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(CODE_PLACEHOLDER, (_, index: string) => codes[Number(index)] ?? '');
}

/** A private-use character that marks where a code span was set aside. */
const CODE = '';
const CODE_PLACEHOLDER = /(\d+)/g;
