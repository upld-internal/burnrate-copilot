# Cost Summary Output Format

## Rules

1. Run the script. Present the raw stdout verbatim inside a single fenced code block.
2. No preamble. Do not write "Here's your cost summary for May 2026:" or any other introduction.
3. No commentary after the block. Do not add observations, highlights, or analysis.
4. No reformatting. Do not add, remove, or rearrange any lines. Do not reformat numbers or column widths.
5. If the script exits with an error, show the error output in the code block the same way.

## Correct response format

The entire response is exactly this — nothing before, nothing after:

````
```
Period: 2026-05

Sessions: 42

─────────────────────────────────────────────────────────
Total cost: $38.12
─────────────────────────────────────────────────────────
Token totals  (sessions with token data):
  Input:        310,000
  Output:       195,000
  Cache writes: 420,000
  Cache reads:  8,200,000
─────────────────────────────────────────────────────────

By model:
  Model              Sessions  Cost          % of total
  ─────────────────  ────────  ──────────    ──────────
  Claude Sonnet 4.6        35  $  36.00      94.4%
  Claude Haiku 4.5          7  $   2.12       5.6%
─────────────────────────────────────────────────────────

By project:
  Project             Sessions  Cost          % of total
  ──────────────────  ────────  ──────────    ──────────
  my-project                20  $  22.00      57.7%
  unknown                   12  $  10.50      27.5%
  other-project             10  $   5.62      14.7%

By Jira:
  Jira key      Sessions  Cost          % of total
  ────────────  ────────  ──────────    ──────────
  unattributed        38  $  36.42      95.5%
  ENG-1234             4  $   1.70       4.5%

Most expensive sessions (top 5 sessions):
  Date        ID        Cost        Turns  Model
  ──────────  ────────  ──────────  ─────  ─────
  2026-05-14  7fda424d  $   7.88      42   Claude Sonnet 4.6 [my-project]
  2026-05-13  f0ff961d  $   6.12      35   Claude Sonnet 4.6 [my-project]
  2026-05-10  a1b2c3d4  $   4.50      18   Claude Sonnet 4.6 [other-project]
  2026-05-08  e5f6a7b8  $   3.20      12   Claude Sonnet 4.6 [unknown]
  2026-05-05  c9d0e1f2  $   2.88       9   Claude Haiku 4.5 [my-project]
```
````

## Incorrect — do not do this

```
Here's your cost summary for May 2026:

[code block]

Notable: The my-project project accounts for 58% of spend...
```
