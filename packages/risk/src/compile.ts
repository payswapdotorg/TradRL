// @tradrl/risk — the constraint compiler: control-domain ConstraintSet
// mirrors -> risk limit records (the PURE function).
//
// THE COMPILATION LAW (the Work Order's scope: "RiskPolicy — ...
// compiled FROM control-domain ConstraintSet mirrors (constraint ->
// limit records — pure function)"; invariant 5 — user risk constraints
// are executable acceptance criteria, and the risk policies COMPILE from
// them (mirrors)): the user's risk constraints are the AUTHORITY the
// limits derive from. {@link compileRiskPolicy} is the pure, total,
// deterministic function over an untrusted constraint-set mirror: the
// same set + scope always compiles to the byte-identical policy
// (content-addressed `rpol:` id).
//
// THE SUBJECT GRAMMAR (declared, over control-domain's identifier-path
// address space — segments start with a letter, so the mapping is
// unambiguous):
//
//   risk.<classKind>                 -> the '*' CATCH-ALL class record
//   risk.<classKind>.<class>         -> the named class record
//   risk.concentration               -> the concentration cap
//   risk.drawdown                    -> the drawdown threshold
//   risk.leverage                    -> the leverage cap
//
// where <classKind> is one of the four T019 limit kinds
// (order_size | order_notional | position_size | position_notional).
// The UNQUALIFIED class subject is the catch-all record because the
// identifier-path grammar has no '*' segment — the unqualified subject
// IS the "every class" declaration (documented interpretation).
//
// THE PREDICATE LAW: a risk cap is a MAXIMUM — only
// `{ kind: 'limit.max', bound }` compiles. Any other predicate kind on a
// risk-bearing subject is the typed `risk_constraint_uncompilable` (the
// author asked for a risk limit this engine cannot express — fail loud,
// never guess). The numeric bound crosses into this lane's exact-decimal
// discipline through the DECLARED bridge (decimals.ts
// `canonicalDecimalOfFiniteNumber` — the shortest round-trip decimal
// form of the literal, never the binary expansion).
//
// THE SEVERITY LAW: only BLOCKING constraints compile into limits (a
// hard control); ADVISORY risk constraints are evaluation-side warnings
// — they ride intents as advisory violations (the T018/T019 mirror
// discipline) and are NOT compiled (documented, never dropped silently:
// they are simply not this lane's business).
//
// THE TOTALITY LAW (mirroring T019's record shape): a class record
// carries ALL FOUR caps — a class with only a partial set of class-kind
// constraints fails compilation (name every missing kind). There are
// NO default caps, NO magic numbers: what was not declared does not
// exist (fail-closed).
//
// Non-risk subjects (not starting with 'risk.') are IGNORED — they are
// the strategy lane's / evaluation lane's constraints (L16: strategic
// and order-level control have distinct clocks and authority). A
// subject starting with 'risk.' that does not match the grammar above
// is the typed `risk_constraint_uncompilable` crime (the author
// intended a risk constraint; the engine refuses to silently drop it).
//
// Spec anchors: spec/DOMAIN-MODEL.md (ConstraintSet), spec/ARCHITECTURE-
// LOCK.md L7, L9, L12, L16.

