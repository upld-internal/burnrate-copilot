# Installation and legacy deactivation

The private signed v0.5.0 pilot is available through Copilot CLI:

```sh
copilot plugin marketplace add 'upld-internal/burnrate-copilot#marketplace-pilot'
copilot plugin install burnrate-copilot@upld-internal
copilot plugin enable burnrate-copilot@upld-internal
```

Use an isolated `COPILOT_HOME` with spaces and non-ASCII text for release proof.
Read its installed identity/version/cache path from host state and verify the
binary against the signed archive manifest, not merely the marketplace listing.
The signed package carries Cosign archive signatures and SLSA provenance; this
is not a claim of executable Authenticode signing or macOS notarization.
Windows operators use `scripts/verify-windows-install.ps1` and the
[Windows checklist](windows-live-checklist.md). Run real host sessions from the
installed package without `--plugin-dir` to establish its active hook definition.

For managed installation, use the catalog/enablement policy in the release
procedure and verify startup plus actual hooks. On observed macOS Copilot
1.0.88/1.0.89, `-p` alone did not install plugins, and managed hooks ran despite
a disabled listing. Open an interactive session to install, close it, then restart
and verify records and API readback. The 2026-10-03 clean managed fixture installed
on first startup but loaded its hooks only after restart. Windows must prove
those behaviors independently. A catalog-only
managed policy can accompany the user's vault launcher without a file containing
telemetry credentials. Enterprise policy changes require final rollout approval.

## Legacy v0.1.0 users (v0.6.0 candidate only)

The observed legacy plugin source is
`https://github.com/upld-internal/burnrate-copilot.git`, directly installed as
`burnrate-copilot`, version `0.1.0`. It must stop running before the qualified
Rust marketplace copy is enabled. From the candidate native binary:

```text
BINARY migration status
BINARY migration disable-legacy
```

The command validates the host's source, identity/version, cache containment,
and local manifest. Ambiguous ownership stops with a bounded error. The migration changes only that validated legacy registry entry's enabled flag,
then checks Copilot's effective JSON listing. Copilot's bare-name disable can
select the Rust copy when both share a name, so it cannot establish migration.
An effective-state mismatch fails and restores the prior registry when it has
not changed concurrently. Only exact `node` commands to
that validated plugin's known scripts are removed from user hooks and statusline.
Unrelated hooks, profiles, telemetry settings, and historical data remain intact.
A restrictive `state/legacy-migration.json` journals only those owned values and
previous activation; it never copies the entire user settings file. Repeating the
command reconciles interrupted preparation without replacing the first journal.

Exit **all** Copilot sessions and restart before enabling/installing the new
copy. Already loaded hooks can otherwise remain in memory. Observe a real turn:
only the Rust store should receive new records, the old statusline should be
absent, and Langfuse must have one attribution span with the native host root.
A plugin listing alone is insufficient. A managed policy forcing the old copy,
project-local duplicates, or another Copilot home needs separate remediation;
this command does not alter enterprise policy or unknown project hooks.

Deactivation keeps the old package and data for rollback. After new native
activation is proved, an operator may uninstall the exact legacy direct-source
identity (never a bare name while another copy is installed) through Copilot CLI. This is not historical data conversion. See shared
ADR 0016 for the explicit deactivation exception to the fresh-install boundary.

For preparation rollback, first remove the Rust copy through the host, then run
`BINARY migration rollback` using the candidate binary kept outside that install.
It refuses restoration while any Rust Burnrate copy is installed, refuses to
overwrite a newly changed statusline, restores owned hooks without duplicates,
and re-enables legacy only if it was enabled before preparation. Restart and
inspect live delivery. A user who already removed the legacy package must
reinstall its verified old source before this restoration; the command never
downloads an unknown historical package.

Native macOS disposable-home CLI deactivation/repeat/rollback has been exercised.
The credential-free ARM64 managed fixture also passed live migration after restart
with unchanged legacy data and attributed API readback. Native Windows, Intel
lifecycle, and the exact signed five-target candidate remain open gates.

## Host-dispatch correction, 2026-10-03

The live two-copy update test proved that legacy startup could recreate its
statusline despite a disabled listing. The migration additionally validates
every command and option in the recognized v0.1.0 `hooks.json`, preserves its
exact bytes in a private `.burnrate-disabled-legacy-hooks.json`, and writes an
empty valid hook definition. The journal records only its checksum. Unknown
commands, credentials/options, ambiguous ownership or changed definitions stop
mutation. Repeat and rollback preserve the original bytes; restoration still
requires removal of Rust. Exit all host sessions before migration and repeat
it after any legacy repair/reinstallation. Already loaded hooks are unaffected
until restart. Native delivery checks remain required.
