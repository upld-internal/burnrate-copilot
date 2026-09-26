//! Local lifecycle and tool records through the shared adapter kit.

use std::fs;
use std::path::Path;

use burnrate_adapter_kit::contracts::{
    AttributionSnapshot, CapabilityState, SessionEvent, SessionEventType,
};
use burnrate_adapter_kit::core::{
    AttributionConfig, AttributionMoment, AttributionRequest, DEFAULT_RETENTION_POLICY,
    PathRedaction, StoreError, observe_attribution,
};
use burnrate_adapter_kit::{AdapterRecordFactory, AdapterRuntime};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::hook::{HookEvent, HookInput};
use crate::provider::{HARNESS, PRODUCT, Paths, ProviderError};

const ATTRIBUTION_CONFIG_LIMIT: usize = 64 * 1024;

/// Records one accepted hook locally. `agentStop` has no local record: the
/// shared contract has no turn event, and its work is the Langfuse span.
pub fn accept_hook(
    paths: &Paths,
    event: HookEvent,
    input: &HookInput,
) -> Result<(), ProviderError> {
    if matches!(event, HookEvent::AgentStop | HookEvent::UserPromptSubmitted) {
        return Ok(());
    }
    let (runtime, snapshot) =
        AdapterRuntime::open_with_snapshot(paths.store()).map_err(map_store_error)?;
    let factory = factory("copilot-hook")?;
    let config = load_attribution_config(paths)?;
    let now = now()?;
    let recorded = |id: &str| snapshot.events.iter().any(|event| event.id == id);
    let start_id = event_id(&input.session_id, "start");
    let end_id = event_id(&input.session_id, "end");
    if recorded(&end_id) {
        return Ok(());
    }
    // A late plugin install or a missed sessionStart still yields a
    // well-formed session history for later tool and end events.
    if !recorded(&start_id) {
        let mut start = factory.session_event(
            &start_id,
            &now,
            &input.session_id,
            Some(1),
            SessionEventType::SessionStarted,
        );
        persist_attributed_event(&runtime, &factory, &input.cwd, &config, &mut start)?;
    }
    match event {
        HookEvent::PostToolUse => {
            let tool_id = tool_event_id(input);
            if !recorded(&tool_id) {
                let mut tool = factory.session_event(
                    &tool_id,
                    &now,
                    &input.session_id,
                    None,
                    SessionEventType::ToolCompleted,
                );
                persist_attributed_event(&runtime, &factory, &input.cwd, &config, &mut tool)?;
                let capability = factory.capability_status(
                    format!("tools-{tool_id}"),
                    &now,
                    "session.tools",
                    CapabilityState::Available,
                    "post_tool_use_observed",
                );
                runtime
                    .persist_capability(&capability)
                    .map_err(map_store_error)?;
            }
        }
        HookEvent::SessionEnd => {
            let mut end = factory.session_event(
                &end_id,
                &now,
                &input.session_id,
                Some(2),
                SessionEventType::SessionEnded,
            );
            persist_attributed_event(&runtime, &factory, &input.cwd, &config, &mut end)?;
            runtime
                .store()
                .apply_retention(DEFAULT_RETENTION_POLICY)
                .map_err(map_store_error)?;
        }
        _ => {}
    }
    Ok(())
}

/// Observes event-time Git and Jira attribution for `cwd` without persisting it.
pub(crate) fn observe(
    paths: &Paths,
    id: &str,
    cwd: &str,
) -> Result<AttributionSnapshot, ProviderError> {
    let factory = factory("copilot-hook")?;
    let config = load_attribution_config(paths)?;
    let now = now()?;
    observe_with(&factory, &config, id, &now, cwd)
}

fn observe_with(
    factory: &AdapterRecordFactory,
    config: &AttributionConfig,
    id: &str,
    observed_at: &str,
    cwd: &str,
) -> Result<AttributionSnapshot, ProviderError> {
    observe_attribution(
        &AttributionRequest {
            id,
            observed_at,
            source: factory.source().clone(),
            working_directory: Path::new(cwd),
            moment: AttributionMoment::EventTime,
            path_redaction: PathRedaction::RepositoryOrBasename,
        },
        config,
    )
    .map_err(|_| ProviderError::InvalidInput)
}

fn persist_attributed_event(
    runtime: &AdapterRuntime,
    factory: &AdapterRecordFactory,
    cwd: &str,
    config: &AttributionConfig,
    event: &mut SessionEvent,
) -> Result<(), ProviderError> {
    let attribution_id = format!("attr-{}", event.id);
    let attribution = observe_with(factory, config, &attribution_id, &event.observed_at, cwd)?;
    event.attribution_id = Some(attribution_id);
    runtime
        .persist_event_with_attribution(event, &attribution)
        .map_err(map_store_error)?;
    let (state, reason) = match &attribution.git {
        None => (
            CapabilityState::Unavailable,
            "git_unavailable_or_not_repository",
        ),
        Some(git) if git.branch.is_none() => (CapabilityState::Degraded, "branch_unavailable"),
        Some(_) => (CapabilityState::Available, "observed"),
    };
    let capability = factory.capability_status(
        format!("git-{}", event.id),
        &event.observed_at,
        "attribution.git",
        state,
        reason,
    );
    runtime
        .persist_capability(&capability)
        .map_err(map_store_error)?;
    Ok(())
}

fn factory(collector: &str) -> Result<AdapterRecordFactory, ProviderError> {
    AdapterRecordFactory::new(HARNESS, PRODUCT, env!("CARGO_PKG_VERSION"), collector)
        .map_err(|_| ProviderError::InvalidInput)
}

