import { loadConfig, saveConfig } from "../config.js";
import { BINDING_NAMES, detectBindings, unknownBindings, writeBindings } from "../bindings/index.js";

export interface BindingsListing {
  available: string[];
  detected: string[];
  enabled: string[];
}

export function listBindings(root: string): BindingsListing {
  return {
    available: BINDING_NAMES,
    detected: detectBindings(root),
    enabled: loadConfig(root).enabled_bindings,
  };
}

export interface SyncResult {
  bindings: string[];
  files: string[];
}

/**
 * Regenerates binding files. By default it covers everything already enabled plus
 * anything newly detected, so adding a tool to a project picks it up on next sync.
 */
export function syncBindings(root: string, opts: { all?: boolean; only?: string[] } = {}): SyncResult {
  const config = loadConfig(root);

  let names: string[];
  if (opts.only && opts.only.length > 0) {
    const unknown = unknownBindings(opts.only);
    if (unknown.length > 0) {
      throw new Error(`Unknown binding(s): ${unknown.join(", ")}. Available: ${BINDING_NAMES.join(", ")}`);
    }
    names = opts.only;
  } else if (opts.all) {
    names = [...BINDING_NAMES];
  } else {
    names = [...new Set([...config.enabled_bindings, ...detectBindings(root)])];
  }

  const files = writeBindings(root, names);
  saveConfig(root, { ...config, enabled_bindings: names });
  return { bindings: names, files };
}
