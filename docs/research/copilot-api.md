# GitHub Copilot Internal API Research

Discovered by reverse-engineering the Copilot CLI app bundle at
`~/Library/Caches/copilot/pkg/darwin-arm64/<version>/app.js` and confirmed
with live calls on 2026-06-02.

---

## The API

### Endpoint

```
GET https://api.github.com/copilot_internal/user
```

### Authentication

Bearer token from the user's existing GitHub CLI session:

```bash
gh auth token   # returns the active GitHub OAuth token
```

The token is a standard GitHub OAuth token scoped to the user's Copilot
subscription. The Copilot CLI itself uses the same token to authenticate all
`copilot_internal/*` requests. No additional auth steps, device codes, or
separate Copilot-specific credentials are required — if the user can run
`copilot`, they already have a valid token.

Request headers:

```
Authorization: Bearer <gh auth token>
Accept: application/json
```

### Response

Live response from a `copilot_standalone_seat_quota` business plan user:

```json
{
  "login": "ben-ripley",
  "access_type_sku": "copilot_standalone_seat_quota",
  "analytics_tracking_id": "e8209058fd10c3fb1a02fbdd008b8a1a",
  "assigned_date": "2025-02-12T15:42:37-05:00",
  "can_signup_for_limited": false,
  "chat_enabled": true,
  "cli_enabled": true,
  "copilotignore_enabled": false,
  "copilot_plan": "business",
  "editor_preview_features_enabled": true,
  "is_mcp_enabled": true,
  "organization_login_list": [],
  "organization_list": [],
  "restricted_telemetry": false,
  "cli_remote_control_enabled": false,
  "endpoints": {
    "api": "https://api.business.githubcopilot.com",
    "origin-tracker": "https://origin-tracker.business.githubcopilot.com",
    "proxy": "https://proxy.business.githubcopilot.com",
    "telemetry": "https://telemetry.business.githubcopilot.com"
  },
  "can_upgrade_plan": false,
  "quota_reset_date": "2026-07-01",
  "quota_reset_date_utc": "2026-07-01T00:00:00.000Z",
  "token_based_billing": true,
  "quota_snapshots": {
    "chat": {
      "quota_id": "chat",
      "unlimited": true,
      "has_quota": false,
      "entitlement": 0,
      "remaining": 0,
      "quota_remaining": 0.0,
      "percent_remaining": 100.0,
      "overage_count": 0,
      "overage_permitted": false,
      "quota_reset_at": 0,
      "timestamp_utc": "2026-06-02T13:41:20.798Z",
      "token_based_billing": true
    },
    "completions": {
      "quota_id": "completions",
      "unlimited": true,
      "has_quota": false,
      "entitlement": 0,
      "remaining": 0,
      "quota_remaining": 0.0,
      "percent_remaining": 100.0,
      "overage_count": 0,
      "overage_permitted": false,
      "quota_reset_at": 0,
      "timestamp_utc": "2026-06-02T13:41:20.798Z",
      "token_based_billing": true
    },
    "premium_interactions": {
      "quota_id": "premium_interactions",
      "unlimited": false,
      "has_quota": true,
      "entitlement": 3000,
      "remaining": 252,
      "quota_remaining": 252.6,
      "percent_remaining": 8.4,
      "overage_count": 0,
      "overage_permitted": true,
      "quota_reset_at": 0,
      "timestamp_utc": "2026-06-02T13:41:20.798Z",
      "token_based_billing": true
    }
  }
}
```

---

## Field Reference

### Top-level fields

| Field | Type | Description |
|---|---|---|
| `login` | string | GitHub username |
| `copilot_plan` | string | Subscription tier: `"business"`, `"individual"`, etc. |
| `access_type_sku` | string | Billing SKU, e.g. `"copilot_standalone_seat_quota"` |
| `token_based_billing` | boolean | When `true`, quota is measured in premium interactions, not classic request tokens |
| `quota_reset_date` | string | Next quota reset date, `YYYY-MM-DD` |
| `quota_reset_date_utc` | string | Same as above in full ISO 8601 UTC |
| `endpoints.api` | string | The user's Copilot API base URL — may differ for enterprise/business users |
| `chat_enabled` | boolean | Whether Copilot Chat is enabled for this user |
| `cli_enabled` | boolean | Whether Copilot CLI is enabled |
| `is_mcp_enabled` | boolean | Whether MCP is enabled |
| `overage_permitted` (top-level via premium_interactions) | boolean | Whether usage continues after quota exhaustion |
| `analytics_tracking_id` | string | Opaque telemetry identifier — not useful for billing |