fn now() -> Result<String, ProviderError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|_| ProviderError::InvalidInput)
}

fn event_id(session_id: &str, suffix: &str) -> String {
    format!("copilot-{session_id}-{suffix}")
}

/// Copilot tool hooks carry no tool-use ID. Session, hook timestamp, tool
/// name, and the active chat span together identify one delivery, so a
/// repeated delivery maps to the same event.
fn tool_event_id(input: &HookInput) -> String {
    let material = format!(
        "copilot:{}:tool:{}:{}:{}",
        input.session_id,
        input.timestamp,
        input.tool_name.as_deref().unwrap_or_default(),
        input.traceparent_raw().unwrap_or_default(),
    );
    let digest = Sha256::digest(material.as_bytes());
    let hash: String = digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("copilot-{}-tool-{hash}", input.session_id)
}

pub(crate) fn load_attribution_config(paths: &Paths) -> Result<AttributionConfig, ProviderError> {
    let path = paths.config.join("attribution.json");
    if !path.exists() {
        return Ok(AttributionConfig::default());
    }
    let bytes = fs::read(path)?;
    if bytes.len() > ATTRIBUTION_CONFIG_LIMIT {
        return Err(ProviderError::InputTooLarge);
    }
    let config = serde_json::from_slice::<AttributionConfig>(&bytes)
        .map_err(|_| ProviderError::InvalidInput)?;
    config.validate().map_err(|_| ProviderError::InvalidInput)?;
    Ok(config)
}

fn map_store_error(error: StoreError) -> ProviderError {
    match error {
        StoreError::UnsupportedStoreVersion => ProviderError::UnsupportedSchema,
        StoreError::Io => ProviderError::Io,
        _ => ProviderError::InvalidInput,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hook::read_hook;
    use crate::test_support::{TempRoot, with_cwd};

    fn input(name: &str, event: HookEvent, cwd: &Path) -> HookInput {
        let raw = match name {
            "session-start" => include_str!("../fixtures/hooks/session-start.json"),
            "post-tool-use" => include_str!("../fixtures/hooks/post-tool-use.json"),
            "agent-stop" => include_str!("../fixtures/hooks/agent-stop.json"),
            "session-end" => include_str!("../fixtures/hooks/session-end.json"),
            _ => unreachable!(),
        };
        let raw = with_cwd(raw, cwd);
        read_hook(raw.as_bytes(), event).unwrap()
    }

    fn event_types(paths: &Paths) -> Vec<SessionEventType> {
        let runtime = AdapterRuntime::open(paths.store()).unwrap();
        let mut events = runtime.snapshot().unwrap().events;
        events.sort_by(|a, b| a.id.cmp(&b.id));
        events.into_iter().map(|event| event.event_type).collect()
    }

    #[test]
    fn lifecycle_and_tool_hooks_are_recorded_once() {
        let root = TempRoot::new("lifecycle");
        let paths = root.paths();
        let cwd = root.path();
        for (name, event) in [
            ("session-start", HookEvent::SessionStart),
            ("session-start", HookEvent::SessionStart),
            ("post-tool-use", HookEvent::PostToolUse),
            ("post-tool-use", HookEvent::PostToolUse),
            ("agent-stop", HookEvent::AgentStop),
            ("session-end", HookEvent::SessionEnd),
            ("session-end", HookEvent::SessionEnd),
        ] {
            accept_hook(&paths, event, &input(name, event, cwd)).unwrap();
        }
        let types = event_types(&paths);
        assert_eq!(types.len(), 3, "{types:?}");
        assert!(types.contains(&SessionEventType::SessionStarted));
        assert!(types.contains(&SessionEventType::ToolCompleted));
        assert!(types.contains(&SessionEventType::SessionEnded));
    }

    #[test]
    fn tool_hook_without_session_start_creates_the_start() {
        let root = TempRoot::new("late-install");
        let paths = root.paths();
        let tool = input("post-tool-use", HookEvent::PostToolUse, root.path());
        accept_hook(&paths, HookEvent::PostToolUse, &tool).unwrap();
        let types = event_types(&paths);
        assert!(types.contains(&SessionEventType::SessionStarted));
        assert!(types.contains(&SessionEventType::ToolCompleted));
    }

    #[test]
    fn agent_stop_writes_no_local_record() {
        let root = TempRoot::new("agent-stop");
        let paths = root.paths();
        let stop = input("agent-stop", HookEvent::AgentStop, root.path());
        accept_hook(&paths, HookEvent::AgentStop, &stop).unwrap();
        assert!(!paths.store().exists());
    }

    #[test]
    fn stored_records_contain_no_hook_content() {
        let root = TempRoot::new("privacy");
        let paths = root.paths();
        let tool = input("post-tool-use", HookEvent::PostToolUse, root.path());
        accept_hook(&paths, HookEvent::PostToolUse, &tool).unwrap();
        let mut stored = String::new();
        for entry in walk(&paths.store()) {
            stored.push_str(&String::from_utf8_lossy(&fs::read(entry).unwrap()));
        }
        assert!(!stored.is_empty());
        for marker in ["TOOL-ARGS-MARKER", "TOOL-RESULT-MARKER", "bash"] {
            assert!(!stored.contains(marker), "store retained {marker}");
        }
    }

    fn walk(dir: &Path) -> Vec<std::path::PathBuf> {
        let mut files = Vec::new();
        for entry in fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(walk(&path));
            } else {
                files.push(path);
            }
        }
        files
    }
}
