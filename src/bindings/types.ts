export type WriteMode = "replace" | "managed-block";

export interface GeneratedFile {
  /** Path relative to the project root. */
  path: string;
  contents: string;
  /**
   * "replace" owns the whole file (files only this tool writes).
   * "managed-block" splices into a file the user may already own.
   */
  mode?: WriteMode;
}

export interface BindingGenerator {
  name: string;
  /** True when this agent's tooling is present in the project or environment. */
  detect(root: string): boolean;
  generate(): GeneratedFile[];
}
