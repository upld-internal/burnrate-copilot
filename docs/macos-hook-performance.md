# macOS hook component diagnostic

The provider hook gate remains 100 ms p95 / 250 ms p99, with 1,000 initial
events and 1,000 open sessions. The exact candidate's protected run
[37055920997](https://github.com/upld-internal/burnrate-copilot/actions/runs/37055920997)
passed ARM64 Mac at 85.369 / 110.972 ms but failed Intel Mac at 146.136 /
153.472 ms. See [rollout readiness](rollout-readiness.md) for source identities
and all five targets. This diagnostic does not change that failed release gate.

## Reproduce the diagnostic

The example at provider revision
`153e1969cf9a0697fd47cfcbf1ec771fa5ff3831` uses the provider's locked immutable
shared pin, `321ee246b42e5b2ccd45e97b99b49a4784e3f9fb`. It creates a disposable
Unicode Git fixture and store; it does not access real credentials, transcripts,
Copilot settings or the user's Burnrate store. It removes the fixture after
success. Each component has 20 warmups and 100 measured samples.

```sh
cargo run --locked --release --example hook-costs -- PATH_TO_BINARY
```

Set the usual `BURNRATE_SOURCE_REVISION` and `BURNRATE_SHARED_REVISION` build
variables when building the example and target binary. Output reports both
identities separately. `version` child startup excludes hook work; the other
components call the exact shared adapter kit inside the diagnostic process.
Storage writes use a cached runtime, a tool-completed event, its attribution and
two capability records. The write corpus grows by 120 events / 240 capabilities.
These components run independently: percentile values cannot be added or
subtracted to reconstruct hook p95. Acceptance still uses `hook-benchmarks`,
which measures the real hook child process.

The native release workflow now retains `hook-components.json` beside the
existing provider/shared gate JSON on all five targets, including failed gates.
The diagnostic is an example, not an extra packaged executable. No production
hook, credential or telemetry behavior changed for this profiling work.

## Local ARM64 result

Observed on 2026-10-03 UTC / 2026-10-02 Toronto, macOS 26.5.1 (25F80), native
ARM64. The diagnostic is revision `153e1969cf9a0697fd47cfcbf1ec771fa5ff3831`;
the tested executable remains candidate code
`4e718c0b41391628774cb1ddd1a7651ef71c367b`. Both use shared `321ee246...`.

| Independent component | p95 | p99 |
| --- | ---: | ---: |
| Executable startup (`version`) | 3.695 ms | 4.287 ms |
| Open store and snapshot | 18.034 ms | 18.971 ms |
| Event-time Git attribution | 11.278 ms | 11.439 ms |
| Cached attributed event and two capability writes | 43.759 ms | 45.887 ms |

[Raw diagnostic JSON](release-evidence/2026-10-02/macos-arm64-hook-components.json)
retains exact build identities and all percentiles. The exploratory first run
had a 52.855 ms write p95; the repeat above confirms writes are the largest of
the measured ARM64 components. It does not establish the Intel bottleneck.

The diagnostic passed local provider format, locked Clippy with warnings as
errors, stable all-target tests and Rust 1.85 all-target tests (34 passed, one
native-vault test deliberately ignored). No live trace was rerun for this
diagnostic-only change because production hook and Langfuse code are unchanged.

## Native diagnostic run

[Protected run 37091675207](https://github.com/upld-internal/burnrate-copilot/actions/runs/37091675207)
completed at synthetic merge source `fea1228240a72b7673291904a2d70145a494c685`,
whose Git tree `83ab6e754d5f066cc6e13b732bbdfa8e9657b48d` equals diagnostic
head `153e1969cf9a0697fd47cfcbf1ec771fa5ff3831`. The shared pin stayed unchanged.
This was an unsigned PR dry run; signing and publication were skipped.

| Native host | Hook p95 / p99 | Independent write-sequence p95 | Hook gate |
| --- | ---: | ---: | --- |
| ARM64 Mac, 14.8.9 (23J631) | 93.609 / 99.718 ms | 19.562 ms | Pass |
| Intel Mac, 15.7.9 (24G830) | 139.588 / 307.252 ms | 108.671 ms | **Fail p95 and p99** |
| Windows Server 2022 x64, 10.0.20348 | 150.041 / 154.202 ms | 60.666 ms | **Fail p95** |
| Ubuntu 24.04.5 ARM64 | 25.368 / 27.737 ms | 6.253 ms | Pass |
| Ubuntu 24.04.5 x64 | 25.522 / 26.767 ms | 7.959 ms | Pass |

All five native functional suites and shared conformance/privacy passed. Both
macOS native vault lifecycles passed; Windows vault lifecycle and PowerShell
5.1/7 hook smoke passed. Shared performance passed on both Macs and both Linux
targets. Windows additionally failed shared orphan recovery at 3.739053 s
against its 2 s budget; the earlier five-target run passed that operation, so
retain both results and investigate its variability. This Windows CI result is
not a Windows 11 Copilot proof.

The Intel diagnostic measured startup p95 9.833 ms, store open 36.932 ms, Git
34.856 ms and cached attributed-event/capability writes 108.671 ms. Its write
median was 37.592 ms, with p99 157.218 ms, so variability in the write path
deserves further investigation. The write sequence is the largest measured
component on Intel and Windows; these independent timings are not a causal
decomposition of the full hook percentile. The ARM64 CI host had different
relative costs from the local development Mac.

[Run summary](release-evidence/2026-10-02/37091675207-summary.json) records exact
source, shared, host/image versions, each gate and step conclusion. All fifteen
raw diagnostic/provider/shared JSON files are retained alongside it, including
failures.

## Next decision

Profile record admission and durable writes in `burnrate-spec` before choosing
a change; derived-cache writes already avoid
unchanged data, so do not assume every store open rewrites it. Preserve record
durability, idempotency, crash recovery, privacy and cross-process locking.
Any shared optimization requires a new immutable shared revision, both provider
pin files, exact consumer conformance and a passing five-target native gate.
Do not claim Intel performance from the local ARM64 result or weaken the
existing benchmark limits/corpus.

## Durable-write optimization and bounded scans

The Mac write profile identified repeated device-wide flushes as the largest
write component. Shared revision `32f3abe2dce3fc47e86e94261974986c6b04b2f1`
uses ordinary file `fsync` only when the atomic rename is followed by the
existing parent `F_FULLFSYNC`, which flushes the preceding file data and rename
before acknowledgement. Paths that defer the parent flush retain full file
flushes. Linux and Windows synchronization behavior is unchanged. Shared ADR
0016 records the durability argument; this is not physical power-loss evidence.

Provider `5fe19a3a3e99404d5c790fb015fed2437df1c5cf` pinned that exact revision.
[Native run 37094776587](https://github.com/upld-internal/burnrate-copilot/actions/runs/37094776587)
built synthetic merge `641c2e167485bc798e1b217788f4b14abf3932a5`.
All shared performance budgets passed on all five hosts. The full provider hook
still failed Intel and Windows p95:

| Native target | Full hook p95 / p99 | Result |
| --- | ---: | --- |
| macOS ARM64 | 69.623 / 87.510 ms | Pass |
| macOS Intel | 138.414 / 190.810 ms | Fail p95 |
| Windows x64 CI | 101.662 / 117.390 ms | Fail p95 |
| Linux ARM64 | 26.840 / 29.123 ms | Pass |
| Linux x64 | 36.423 / 36.662 ms | Pass |

Intel's independent cached write p95 fell to 30.195 ms, but full-hook store
scanning remains material. All fifteen raw JSON files are preserved under
`docs/release-evidence/2026-10-03/37094776587-*`.

Shared `9b4081276e080a28270d6ff7b588b5e941e8b619` adds at most four workers
for immutable slot reads in stores with at least 128 slots. The exclusive store
lock remains held and workers return records and diagnostics in original slot
order. A 256-slot test includes malformed, unsupported and privacy-invalid
records and checks restart deduplication plus unchanged rejected bytes. Shared
format, Clippy and full stable/MSRV workspace suites passed.

Provider `f92a73f43ed8d712e6818a9830e8203269121ce7` pins that revision in both
files. Provider format, locked Clippy and stable/MSRV all-target suites passed.
[Native run 37096702730](https://github.com/upld-internal/burnrate-copilot/actions/runs/37096702730)
is the required full-hook acceptance check; preserve its final results before
calling Intel latency resolved. No benchmark corpus or budget was reduced.

Run 37096702730 completed with all native functional suites and all shared
budgets passing. Its synthetic source is
`ac612c40fa7651b1e515a225aa5d0e75dd936329`. Full-hook ARM64 Mac improved to
41.589 / 42.231 ms; Intel reached 101.572 / 125.966 ms and still **failed**
the 100 ms p95 limit. Windows CI failed p95 at 120.253 / 132.026 ms.
Linux ARM64 and x64 passed at 20.357 / 21.209 and 19.593 / 19.766 ms.
All raw JSON is retained under `37096702730-*`. The remaining Git diagnostic
p95 was 33.526 ms on Intel and 33.416 ms on Windows; overlapping the independent
bounded read-only Git state and origin queries is the next shared change.

Shared `561deeedbabad1672e86615f24f780947ef8db9d` now overlaps the state and
origin Git queries, retaining their bounds, deadlines, fresh sampling and
fallback behavior. ADR 0018 (originally 0017) documents the scheduling change. Shared and provider
format, locked Clippy, stable and Rust 1.85 suites passed at the immutable pin.
The next native run determines acceptance; the preceding failures remain evidence.

## Passing Mac native acceptance, 2026-10-03

Provider code `bf55a8c0b536234aa89fba352eaf90b88c09cad2`, pinned shared
`0c7c72c5ac52392e80bdad6729ac8624b18d2160`, completed
[native run 37098913102](https://github.com/upld-internal/burnrate-copilot/actions/runs/37098913102).
The native build source was synthetic merge `671521ea9054771f26b2ff9d3b87c5ff8985c95d`;
its Git tree `746fe375a868d1ccfabd054cc7fd693b5a116de2` equals the candidate
head above.
Both native Mac jobs passed every functional, stable/MSRV, lint, conformance,
privacy, OS-vault and performance step. Full hook acceptance retained 1,000
initial events, 1,000 open sessions, 20 warmups and 100 measured samples.

| Native host | Hook p95 / p99 | Result |
| --- | ---: | --- |
| ARM64 Mac, 14.8.9 (23J631) | 57.494 / 91.364 ms | Pass |
| Intel Mac, 15.7.9 (24G830) | 75.132 / 84.303 ms | Pass |
| Windows Server 2022 x64, 10.0.20348 | 105.874 / 113.818 ms | Fail p95 |
| Ubuntu 24.04.5 ARM64 | 19.730 / 20.125 ms | Pass |
| Ubuntu 24.04.5 x64 | 25.671 / 26.922 ms | Pass |

Shared performance passed both Macs and both Linux targets. Windows orphan
recovery additionally failed at 2.691529 s against 2 s. All five native
functional suites passed, including the corrected portable legacy hook test,
Windows vault lifecycle and PowerShell 5.1/7 smoke. The full workflow failed
because of those Windows performance gates; no signing or publication occurred.
All fifteen raw JSON files and the host/step summary are retained under
`docs/release-evidence/2026-10-03/37098913102-*`.

The final capability batch retains each existing file and parent durable flush.
It preflights bounded records/conflicts, takes one exclusive lock, advances
counts only for successful committed records and checks actual directory counts
again on the next admission. Separate store-writer/restart tests cover cache
invalidation. No flush, privacy check, benchmark corpus or budget was removed.
Earlier failed runs remain evidence of observed variance; this pass qualifies
the recorded Mac code/pin pair, not an untested subsequent revision.

## Windows 11 client qualification, 2026-10-06

Shared ADR 0015 moves the Windows hook gate from hosted Windows Server CI to a
native Windows 11 client; hosted Windows latency is now diagnostic in the
release workflow. Copilot selects the Windows 11 25H2 floor. Measurements ran
on VEPRO1 (Windows 11 Education 25H2, build 26200, native x64) in the ordinary
desktop session through `scripts/qualify-windows-performance.ps1`, with
Defender real-time scanning on and no exclusions. The benchmark store and Git
fixture live on `C:`, a SATA Kingston A400 with 15 GB free, which is at the
slow end of the expected developer range. Budgets and corpus are unchanged.

| Provider / shared | Hook p95 / p99 ms (three rounds) | Shared budgets |
| --- | --- | --- |
| `c487397` / `0c7c72c` (previous candidate) | 527/740, 188/205, 175/187 | pass |
| `22adc09` / `9bf3ae7` (Windows-native shared work merged) | 200/223, 189/214, 194/216 | pass |
| `700bd25` / `4733460` (direct `.git` reads, ADR 0019) | 129/137, 117/125, 114/121 | pass |

Each Git process start cost 27–35 ms on this client. Reading ordinary `.git`
directories directly reduced the Git component from 49.4 ms to 0.4 ms p95.
The remaining independent components are store open 30.8 ms, cached event and
capability writes 32.8 ms and executable startup 8.9 ms p95. With the
benchmark's temporary root on the faster `S:` drive, the `22adc09` hook
measured 125 ms p95 instead of about 195 ms. Orphan recovery passed every
client round at 0.81–1.0 s against 2 s. The hook remains above the 100 ms p95
client budget; receipts are under `release-evidence/2026-10-06/`.
