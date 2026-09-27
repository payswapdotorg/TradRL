/**
 * Type declarations for scripts/program/check.mjs (zero-dependency Node tooling).
 * The implementation stays plain ESM JavaScript so CI can run it without a build step.
 */

export interface WorkItemRow {
  id: string;
  title: string;
  deps: string[];
  writeSurface: string[];
}

export interface GraphItem {
  id: string;
  title: string;
  deps: string[];
  write_surface: string[];
  status: 'blocked' | 'ready' | 'in_progress' | 'in_review' | 'merged';
  branch: string | null;
  pr: number | null;
  merged_sha: string | null;
  evidence: string[];
}

export interface ProgramGraph {
  schema_version: number;
  program: string;
  updated_at: string;
  policies?: {
    max_concurrent_work_orders?: number;
    allowed_statuses?: string[];
    merge_method?: string;
    branch_prefix?: string;
  };
  items: GraphItem[];
}

export interface ValidationOutput {
  violations: string[];
  warnings: string[];
  frontier: string[];
  stats: {
    total: number;
    merged: string[];
    active: string[];
    frontier: string[];
  };
}

export interface ValidateInput {
  graph: ProgramGraph;
  workItems: Map<string, WorkItemRow>;
  depGraph: Map<string, string[]>;
  maxConcurrent?: number;
  /** Item ids the world must contain; defaults to the full T001–T050 program. */
  expectedIds?: string[];
}

export declare const WORK_ITEMS_PATH: string;
export declare const DEP_GRAPH_PATH: string;
export declare const GRAPH_JSON_PATH: string;

export declare function splitRow(line: string): string[];
export declare function parseWorkItems(md: string): Map<string, WorkItemRow>;
export declare function parseDependencyGraph(md: string): Map<string, string[]>;
export declare function loadGraph(json: string | ProgramGraph): ProgramGraph;
export declare function surfacesOverlap(a: string, b: string): boolean;
export declare function validate(input: ValidateInput): ValidationOutput;
export declare function run(): { violations: string[]; stats: ValidationOutput['stats'] };
