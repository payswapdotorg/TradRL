# The replay-station TL log — the recycle-proof record for every future TL instance

**Why this file exists:** sandbox recycles roll the station (`/home/z/my-project`)
back to a ~2026-10-14 15:2xZ snapshot every ~3-6h. Anything written to the
station AFTER the snapshot point evaporates on the next recycle. The repo
(git main), the production origin, the chat.z.ai account, and the
browser-profile + login_keeper token machinery are the only durable stores.
**Bank post-snapshot station work repo-side, or re-arm from here after each recycle.**

## The recycle ledger (observed by the takeover TL era)

| # | ~Time (Z) | What it took | What survived |
|---|---|---|---|
| 10 | 10-14 ~11:12 | /home/z/replay2 + ~/.secrets + the python core | gateway mini-service, browser-profile, durable token, worklog (to snapshot) |
| 11 | 10-14 ~17:57 | ~/.secrets + the TradRL clone | the durable stack auto-recovered at boot (D-056) |
| 12 | 10-14 ~21:32 | ~/.secrets + clones; station still at snapshot | stack auto-recovered; token re-captured 21:34Z |
| 13 | 10-15 ~00:02 | ~/.secrets + clones + ALL post-snapshot station work (mission rewrite, agents-tab fix, FW-54 pre-study, worklog Tasks 6-7) | stack auto-recovered (5 ports); token re-captured 00:03:54Z; transcripts (in-snapshot) |

## The station shape (post-recycle re-arm runbook, ~10 min)

1. **Stack check** (auto-recovers): ports 3000 (console) / 3100 (gateway) / 3110 (replay-core) / 9222 (Chrome CDP) / 81 (Caddy). Token: `/home/z/my-project/download/zai_session_token.txt` (login_keeper re-captures within ~2 min of boot; verify with a chat.z.ai API call).
2. **Vault re-seed**: `~/.secrets/env.sh` from the operator's standing batch (23 keys; a copy belongs at `browser-profile/ops-vault.env`, chmod 600). The batch lives in the operator's chat context, NOT the repo — never commit secrets.
3. **Clone**: `git clone https://x-access-token:$GITHUB_PAT@github.com/payswapdotorg/TradRL.git /home/z/TradRL`.
4. **Console truth re-arm** (station-only, re-apply each time): rewrite `ops/mission-state.json` to the final tally (9/9 YES · 7 SWITCH + 2 pilot-deferred · O-3R CLOSED · sourceOfTruth = git main <SHA>); fix `src/components/console/agents-tab.tsx` headings to derive from the feed (the snapshot carries hardcoded "4 seats"/"5/9"); `bun run lint` + browser-verify.
5. **Station work to re-bank**: the FW-54 capacity pre-study (2026-10-14 22:0xZ run: smoke 7/7 · items=43 · meta avg 269ms · C2 401/403 typed · provider planes DNS-blocked from the sandbox — api.neon.tech + *.upstash.io ENOTFOUND, the 4 Neon keys + 2 Upstash tokens on file UNVERIFIED from this station).

## The standing facts (as of D-057, 2026-10-15 00:0xZ)

- Campaign evidence complete: 12 banked seat transcripts (station `ops/round-p/`, in-snapshot) + both round reports + LAUNCH-GATE-SIGNOFF-REQUEST.md (repo main).
- The operator's two decisions (sign-off verdict; live-data pilot) remain OPEN — the 2026-10-14 24:00 Africa/Accra window elapsed with the verdict unrecorded (D-057).
- Production healthy: the 4d04219 build serving; smoke re-verified 7/7 twice post-recycle (21:3xZ era + 22:0xZ); the credential surface = the served console shell's embedded config token (the D-055 law).
- chat.z.ai workspace at rest: 359 chats, newest = L1 re-poll (10-14 14:27Z, completed); the `status:"active"` field is stale metadata on historical chats, NOT live runs.
