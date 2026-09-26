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

**Rollback:** publish the previous verified version to the same branch. Users with `autoUpdate` pick it up at their next session, because the plugin version changes.

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

Device-managed settings override server-managed ones, so the pilot does not affect other users. The pilot must confirm that:

- the `ref` field of a managed marketplace source selects `marketplace-pilot`, since GitHub's documented example has no `ref`;
- the plugin installs at sign-in and cannot be disabled locally;
- publishing a new version to `marketplace-pilot` reaches the machine at its next session;
- the `telemetry` block replaces the `OTEL_*` environment variables.

Burnrate's own `LANGFUSE_*` variables are still needed until Burnrate reads its own configuration file. On Windows, also run the [Windows live checklist](windows-live-checklist.md).

## 4. Enterprise rollout

After the pilot passes on macOS and Windows, put the same `extraKnownMarketplaces`, `enabledPlugins`, and `telemetry` entries in `.github-private/.github/copilot/settings.json`, with `ref` set to `marketplace`. Server-managed settings apply to every user licensed through the enterprise and reach clients within about an hour. Removing the entries is the rollback.

## Known gaps

- The release gate has no hook-latency benchmark yet; Codex's release runs one on every target.
- Users still set `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `BURNRATE_LANGFUSE_TURN_IO`, and `LANGFUSE_COPILOT_USER_ID` themselves, because managed settings cannot set environment variables for hooks. A Burnrate configuration file written by the `setup-langfuse` skill, with the secret in the OS credential store, will replace them.
- The workflow, packaging script, and publish script have run only as a pull-request dry run. The first signed tag is their first full run.
