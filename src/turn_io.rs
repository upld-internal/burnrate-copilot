//! Opt-in turn input and output for the Langfuse trace list.
//!
//! Copilot's exporter puts messages only on its spans, so Langfuse's trace
//! list shows no input or output. When `BURNRATE_LANGFUSE_TURN_IO=true`, the
//! `agentStop` span sets `langfuse.trace.input` to the turn's user message and
//! `langfuse.trace.output` to its final assistant message. The detached
//! sender reads them from Copilot's session transcript; only the transcript
//! path passes through the hook, and the text is never written to Burnrate
//! storage or diagnostics.

use std::env;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const OPT_IN_VARIABLE: &str = "BURNRATE_LANGFUSE_TURN_IO";
const TRANSCRIPT_LIMIT: u64 = 64 * 1024 * 1024;
/// Per-field cap so one turn stays well inside a single OTLP request.
pub const FIELD_LIMIT: usize = 128 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnIo {
    pub input: String,
    pub output: String,
}

pub fn enabled() -> bool {
    matches!(env::var(OPT_IN_VARIABLE).as_deref(), Ok("true" | "1"))
}

/// Waits until Copilot has written the turn's `agentStop` hook start to the
/// transcript, then reads the turn. Copilot appends the final assistant
/// message only milliseconds before running the hook, so an immediate read
/// can miss it. After `timeout`, a turn without the marker yields nothing.
pub fn read_completed(transcript: &Path, session_id: &str, timeout: Duration) -> Option<TurnIo> {
    let deadline = Instant::now() + timeout;
    loop {
        match scan(transcript, session_id)? {
            Scan::Complete(turn_io) => return turn_io,
            Scan::Pending if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
            Scan::Pending => return None,
        }
    }
}

enum Scan {
    /// The `agentStop` marker follows the last user message.
    Complete(Option<TurnIo>),
    Pending,
}