### `quota_snapshots` object

Contains one entry per quota category. Observed categories: `chat`, `completions`, `premium_interactions`. The schema is open — additional categories may appear.

| Field | Type | Description |
|---|---|---|
| `quota_id` | string | Category name: `"chat"`, `"completions"`, `"premium_interactions"` |
| `unlimited` | boolean | `true` if the plan has no cap on this category |
| `has_quota` | boolean | `true` if a finite quota applies |
| `entitlement` | number | Total allocation for the billing period (integer interactions) |
| `remaining` | number | Remaining allocation as an integer |
| `quota_remaining` | number | Remaining allocation as a float (fractional interactions) — more precise than `remaining` |
| `percent_remaining` | number | `(quota_remaining / entitlement) * 100` — pre-computed by GitHub |
| `overage_count` | number | Number of interactions used beyond the entitlement |
| `overage_permitted` | boolean | Whether usage is allowed after quota is exhausted |
| `quota_reset_at` | number | Epoch ms of next reset (0 observed in practice — use top-level `quota_reset_date_utc` instead) |
| `timestamp_utc` | string | Server time when this snapshot was captured |
| `token_based_billing` | boolean | Whether this category is billed by token-based interactions |

### Computing "used" and "remaining"

```js
const pi = response.quota_snapshots.premium_interactions;

// Premium interactions used this billing period:
const used = pi.entitlement - pi.remaining;   // integer
// e.g. 3000 - 252 = 2748

// Remaining (prefer float for precision):
const remaining = pi.quota_remaining;          // 252.6

// Percent used:
const pctUsed = 100 - pi.percent_remaining;   // 91.6
```

For `unlimited: true` categories (`chat`, `completions`), `entitlement` and
`remaining` are both 0. Guard with `has_quota` before displaying any numbers.

---

## Additional Information Worth Capturing

Beyond the MTD cost and credits remaining that motivated this research, the
response contains several fields that could usefully be surfaced:

### Overage status

`premium_interactions.overage_permitted` tells you whether the user's
subscription continues after quota is exhausted. If `overage_permitted: true`
and `remaining` has crossed zero, the user is in overage — distinct from
being blocked. Displaying this avoids confusion when usage continues past the
nominal limit.

### Quota reset date

`quota_reset_date_utc` gives the exact date the counter will reset. Useful
for contextualizing the "X remaining" figure — "252 left, resets Jul 1" is
more actionable than "252 left".

### Billing period context

The billing period is not explicitly stated as a start date, but it can be
inferred: reset date minus one month. Combined with `timestamp_utc` from the
snapshot, you can compute days remaining in the period.

### Plan / SKU

`copilot_plan` and `access_type_sku` clarify what kind of account this is.
This matters because the `entitlement` value differs per plan (individual,
business, enterprise), and a "252 remaining out of 3000" display should note
the plan context.

### Chat and completions quotas

`chat` and `completions` are both `unlimited: true` on this business seat,
but that may not be universal. The schema supports finite quotas on those
categories. The plugin could conditionally display warnings if those snapshots
show `has_quota: true` with low `percent_remaining`.

### Business-tier API endpoint

`endpoints.api` returns a plan-specific base URL
(`https://api.business.githubcopilot.com` for business users). This is the
correct base to use for any subsequent Copilot API calls on behalf of this
user.

---

## How to Consume This in burnrate-copilot

### Recommended pattern: primary source + last_known fallback

```
┌─────────────────────────────────────────────────────────┐
│  statusline.js (every turn)                              │
│                                                          │
│  1. Call copilot_internal/user via gh auth token        │
│  2. Extract premium_interactions quota fields           │
│  3. Write last_known_quota to session file              │
│  4. Render statusline from live data                    │
│                                                          │
│  On any fetch failure:                                  │
│  5. Fall back to last_known_quota from session file     │
│  6. Fall back to local JSONL totals (existing logic)    │
└─────────────────────────────────────────────────────────┘
```

**Session file additions** (alongside existing `last_known_cost`):

