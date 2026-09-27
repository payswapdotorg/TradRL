# TradRL Worker Runbook

## Receive
Read governance, architecture, dependencies and assigned Work Order.

## Verify base
Record repository, branch, Work Order and exact base SHA.

## Implement
Stay inside frozen write surfaces. Do not absorb adjacent work.

## Verify
Run positive, negative, contract, deterministic/reproducibility and security checks applicable to the Work Order.

## Report
PR body must contain: Work Order; Dispatch base SHA; Final head SHA; Write surfaces; Commands; Results; Evidence; Limitations; Security impact; Architecture impact.

## Merge
Worker does not merge. Tech Lead verifies actual diff and evidence.

## Drift prevention
No routine sibling rebases. No shared root manifest/lockfile changes during parallel waves. Adjacent work becomes a proposed Work Order.