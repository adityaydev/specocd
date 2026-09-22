export interface GeneratedFile {
  /** Path relative to the project root. */
  path: string;
  contents: string;
}

export interface BindingGenerator {
  name: string;
  /** True when this agent's tooling is present in the project or environment. */
  detect(root: string): boolean;
  generate(): GeneratedFile[];
}
