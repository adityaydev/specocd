export const BLOCK_START = "<!-- BEGIN specocd (generated — edits inside this block are overwritten) -->";
export const BLOCK_END = "<!-- END specocd -->";

/**
 * Splices generated content into a file that may already hold hand-written content
 * (AGENTS.md, copilot-instructions.md). Only the delimited block is ever replaced,
 * so we never clobber what the user wrote.
 */
export function applyManagedBlock(existing: string | null, contents: string): string {
  const block = `${BLOCK_START}\n\n${contents.trim()}\n\n${BLOCK_END}`;
  if (existing === null || existing.trim() === "") return block + "\n";

  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  if (start !== -1 && end !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + BLOCK_END.length);
  }
  return existing.trimEnd() + "\n\n" + block + "\n";
}
