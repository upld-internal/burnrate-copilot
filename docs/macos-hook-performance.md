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
