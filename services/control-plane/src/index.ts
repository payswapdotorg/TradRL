// @tradrl/control-plane — the reference Goal/constraint/project control
// plane service over @tradrl/control-domain.
//
// Exports the service surface (createControlPlane, ProjectStore, audit log
// + replay) and re-exports the whole contract surface of
// @tradrl/control-domain so consumers can code against one import site.
//
// Owning Work Order: T007. See README.md for how T012 (evaluation) and
// T016 (organization compiler) consume AcceptanceCriteria and
// ProjectRecords.

export * from '../../../packages/control-domain/src/index';
export * from './store';
export * from './audit';
export * from './service';

export const packageInfo = {
  name: '@tradrl/control-plane',
  owner: 'T007',
  status: 'implemented',
} as const;
