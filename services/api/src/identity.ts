// @tradrl/api-service — package identity (the governance surface).

/** Package identity and ownership. */
export const packageInfo = {
  name: '@tradrl/api-service',
  owner: 'T041',
  status: 'implemented',
  concepts: [
    'ApiService (the public/private boundary)',
    'request pipeline (authn -> authz -> tenant-context -> rate limit -> validation -> handler -> audit -> response)',
    'two auth planes (public /v1 + private /internal — wrong_auth_plane typed 403)',
    'usage metering (R41 hooks — record only)',
    'idempotency (consequential routes — replays dedupe to the original result)',
    'execution forwarding (L8 — the T040 gateway port is the only execution path)',
    'cross_tenant_access at the routing layer (L12)',
    'gate_bypass_attempt (L8 — submitted authority is refused)',
  ],
} as const;
