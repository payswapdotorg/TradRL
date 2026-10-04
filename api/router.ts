// api/router.ts — the Vercel function-discovery shim (T052 follow-up, W-3h).
//
// Vercel builds Serverless Functions ONLY from the repo-root api/
// directory; the deployment's real function lives at
// deploy/vercel/api/router.ts (the frozen-sibling law: this shim
// re-exports it and adds nothing of its own).
export { default } from '../deploy/vercel/api/router';
