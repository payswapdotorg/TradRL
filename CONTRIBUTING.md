# Contributing to TradRL

Changes should map to Work Orders.

Every Work Order has one branch, one PR, one worker, a frozen write surface, dependencies, tests and evidence.

Architecture changes require an explicit repository-recorded update before dependent implementation proceeds.

Provider-specific behavior belongs in adapters.

Customer data must never cross tenant boundaries implicitly.

A claim is not evidence until the Tech Lead verifies the actual diff, commands, results and SHAs.