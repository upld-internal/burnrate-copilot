//! Native release hook gate. Uses local fixture data and no destination credentials.
use std::fs;
use std::process::{Command, Stdio};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use burnrate_adapter_kit::contracts::SessionEventType;
use burnrate_adapter_kit::{AdapterRecordFactory, AdapterRuntime};
use serde_json::json;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let binary = args.first().ok_or("binary argument required")?;
    let root = std::env::temp_dir().join(format!(
        "burnrate hook bench ü {}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    ));
    fs::create_dir_all(&root)?;
    for arguments in [
        vec!["init", "-q", "-b", "feature/ABC-123-benchmark"],
        vec![
            "remote",
            "add",
            "origin",
            "git@github.com:upld-internal/burnrate-copilot.git",
        ],
    ] {
        if !Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(arguments)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?
            .success()
        {
            return Err("benchmark Git fixture failed".into());
        }
    }
    let data = if cfg!(windows) {
        root.join("local").join("burnrate-copilot")
    } else if cfg!(target_os = "macos") {
        root.join("Library/Application Support/burnrate-copilot")
    } else {
        root.join("state/burnrate-copilot")
    };
    let runtime = AdapterRuntime::open(data.join("store"))?;
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
    let mut measured = Vec::new();
    for n in 0..120 {
        let mut command = Command::new(binary);
        command
            .args(["hook", "post-tool-use"])
            .env("BURNRATE_COPILOT_HOME", &data)
            .env("HOME", &root)
            .env("USERPROFILE", &root)
            .env("LOCALAPPDATA", root.join("local"))
            .env("XDG_STATE_HOME", root.join("state"))
            .env("XDG_CONFIG_HOME", root.join("config"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for key in [
            "LANGFUSE_BASE_URL",
            "LANGFUSE_HOST",
            "LANGFUSE_PUBLIC_KEY",
            "LANGFUSE_SECRET_KEY",
        ] {
            command.env_remove(key);
        }
        let input = json!({"sessionId":"measured-session","timestamp":1790942400000_u64+n,"cwd":root,"toolName":"fixture-tool"});
        let started = Instant::now();
        let mut child = command.spawn()?;
        use std::io::Write;
        child
            .stdin
            .take()
            .ok_or("stdin unavailable")?
            .write_all(&serde_json::to_vec(&input)?)?;
        let output = child.wait_with_output()?;
        let micros = started.elapsed().as_micros();
        if !output.status.success() || !output.stdout.is_empty() || !output.stderr.is_empty() {
            return Err("hook benchmark failed".into());
        }
        if n >= 20 {
            measured.push(micros);
        }
    }
    measured.sort_unstable();
    let p95 = measured[94];
    let p99 = measured[98];
    let passed = p95 <= 100_000 && p99 <= 250_000;
    println!(
        "{}",
        json!({"profile":"release","operation":"provider_hook","existing_events":1000,"warmup":20,"samples":100,"p95_micros":p95,"p99_micros":p99,"passed":passed,"build":burnrate_copilot::build_info::build_info()})
    );
    fs::remove_dir_all(root)?;
    if !passed {
        return Err("hook performance budget exceeded".into());
    }
    Ok(())
}
