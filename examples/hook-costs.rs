//! Opt-in diagnostic breakdown; independent measurements do not replace the hook gate.
use burnrate_adapter_kit::contracts::{CapabilityState, SessionEventType};
use burnrate_adapter_kit::core::{
    AttributionConfig, AttributionMoment, AttributionRequest, PathRedaction, observe_attribution,
};
use burnrate_adapter_kit::{AdapterRecordFactory, AdapterRuntime};
use serde_json::{Value, json};
use std::{
    error::Error,
    fs,
    path::Path,
    process::{Command, Stdio},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

fn measure(
    mut action: impl FnMut(usize) -> Result<(), Box<dyn Error>>,
) -> Result<Value, Box<dyn Error>> {
    let mut times = Vec::new();
    for n in 0..120 {
        let begin = Instant::now();
        action(n)?;
        if n >= 20 {
            times.push(begin.elapsed().as_micros());
        }
    }
    times.sort_unstable();
    Ok(
        json!({"warmup":20,"samples":100,"p50_micros":times[49],"p95_micros":times[94],"p99_micros":times[98]}),
    )
}
fn git(root: &Path, args: &[&str]) -> Result<(), Box<dyn Error>> {
    if !Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?
        .success()
    {
        return Err("fixture_git_failed".into());
    }
    Ok(())
}
fn main() -> Result<(), Box<dyn Error>> {
    let binary = std::env::args_os().nth(1).ok_or("binary_required")?;
    let build_output = Command::new(&binary).arg("build-info").output()?;
    if !build_output.status.success() || !build_output.stderr.is_empty() {
        return Err("build_identity_unavailable".into());
    }
    let tested_build: Value = serde_json::from_slice(&build_output.stdout)?;
    let root = std::env::temp_dir().join(format!(
        "Burnrate hook profile ü {}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    ));
    fs::create_dir_all(&root)?;
    git(&root, &["init", "-q", "-b", "feature/ABC-123-profile"])?;
    git(
        &root,
        &[
            "-c",
            "user.name=Burnrate fixture",
            "-c",
            "user.email=fixture@example.test",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-q",
            "-m",
            "fixture",
        ],
    )?;
    git(
        &root,
        &[
            "remote",
            "add",
            "origin",
            "git@github.com:upld-internal/burnrate-copilot.git",
        ],
    )?;
    let store = root.join("store");
    let runtime = AdapterRuntime::open(&store)?;
    let factory = AdapterRecordFactory::new(
        "copilot",
        "burnrate-copilot",
        env!("CARGO_PKG_VERSION"),
        "benchmark",
    )?;
    for n in 0..1000 {
        runtime.persist_event(&factory.session_event(
            format!("seed-{n}"),
            "2026-10-02T12:00:00Z",
            format!("seed-session-{n}"),
            Some(0),
            SessionEventType::SessionStarted,
        ))?;
    }
    let startup = measure(|_| {
        let mut command = Command::new(&binary);
        command
            .arg("version")
            .env("BURNRATE_COPILOT_HOME", root.join("data"));
        for key in [
            "LANGFUSE_BASE_URL",
            "LANGFUSE_HOST",
            "LANGFUSE_PUBLIC_KEY",
            "LANGFUSE_SECRET_KEY",
        ] {
            command.env_remove(key);
        }
        let output = command.output()?;
        if !output.status.success()
            || output.stdout != format!("{}\n", env!("CARGO_PKG_VERSION")).as_bytes()
            || !output.stderr.is_empty()
        {
            return Err("version_child_failed".into());
        }
        Ok(())
    })?;
    let snapshot = measure(|_| {
        let (_, snap) = AdapterRuntime::open_with_snapshot(&store)?;
        if snap.events.len() != 1000 {
            return Err("corpus_mismatch".into());
        }
        Ok(())
    })?;
    let config = AttributionConfig::default();
    let request = AttributionRequest {
        id: "profile-git",
        observed_at: "2026-10-02T12:00:00Z",
        source: factory.source().clone(),
        working_directory: &root,
        moment: AttributionMoment::EventTime,
        path_redaction: PathRedaction::RepositoryOrBasename,
    };
    let git_observation = measure(|_| {
        let attribution =
            observe_attribution(&request, &config).map_err(|_| "attribution_failed")?;
        if attribution.git.as_ref().and_then(|x| x.branch.as_deref())
            != Some("feature/ABC-123-profile")
        {
            return Err("git_observation_mismatch".into());
        }
        Ok(())
    })?;
    let attribution = observe_attribution(&request, &config).map_err(|_| "attribution_failed")?;
    let admission = measure(|n| {
        let mut attr = attribution.clone();
        attr.id = format!("profile-attr-{n}");
        let mut event = factory.session_event(
            format!("profile-tool-{n}"),
            "2026-10-02T12:00:00Z",
            "seed-session-0",
            None,
            SessionEventType::ToolCompleted,
        );
        event.attribution_id = Some(attr.id.clone());
        runtime.persist_event_with_attribution(&event, &attr)?;
        for (prefix, name, reason) in [
            ("git", "attribution.git", "observed"),
            ("tools", "session.tools", "post_tool_use_observed"),
        ] {
            runtime.persist_capability(&factory.capability_status(
                format!("{prefix}-{n}"),
                "2026-10-02T12:00:00Z",
                name,
                CapabilityState::Available,
                reason,
            ))?;
        }
        Ok(())
    })?;
    println!(
        "{}",
        json!({"profile":"diagnostic_only","profile_build":burnrate_copilot::build_info::build_info(),"tested_binary_build":tested_build,"host":{"os":std::env::consts::OS,"architecture":std::env::consts::ARCH,"runner_image":std::env::var("ImageOS").ok(),"runner_image_version":std::env::var("ImageVersion").ok()},"initial_events":1000,"initial_open_sessions":1000,"event_growth":120,"capability_growth":240,"components":{"executable_startup_version":startup,"store_open_snapshot":snapshot,"git_observation":git_observation,"cached_attributed_event_and_two_capabilities":admission},"comparison_note":"Components measured independently; percentile values cannot be added. This diagnostic is not release acceptance."})
    );
    fs::remove_dir_all(&root)?;
    Ok(())
}