import { deepFreeze, isPositiveSafeInteger, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import { canonicalDecimalOfFiniteNumber, compare, isZero } from './decimals';
import type { ConcentrationLimit, ClassLimitKind, DrawdownLimit, LeverageLimit, RiskPolicy } from './policy';
import { validateRiskPolicy } from './policy';
import type { ConstraintSetMirror, ConstraintStatementMirror, CriterionPredicateMirror } from './control-mirror';
import { isConstraintSetMirror } from './control-mirror';
import type { GoalVersionRef, ProjectId, RiskPolicyVersionRef, TenantId } from './ids';
import { isGoalVersionRef, isProjectId, isTenantId } from './ids';
import {
  type RiskError,
  type RiskResult,
  invalidField,
  invalidType,
} from './errors';

/** The four class-kind subjects (T019's limit kinds — the class-record caps). */
const CLASS_KINDS: readonly ClassLimitKind[] = ['order_size', 'order_notional', 'position_size', 'position_notional'];

/** The three portfolio-kind subjects (this lane's additions). */
const PORTFOLIO_KINDS = ['concentration', 'drawdown', 'leverage'] as const;

type PortfolioKind = (typeof PORTFOLIO_KINDS)[number];

/** The full risk-subject grammar (unqualified = catch-all for class kinds; qualified = named class). */
const RISK_SUBJECT_PATTERN = /^risk\.(order_size|order_notional|position_size|position_notional|concentration|drawdown|leverage)(?:\.([a-zA-Z][a-zA-Z0-9_]*))?$/;

/** One parsed risk subject. */
interface ParsedSubject {
  readonly kind: ClassLimitKind | PortfolioKind;
  /** The instrument class, or null for the catch-all / portfolio kinds. */
  readonly instrumentClass: string | null;
}

/** Parse a risk-bearing subject; `null` when it does not carry the grammar. */
function parseRiskSubject(subject: string): ParsedSubject | null {
  const match = RISK_SUBJECT_PATTERN.exec(subject);
  if (match === null) return null;
  return { kind: match[1] as ClassLimitKind | PortfolioKind, instrumentClass: match[2] ?? null };
}

/**
 * The compile input: the untrusted constraint-set mirror, the goal the
 * policy serves, the tenant/project scope, the declaration instant, the
 * declared ratio precision (the precision observed concentration/
 * leverage ratios are REPORTED at — comparisons never round), and the
 * optional `supersedes` pointer (a REVISION of the compiled policy —
 * version N compiles superseding version N-1; absent => version 1).
 */
export interface CompileRiskPolicyInput {
  /** The untrusted constraint-set mirror (validated inside — collect-all). */
  readonly constraintSet: unknown;
  /** The untrusted goal version ref this policy's limits serve (L9/L15). */
  readonly goal: unknown;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The declaration instant (epoch ms; no ambient clock). */
  readonly asOf: TimestampMs;
  /** The precision observed ratio measures are reported at (>= 0). */
  readonly ratioPrecision: number;
  /** The version this compiled policy supersedes (null/absent => version 1 — the L11 trail enforces the chain). */
  readonly supersedes?: RiskPolicyVersionRef | null;
}

/**
 * Compile a {@link RiskPolicy} from a control-domain ConstraintSet
 * mirror — the pure function (constraint -> limit records). Fails with:
 *   - `invalid_type`/`invalid_field` — the set fails the mirror guard;
 *   - `tenant_missing` — the set's tenant is not the compiling scope's
 *     (L12 — cross-tenant compilation is inexpressible);
 *   - `risk_constraint_uncompilable` — a risk-bearing constraint whose
 *     predicate is not a `limit.max`, whose bound is not exactly
 *     representable as a positive decimal (or exceeds 1 for
 *     concentration), or whose subject does not carry the grammar; a
 *     class with a PARTIAL set of the four class-kind constraints; a
 *     duplicate (kind, class) declaration;
 *   - plus everything `validateRiskPolicy` enforces (the L7 trip wire
 *     included — compiled limits are bounds, never acceptance).
 * On success the policy is deeply frozen with its content-addressed id
 * (the same inputs always compile to the byte-identical policy).
 */
export function compileRiskPolicy(input: CompileRiskPolicyInput): RiskResult<RiskPolicy> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('compileRiskPolicy requires a compile input object')] };
  }
  if (!isTenantId(input.tenant)) {
    return { ok: false, errors: [{ code: 'tenant_missing', path: 'tenant', message: 'compileRiskPolicy requires a tenant scope (L12)' }] };
  }
  if (!isProjectId(input.project)) {
    return { ok: false, errors: [{ code: 'tenant_missing', path: 'project', message: 'compileRiskPolicy requires a project scope (L12/L15)' }] };
  }
  if (!isTimestampMs(input.asOf)) {
    return { ok: false, errors: [invalidField('asOf', 'compileRiskPolicy requires an epoch-ms declaration instant')] };
  }
  if (typeof input.ratioPrecision !== 'number' || !Number.isSafeInteger(input.ratioPrecision) || input.ratioPrecision < 0) {
    return { ok: false, errors: [invalidField('ratioPrecision', 'compileRiskPolicy requires a non-negative safe integer ratio precision')] };
  }
  if (!isGoalVersionRef(input.goal)) {
    return { ok: false, errors: [{ code: 'lineage_gap', path: 'goal', message: 'compileRiskPolicy requires a goal version ref (the policy serves a goal — L9/L15)' }] };
  }
  if (input.supersedes !== undefined && input.supersedes !== null) {
    if (typeof input.supersedes !== 'object' || !isRecord(input.supersedes)) {
      return { ok: false, errors: [invalidField('supersedes', 'compileRiskPolicy requires supersedes to be a policy version ref or null')] };
    }
    if (typeof input.supersedes.policyId !== 'string' || !input.supersedes.policyId.startsWith('rpol:') || !isPositiveSafeInteger(input.supersedes.version)) {
      return { ok: false, errors: [invalidField('supersedes', 'compileRiskPolicy requires supersedes to be { policyId, version } (the version this one replaces — L11)')] };
    }
  }

  // --- The constraint-set mirror (validated) --------------------------------
  if (!isConstraintSetMirror(input.constraintSet)) {
    return { ok: false, errors: [invalidField('constraintSet', 'compileRiskPolicy requires a structurally valid constraint-set mirror (the T007 mirror guard)')] };
  }
  const set = input.constraintSet;
  if (set.tenantId !== input.tenant) {
    return {
      ok: false,
      errors: [{ code: 'tenant_missing', path: 'constraintSet.tenantId', message: `the constraint set's tenant (${set.tenantId}) is not the compiling scope's (${input.tenant}) — cross-tenant compilation is inexpressible (L12)` }],
    };
  }

  // --- The compile walk ------------------------------------------------------
  const errors: RiskError[] = [];
  const compiledFrom: string[] = [];
  /** (kind, class) -> decimal bound, for the class kinds ('*' the catch-all). */
  const classCaps = new Map<string, Map<ClassLimitKind, string>>();
  let concentration: ConcentrationLimit | null = null;
  let drawdown: DrawdownLimit | null = null;
  let leverage: LeverageLimit | null = null;

  for (let index = 0; index < set.constraints.length; index++) {
    const constraint = set.constraints[index] as ConstraintStatementMirror;
    // Non-risk subjects are the strategy/evaluation lanes' business (L16).
    if (!constraint.subject.startsWith('risk.')) continue;
    // Only BLOCKING constraints compile into hard limits; advisories ride
    // intents (documented — never silently dropped by the STRATEGY lane).
    if (constraint.severity !== 'blocking') continue;

    const parsed = parseRiskSubject(constraint.subject);
    if (parsed === null) {
      errors.push({
        code: 'risk_constraint_uncompilable',
        path: `constraintSet.constraints[${index}].subject`,
        message: `risk subject "${constraint.subject}" does not carry the grammar (risk.<classKind>[.<class>] | risk.<portfolioKind>) — the author intended a risk constraint this engine cannot compile`,
      });
      continue;
    }
    if (constraint.domain !== 'state' && constraint.domain !== 'action') {
      errors.push({
        code: 'risk_constraint_uncompilable',
        path: `constraintSet.constraints[${index}].domain`,
        message: `a risk limit governs STATE or ACTION (got "${constraint.domain}") — observations and outcomes are the evaluation lane's measures (L7/L16)`,
      });
      continue;
    }
    // The predicate law: a risk cap is a MAXIMUM.
    const predicate = constraint.predicate as CriterionPredicateMirror;
    if (predicate.kind !== 'limit.max') {
      errors.push({
        code: 'risk_constraint_uncompilable',
        path: `constraintSet.constraints[${index}].predicate`,
        message: `a risk cap is a limit.max (got "${predicate.kind}") — minima, ranges, equalities and flags are not compilable caps`,
      });
      continue;
    }
    // The exact-decimal bridge: the bound compiles to its shortest
    // round-trip decimal form, never the binary expansion.
    const boundDecimal = canonicalDecimalOfFiniteNumber(predicate.bound);
    if (boundDecimal === null) {
      errors.push({
        code: 'risk_constraint_uncompilable',
        path: `constraintSet.constraints[${index}].predicate.bound`,
        message: `the bound ${String(predicate.bound)} is not exactly representable as a decimal — an inexact bound never enters a money path`,
      });
      continue;
    }
    if (isZero(boundDecimal)) {
      errors.push({
        code: 'risk_constraint_uncompilable',
        path: `constraintSet.constraints[${index}].predicate.bound`,
        message: 'a zero cap is inexpressible — refuse by policy shape, not by magic numbers (prohibit a class through its absence, or a venue through T019\'s allowlist)',
      });
      continue;
    }

    if (parsed.instrumentClass !== null && CLASS_KINDS.includes(parsed.kind as ClassLimitKind)) {
      // A class-kind cap for a NAMED class.
      const kind = parsed.kind as ClassLimitKind;
      const key = parsed.instrumentClass;
      let caps = classCaps.get(key);
      if (caps === undefined) {
        caps = new Map<ClassLimitKind, string>();
        classCaps.set(key, caps);
      }
      if (caps.has(kind)) {
        errors.push({
          code: 'risk_constraint_uncompilable',
          path: `constraintSet.constraints[${index}].subject`,
          message: `duplicate cap for (${key}, ${kind}) — one constraint per class-kind`,
        });
        continue;
      }
      caps.set(kind, boundDecimal);
      compiledFrom.push(constraint.id);
      continue;
    }

    if (parsed.instrumentClass === null && CLASS_KINDS.includes(parsed.kind as ClassLimitKind)) {
      // The UNQUALIFIED class subject: the '*' catch-all record.
      const kind = parsed.kind as ClassLimitKind;
      let caps = classCaps.get('*');
      if (caps === undefined) {
        caps = new Map<ClassLimitKind, string>();
        classCaps.set('*', caps);
      }
      if (caps.has(kind)) {
        errors.push({
          code: 'risk_constraint_uncompilable',
          path: `constraintSet.constraints[${index}].subject`,
          message: `duplicate cap for (*, ${kind}) — one constraint per class-kind`,
        });
        continue;
      }
      caps.set(kind, boundDecimal);
      compiledFrom.push(constraint.id);
      continue;
    }

    // The portfolio kinds.
    const portfolioKind = parsed.kind as PortfolioKind;
    if (portfolioKind === 'concentration') {
      if (concentration !== null) {
        errors.push({
          code: 'risk_constraint_uncompilable',
          path: `constraintSet.constraints[${index}].subject`,
          message: 'duplicate concentration cap — one constraint per portfolio kind',
        });
        continue;
      }
      if (compare(boundDecimal, '1') > 0) {
        errors.push({
          code: 'risk_constraint_uncompilable',
          path: `constraintSet.constraints[${index}].predicate.bound`,
          message: `the concentration cap (${boundDecimal}) exceeds 1 — a share of gross notional cannot exceed the whole`,
        });
        continue;
      }
      concentration = deepFreeze({ maxConcentrationRatio: boundDecimal, ratioPrecision: input.ratioPrecision });
      compiledFrom.push(constraint.id);
      continue;
    }
    if (portfolioKind === 'drawdown') {
      if (drawdown !== null) {
        errors.push({
          code: 'risk_constraint_uncompilable',
          path: `constraintSet.constraints[${index}].subject`,
          message: 'duplicate drawdown threshold — one constraint per portfolio kind',
        });
        continue;
      }
      drawdown = deepFreeze({ maxDrawdown: boundDecimal });
      compiledFrom.push(constraint.id);
      continue;
    }
    // portfolioKind === 'leverage'
    if (leverage !== null) {
      errors.push({
        code: 'risk_constraint_uncompilable',
        path: `constraintSet.constraints[${index}].subject`,
        message: 'duplicate leverage cap — one constraint per portfolio kind',
      });
      continue;
    }
    leverage = deepFreeze({ maxLeverageRatio: boundDecimal, ratioPrecision: input.ratioPrecision });
    compiledFrom.push(constraint.id);
  }

  // --- The class-record totality law (all four caps per class) ----------------
  const classLimits = [];
  for (const [instrumentClass, caps] of [...classCaps.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const missing = CLASS_KINDS.filter((kind) => !caps.has(kind));
    if (missing.length > 0) {
      errors.push({
        code: 'risk_constraint_uncompilable',
        path: `constraintSet.constraints`,
        message: `class "${instrumentClass}" declares only [${[...caps.keys()].join(', ')}] — a class record carries ALL FOUR caps (${CLASS_KINDS.join(', ')}); missing: ${missing.join(', ')} (no default caps — what was not declared does not exist)`,
      });
      continue;
    }
    classLimits.push(deepFreeze({
      instrumentClass,
      maxOrderSize: caps.get('order_size') as string,
      maxOrderNotional: caps.get('order_notional') as string,
      maxPositionSize: caps.get('position_size') as string,
      maxPositionNotional: caps.get('position_notional') as string,
    }));
  }

  if (errors.length > 0) return { ok: false, errors };

  // --- Assemble and validate through the policy's own collect-all -------------
  const version = input.supersedes === undefined || input.supersedes === null ? 1 : input.supersedes.version + 1;
  const declaration = {
    version,
    supersedes: input.supersedes === undefined || input.supersedes === null ? null : { policyId: input.supersedes.policyId, version: input.supersedes.version },
    tenant: input.tenant,
    project: input.project,
    goal: input.goal,
    constraintSet: { id: set.id, version: set.version },
    classLimits,
    concentration,
    drawdown,
    leverage,
    compiledFrom,
    asOf: input.asOf,
  };
  return validateRiskPolicy(declaration, 'compiledPolicy');
}