/// Reads the last user message and the final non-empty assistant message of
/// the same interaction. Only `<...>/session-state/<session_id>/events.jsonl`
/// is accepted, so the hook cannot be pointed at another file. Returns `None`
/// when the transcript cannot be read.
fn scan(transcript: &Path, session_id: &str) -> Option<Scan> {
    if file_name(Some(transcript)) != Some("events.jsonl")
        || file_name(transcript.parent()) != Some(session_id)
        || file_name(transcript.parent().and_then(Path::parent)) != Some("session-state")
    {
        return None;
    }
    let file = File::open(transcript).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > TRANSCRIPT_LIMIT {
        return None;
    }
    let mut input: Option<(String, String)> = None;
    let mut output: Option<String> = None;
    let mut stopped = false;
    for line in BufReader::new(file).lines() {
        let line = line.ok()?;
        let relevant = ["\"user.message\"", "\"assistant.message\"", "\"agentStop\""]
            .iter()
            .any(|marker| line.contains(marker));
        if !relevant {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let data = &event["data"];
        if event["type"] == "hook.start" && data["hookType"] == "agentStop" {
            stopped = input.is_some();
            continue;
        }
        let (Some(content), Some(interaction)) =
            (data["content"].as_str(), data["interactionId"].as_str())
        else {
            continue;
        };
        match event["type"].as_str() {
            Some("user.message") => {
                input = Some((interaction.to_owned(), content.to_owned()));
                output = None;
                stopped = false;
            }
            Some("assistant.message")
                if !content.trim().is_empty()
                    && input.as_ref().is_some_and(|(id, _)| id == interaction) =>
            {
                output = Some(content.to_owned());
            }
            _ => {}
        }
    }
    if !stopped {
        return Some(Scan::Pending);
    }
    Some(Scan::Complete(input.zip(output).map(
        |((_, input), output)| TurnIo {
            input: truncate(input),
            output: truncate(output),
        },
    )))
}

fn file_name(path: Option<&Path>) -> Option<&str> {
    path.and_then(Path::file_name)
        .and_then(|name| name.to_str())
}

fn truncate(mut value: String) -> String {
    if value.len() > FIELD_LIMIT {
        let mut end = FIELD_LIMIT;
        while !value.is_char_boundary(end) {
            end -= 1;
        }
        value.truncate(end);
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempRoot;

    fn transcript(root: &TempRoot, session: &str, lines: &[&str]) -> std::path::PathBuf {
        let dir = root.path().join("session-state").join(session);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("events.jsonl");
        std::fs::write(&path, lines.join("\n")).unwrap();
        path
    }

    const USER_1: &str =
        r#"{"type":"user.message","data":{"content":"first question","interactionId":"i1"}}"#;
    const REPLY_1: &str =
        r#"{"type":"assistant.message","data":{"content":"first answer","interactionId":"i1"}}"#;
    const USER_2: &str =
        r#"{"type":"user.message","data":{"content":"Read the README","interactionId":"i2"}}"#;
    const INTERIM: &str =
        r#"{"type":"assistant.message","data":{"content":"Reading it now.","interactionId":"i2"}}"#;
    const TOOL_ONLY: &str =
        r#"{"type":"assistant.message","data":{"content":"","interactionId":"i2"}}"#;
    const FINAL: &str =
        r#"{"type":"assistant.message","data":{"content":"It contains hi.","interactionId":"i2"}}"#;

    const STOP: &str = r#"{"type":"hook.start","data":{"hookType":"agentStop","input":{}}}"#;
    const WAIT: Duration = Duration::from_millis(250);

    #[test]
    fn reads_the_current_interaction_and_its_final_answer() {
        let root = TempRoot::new("turn-io");
        let path = transcript(
            &root,
            "s1",
            &[
                USER_1, REPLY_1, STOP, USER_2, INTERIM, TOOL_ONLY, FINAL, "not json", STOP,
            ],
        );
        assert_eq!(
            read_completed(&path, "s1", WAIT),
            Some(TurnIo {
                input: "Read the README".into(),
                output: "It contains hi.".into(),
            })
        );
    }

    #[test]
    fn waits_for_the_agent_stop_marker_of_the_current_turn() {
        let root = TempRoot::new("turn-io-pending");
        // The previous turn's marker must not complete the current turn.
        let path = transcript(&root, "s1", &[USER_1, REPLY_1, STOP, USER_2, INTERIM]);
        let writer = {
            let path = path.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(150));
                let lines = [USER_1, REPLY_1, STOP, USER_2, INTERIM, FINAL, STOP];
                std::fs::write(path, lines.join("\n")).unwrap();
            })
        };
        let result = read_completed(&path, "s1", Duration::from_secs(2));
        writer.join().unwrap();
        assert_eq!(
            result.map(|turn| turn.output),
            Some("It contains hi.".into())
        );
    }

    #[test]
    fn a_turn_without_the_marker_or_an_answer_yields_nothing() {
        let root = TempRoot::new("turn-io-open");
        let unfinished = transcript(&root, "s1", &[USER_2, FINAL]);
        assert_eq!(read_completed(&unfinished, "s1", WAIT), None);
        let unanswered = transcript(&root, "s2", &[USER_2, TOOL_ONLY, STOP]);
        assert_eq!(read_completed(&unanswered, "s2", WAIT), None);
    }

    #[test]
    fn only_the_sessions_own_transcript_is_read() {
        let root = TempRoot::new("turn-io-path");
        let path = transcript(&root, "s1", &[USER_2, FINAL, STOP]);
        assert_eq!(read_completed(&path, "other-session", WAIT), None);
        let elsewhere = root.path().join("events.jsonl");
        std::fs::write(&elsewhere, [USER_2, FINAL, STOP].join("\n")).unwrap();
        assert_eq!(read_completed(&elsewhere, "s1", WAIT), None);
    }

    #[test]
    fn long_fields_are_truncated_on_a_character_boundary() {
        let value = "é".repeat(FIELD_LIMIT);
        let truncated = truncate(value);
        assert!(truncated.len() <= FIELD_LIMIT);
        assert!(truncated.chars().all(|c| c == 'é'));
    }
}
