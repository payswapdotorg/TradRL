import { describe, expect, it } from 'vitest';
import { Lesson, isLesson, isLessonProvenance, isLessonStatus } from './lesson';
import { Timestamp } from './primitives';
import {
  CapabilityGapId,
  ExperimentId,
  LessonId,
  OutcomeId,
  PostMortemId,
  ProjectId,
  TenantId,
} from './ids';

const ts = (s: string) => s as Timestamp;

const lesson1 = 'lesson_1' as LessonId;
const tenant1 = 'tenant_1' as TenantId;
const prj1 = 'prj_1' as ProjectId;
const out1 = 'out_1' as OutcomeId;
const pm1 = 'pm_1' as PostMortemId;
const gap2 = 'gap_execution_2' as CapabilityGapId;
const exp9 = 'exp_9' as ExperimentId;

function validLesson(): Lesson {
  return {
    id: lesson1,
    tenantId: tenant1,
    projectId: prj1,
    learnedAt: ts('2027-02-01T12:00:00Z'),
    statement: 'Momentum regime confidence degrades sharply when depth thins before session rollover.',
    detail:
      'Observed on 3 projects: signals fired into thin books and slippage erased the edge; gate scale-ins on depth percentiles.',
    status: 'validated',
    provenance: { outcomeId: out1, postMortemId: pm1 },
    capabilityGapId: gap2,
    tags: ['execution', 'regime', 'liquidity'],
  };
}

describe('isLesson — acceptance', () => {
  it('accepts a fully valid provenance-bound lesson', () => {
    expect(isLesson(validLesson())).toBe(true);
  });

  it('accepts a candidate lesson with a single provenance reference', () => {
    const candidate: Lesson = {
      ...validLesson(),
      status: 'candidate',
      provenance: { experimentId: exp9 },
      detail: undefined,
      tags: undefined,
    };
    expect(isLesson(candidate)).toBe(true);
  });
});

describe('isLesson — rejection', () => {
  it('rejects malformed lessons', () => {
    const invalid: unknown[] = [
    { ...validLesson(), id: '' },
    { ...validLesson(), tenantId: '' }, // tenant scope mandatory (L12)
    { ...validLesson(), projectId: '' }, // provenance-bound: learned in a project
    { ...validLesson(), learnedAt: '2027-02-01T12:00:00' },
    { ...validLesson(), statement: '' },
    { ...validLesson(), detail: '' },
    { ...validLesson(), status: 'draft' },
    { ...validLesson(), provenance: {} }, // at least one reference required
    { ...validLesson(), provenance: { outcomeId: '' } },
    { ...validLesson(), provenance: { experimentId: 7 } },
    { ...validLesson(), provenance: null },
    { ...validLesson(), capabilityGapId: '' },
    { ...validLesson(), tags: [''] },
    { ...validLesson(), tags: 'execution' },
    null,
  ];
    for (const l of invalid) expect(isLesson(l)).toBe(false);
  });
});

describe('isLessonProvenance', () => {
  it('requires at least one valid reference', () => {
    expect(isLessonProvenance({ outcomeId: 'out_1' })).toBe(true);
    expect(isLessonProvenance({ experimentId: 'exp_1' })).toBe(true);
    expect(isLessonProvenance({ evidenceCapsuleId: 'ev_1' })).toBe(true);
    expect(isLessonProvenance({ postMortemId: 'pm_1' })).toBe(true);
    expect(isLessonProvenance({})).toBe(false); // provenance-free lessons are not lessons
    expect(isLessonProvenance(null)).toBe(false);
    expect(isLessonProvenance('outcome')).toBe(false);
  });
});

describe('status vocabulary', () => {
  it('lesson statuses are candidate/validated/retired', () => {
    for (const s of ['candidate', 'validated', 'retired']) {
      expect(isLessonStatus(s)).toBe(true);
    }
    expect(isLessonStatus('active')).toBe(false);
  });
});
