# Signed releases and marketplace branches

Burnrate Copilot is distributed through a Copilot CLI marketplace on a branch of this repository. A plugin install copies that branch, so it holds the verified binaries for every target, which `main` never does.

| Branch | Audience |
| --- | --- |
| `marketplace-pilot` | Test machines with a file-based `managed-settings.json` |
| `marketplace` | The enterprise-managed rollout |

`main` deliberately has no `.github/plugin/marketplace.json`. The catalog template is `packaging/marketplace.json`; it is placed at `.github/plugin/marketplace.json` only on a marketplace branch.

## 1. Release

1. Bump the version in `Cargo.toml` and `plugin/burnrate-copilot/plugin.json` to the same `X.Y.Z` and merge to `main`.
2. Create and push a signed tag from `main`. GitHub must show the tag as verified:

   ```sh
   git tag -s vX.Y.Z -m "burnrate-copilot vX.Y.Z"
   git push origin vX.Y.Z
   ```

The [protected release workflow](../.github/workflows/release.yml) then:

1. **Validates the input.** It rejects an unverified or lightweight tag, a dirty tree, a version mismatch, or a shared-crate pin that is not an immutable revision.
2. **Builds each of five targets** on its native runner: macOS ARM64 and x86-64, GNU/Linux ARM64 and x86-64, and Windows x64.
   - Every target runs the full stable and Rust 1.85 suites.
   - Every binary's `build-info` is checked for its target and source revision.
   - The Windows target also runs `scripts/windows-hook-smoke.ps1`.
3. **Packages each binary** with its shared-contract release manifest and the license. Each archive gets SLSA v1 provenance and a keyless Cosign signature.
4. **Publishes** a GitHub release with every archive, `SHA256SUMS`, and its signature.
5. **Assembles the marketplace package** with `scripts/build-marketplace-package.py`, which verifies:
   - the signed checksums;
   - each archive's checksum, signature, and provenance;
   - each archive's manifest.

   The job uploads the package as an artifact.

A pull request that changes release inputs runs the same build and test matrix as a **dry run**, with no signing or publishing. Run the dry run manually with the `dry-run` mode of the workflow once it is on `main`. The `repackage` mode rebuilds and signs the marketplace package for an existing signed release.

## 2. Publish to a marketplace branch

Publication is a separate, deliberate step. It needs an authenticated `gh` with access to this private repository and [Cosign](https://docs.sigstore.dev/cosign/system_config/installation/) (`brew install cosign` on macOS). From a clean checkout of the tag:

```sh
git checkout vX.Y.Z
scripts/publish-marketplace-branch.sh X.Y.Z marketplace-pilot
```

The script re-runs the full verification, replaces the branch content with exactly the verified package, and pushes one commit. The commit is signed if your Git signing key is configured. Promotion publishes the same verified version to `marketplace`:

```sh
scripts/publish-marketplace-branch.sh X.Y.Z marketplace
```

**Rollback candidate:** republish the previous verified version to the pilot branch, then prove both automatic and manual downgrade on native hosts. Do not assume a version change triggers `autoUpdate` or that a lower version is accepted. Production rollback requires an exact previously verified package, schema compatibility, settings restoration, no duplicate hooks, and trace readback. See the [reviewable rollout plan](rollout-readiness.md).

## 3. Pilot with file-based managed settings

An administrator writes this file on each test machine:

- **macOS:** `/Library/Application Support/GitHubCopilot/managed-settings.json`, owned by root and not world-writable (`sudo`).
- **Windows:** `%ProgramFiles%\GitHubCopilot\managed-settings.json`, from an elevated shell.

```json
{
  "extraKnownMarketplaces": {
    "upld-internal": {
      "source": { "source": "github", "repo": "upld-internal/burnrate-copilot", "ref": "marketplace-pilot" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": { "burnrate-copilot@upld-internal": true },
  "telemetry": {
    "enabled": true,
    "endpoint": "https://langf-admin.upland.one/api/public/otel",
    "protocol": "http/protobuf",
    "captureContent": true,
    "headers": {
      "Authorization": "Basic <base64 public:secret of the pilot Langfuse project>",
      "x-langfuse-ingestion-version": "4"
    }
  }
}
```

Device-managed settings override server-managed ones, so the pilot does not affect other users. The [macOS pilot](pilot-macos-managed-settings.md) of v0.5.0 established that:

- the `ref` field of a managed marketplace source selects `marketplace-pilot`;
- the `telemetry` block replaces the `OTEL_*` environment variables;
- a managed plugin cannot be uninstalled, and a local disable does not stop its hooks, although `copilot plugin list` shows it as `[disabled]`;
- the plugin installs when the first **interactive** session starts; `copilot -p` runs do not install it;
- the old JavaScript plugin keeps running beside the managed one until it is removed.

Still to confirm: that a new version published to `marketplace-pilot` reaches the machine at its next session.

To end a pilot, remove the file (`sudo rm` on macOS, an elevated `Remove-Item` on Windows). The managed marketplace and telemetry stop at the next session. The plugin stays installed but disabled, and its hooks no longer run. `copilot plugin uninstall burnrate-copilot@upld-internal` removes it.

Signed v0.5.0 still needs Burnrate's separate `LANGFUSE_*` variables. The unreleased v0.6.0 candidate offers OS-vault setup and an explicit launcher; see [secure setup](langfuse-setup.md). A file-based telemetry policy containing a shared key must not be exposed to other local accounts. Use a secret-free plugin policy with a per-user launcher, or an approved private enterprise mechanism. On Windows, also run the [Windows live checklist](windows-live-checklist.md).

## 4. Enterprise rollout

After native install, update, rollback, setup, performance, and Langfuse readback pass on macOS and Windows and final publication/policy approval is recorded, put the same `extraKnownMarketplaces`, `enabledPlugins`, and `telemetry` entries in `.github-private/.github/copilot/settings.json`, with `ref` set to `marketplace`. Confirm current server-policy propagation and pilot-role targeting before applying settings. Removing policy entries alone is not a proved artifact rollback; recheck installed versions and live hooks on both OSes. Do not start with an enterprise-wide policy when only a pilot role has been authorized.

## Records

- [v0.5.0 release record](releases/v0.5.0.md)
- [macOS managed-settings pilot](pilot-macos-managed-settings.md)

## Known gaps

- v0.5.0 had no enforcing hook benchmark. The v0.6.0 candidate workflow adds native provider and exact-pinned shared performance gates; the final five-target dry run passed shared budgets but failed provider hook p95 on Intel macOS and Windows. See the [exact rollout evidence](rollout-readiness.md); promotion remains blocked.
- Stable macOS native signing and real credential-preserving update need proof; see the [signing/update acceptance plan](macos-signing-and-update-proof.md) and [hook component diagnostic](macos-hook-performance.md).
- OS-vault setup, repair, missing credentials, rotation, and same-project native trace readback need Windows proof. Device policy checks do not observe every server/MDM override.
- The candidate implements [explicit legacy deactivation](install-and-migration.md); Windows and managed migration still require live proof. Signed v0.5.0 has no migration command.