```json
{
  "last_known_quota": {
    "entitlement": 3000,
    "remaining": 252,
    "quota_remaining": 252.6,
    "percent_remaining": 8.4,
    "overage_permitted": true,
    "overage_count": 0,
    "quota_reset_date_utc": "2026-07-01T00:00:00.000Z",
    "captured_at": "2026-06-02T13:41:20Z"
  }
}
```

`captured_at` lets a consumer decide whether a cached value is fresh enough
to trust (e.g. reject if older than 24 hours).

### Authentication

No new credentials needed. The token comes from `gh auth token`:

```js
import { execSync } from "node:child_process";

function getGhToken() {
  try {
    return execSync("gh auth token", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
```

If `gh` is not installed or not authenticated, this returns null and the
fetch is skipped — the plugin falls back to the last_known value or local
JSONL totals. No user-visible prompt or setup step is required; the same
authentication that lets them run `copilot` is sufficient.

### Failure handling

The API is undocumented and internal. Treat every call as potentially
unreliable:

```js
async function fetchQuota(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);  // 3s hard timeout
  try {
    const res = await fetch("https://api.github.com/copilot_internal/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    const pi = body?.quota_snapshots?.premium_interactions;
    if (!pi) return null;
    return {
      entitlement: pi.entitlement,
      remaining: pi.remaining,
      quota_remaining: pi.quota_remaining,
      percent_remaining: pi.percent_remaining,
      overage_permitted: pi.overage_permitted,
      overage_count: pi.overage_count,
      quota_reset_date_utc: body.quota_reset_date_utc ?? null,
      captured_at: new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

Null return at any point means "use fallback." The fallback chain is:

1. `last_known_quota.quota_remaining` from session file (if `captured_at` is
   within a configurable freshness window, e.g. 24 hours)
2. Derived from local JSONL totals (existing plugin logic)
3. Display nothing / "n/a"

### Schema stability

The internal schema (from `app.js` Zod definitions) shows that the keys we
care about — `entitlement`, `remaining`, `quota_remaining`,
`percent_remaining`, `overage_permitted`, `quota_reset_date_utc` — have been
present in every version inspected (1.0.51–1.0.57). However, because this is
internal, any version update could change or drop them. The null-checking in
`fetchQuota` above covers schema drift: if `quota_snapshots` moves or is
renamed, the function returns null and the fallback activates without surfacing
an error to the user.

The `premium_interactions` key itself could be renamed. A defensive read that
checks for any snapshot where `has_quota: true` (rather than hardcoding the
key name) is more resilient:

```js
function findPremiumSnapshot(quotaSnapshots) {
  // Prefer "premium_interactions" by name; fall back to first finite quota
  if (quotaSnapshots?.premium_interactions?.has_quota) {
    return quotaSnapshots.premium_interactions;
  }
  return Object.values(quotaSnapshots ?? {}).find(s => s?.has_quota) ?? null;
}
```

### Display recommendations

Given this data, the statusline could show:

```
AI: 2748/3000 (252 left, resets Jul 1)
```

or a minimal version:

```
AI: 252 left
```

If the API is unavailable and the last_known value is fresh:

```
AI: ~252 left
```

(tilde indicating a cached/estimated value)

If last_known is stale and only JSONL totals are available, the existing
`AI MTD: 321.26` format remains appropriate.

---

## What AIMTD copilot Does with This Data

The [AIMTD copilot](https://github.com/upld-internal/AIMTD-copilot) project
(the reference implementation that prompted this research) does **not** call
this API directly. It instead uses:

1. **`session.rpc.usage.getMetrics()`** — a JSON-RPC call over a local socket
   to the Copilot CLI process (requires running as a Copilot CLI extension,
   not a standalone script). Returns `totalNanoAiu`, `totalPremiumRequestCost`,
   `totalUserRequests`, and per-model metrics for the **current session**.

2. **`~/.copilot/session-state/*/events.jsonl`** — local files written by the
   Copilot CLI containing `session.shutdown` events with historical totals.

Neither gives a MTD authoritative total. The AIMTD project sums shutdown
snapshots, which can overcount or undercount depending on session ordering.
The `copilot_internal/user` API is the authoritative GitHub-side source for
the billing period total — it is what appears on the GitHub billing dashboard.

The `account.getQuota` RPC in `@github/copilot-sdk` is a wrapper around this
same endpoint, available to extensions that run inside the Copilot CLI process.
For a standalone plugin hook script (like burnrate-copilot's `statusline.js`),
calling the HTTP endpoint directly via `gh auth token` is the correct approach.
