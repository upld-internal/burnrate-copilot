//! Copilot CLI hook input.
//!
//! Field names were observed from Copilot CLI 1.0.88 plugin hooks (see
//! `docs/copilot-otel-probe.md`). Prompt, tool argument, tool result, and
//! transcript fields are deliberately absent from these types so they are
//! discarded during deserialization and never reach Burnrate records.

use std::io::Read;

use serde::Deserialize;

use crate::provider::{ProviderError, read_bounded};

const HOOK_INPUT_LIMIT: usize = 64 * 1024;
/// `postToolUse` carries the tool result, which can be large even though it is
/// discarded.
const TOOL_HOOK_INPUT_LIMIT: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookEvent {
    SessionStart,
    UserPromptSubmitted,
    PostToolUse,
    AgentStop,
    SessionEnd,
}

impl HookEvent {
    pub fn from_argument(argument: &str) -> Option<Self> {
        Some(match argument {
            "session-start" => Self::SessionStart,
            "user-prompt-submitted" => Self::UserPromptSubmitted,
            "post-tool-use" => Self::PostToolUse,
            "agent-stop" => Self::AgentStop,
            "session-end" => Self::SessionEnd,
            _ => return None,
        })
    }

    const fn input_limit(self) -> usize {
        match self {
            Self::PostToolUse => TOOL_HOOK_INPUT_LIMIT,
            _ => HOOK_INPUT_LIMIT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookInput {
    pub session_id: String,
    /// Unix epoch milliseconds.
    pub timestamp: u64,
    pub cwd: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    traceparent: Option<String>,
}

impl HookInput {
    /// The W3C trace context of the span active when the hook fired. On
    /// `agentStop` and `sessionEnd` this is the turn's root `invoke_agent`
    /// span; on tool hooks it is the current `chat` span.
    pub fn trace_parent(&self) -> Option<TraceParent> {
        self.traceparent.as_deref().and_then(TraceParent::parse)
    }
}

pub fn read_hook(reader: impl Read, event: HookEvent) -> Result<HookInput, ProviderError> {
    let bytes = read_bounded(reader, event.input_limit())?;
    let input: HookInput =
        serde_json::from_slice(&bytes).map_err(|_| ProviderError::InvalidInput)?;
    validate(&input, event)?;
    Ok(input)
}

fn validate(input: &HookInput, event: HookEvent) -> Result<(), ProviderError> {
    let bounded = |value: &str, max: usize| !value.is_empty() && value.len() <= max;
    if !bounded(&input.session_id, 128)
        || input.session_id.chars().any(char::is_control)
        || !bounded(&input.cwd, 4096)
    {
        return Err(ProviderError::InvalidInput);
    }
    if event == HookEvent::PostToolUse
        && !input
            .tool_name
            .as_deref()
            .is_some_and(|name| bounded(name, 256))
    {
        return Err(ProviderError::InvalidInput);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TraceParent {
    pub trace_id: [u8; 16],
    pub span_id: [u8; 8],
    pub flags: u8,
}

impl TraceParent {
    /// Parses a version-00 W3C `traceparent`, rejecting all-zero identifiers.
    pub fn parse(value: &str) -> Option<Self> {
        let mut parts = value.split('-');
        let (version, trace, span, flags) =
            (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
        if parts.next().is_some() || version != "00" {
            return None;
        }
        let trace_id: [u8; 16] = decode_hex(trace)?.try_into().ok()?;
        let span_id: [u8; 8] = decode_hex(span)?.try_into().ok()?;
        let flags = *decode_hex(flags)?.first().filter(|_| flags.len() == 2)?;
        if trace_id == [0; 16] || span_id == [0; 8] {
            return None;
        }
        Some(Self {
            trace_id,
            span_id,
            flags,
        })
    }
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> &'static str {
        match name {
            "session-start" => include_str!("../fixtures/hooks/session-start.json"),
            "user-prompt-submitted" => {
                include_str!("../fixtures/hooks/user-prompt-submitted.json")
            }
            "post-tool-use" => include_str!("../fixtures/hooks/post-tool-use.json"),
            "agent-stop" => include_str!("../fixtures/hooks/agent-stop.json"),
            "session-end" => include_str!("../fixtures/hooks/session-end.json"),
            _ => unreachable!(),
        }
    }

    fn parse(name: &str) -> HookInput {
        read_hook(
            fixture(name).as_bytes(),
            HookEvent::from_argument(name).unwrap(),
        )
        .expect("fixture must validate")
    }

    #[test]
    fn observed_payloads_validate() {
        assert_eq!(parse("session-start").source.as_deref(), Some("new"));
        assert_eq!(parse("post-tool-use").tool_name.as_deref(), Some("bash"));
        assert_eq!(parse("agent-stop").stop_reason.as_deref(), Some("end_turn"));
        assert_eq!(parse("session-end").reason.as_deref(), Some("complete"));
        assert_eq!(parse("user-prompt-submitted").trace_parent(), None);
    }

    #[test]
    fn content_fields_are_discarded() {
        for name in [
            "session-start",
            "user-prompt-submitted",
            "post-tool-use",
            "agent-stop",
        ] {
            let retained = format!("{:?}", parse(name));
            for marker in [
                "PROMPT-CONTENT-MARKER",
                "TOOL-ARGS-MARKER",
                "TOOL-RESULT-MARKER",
                "events.jsonl",
            ] {
                assert!(!retained.contains(marker), "{name} retained {marker}");
            }
        }
    }

    #[test]
    fn agent_stop_identifies_the_turn_root_span() {
        let parent = parse("agent-stop").trace_parent().unwrap();
        assert_eq!(parent.trace_id[..2], [0x32, 0xd7]);
        assert_eq!(
            parent.span_id,
            [0x15, 0x6d, 0xa7, 0x7f, 0x89, 0x17, 0x86, 0xf8]
        );
        assert_eq!(parent.flags, 1);
    }

    #[test]
    fn malformed_trace_parents_are_rejected() {
        for value in [
            "",
            "01-32d796bfcf46f9746b04321034d0eee7-156da77f891786f8-01",
            "00-00000000000000000000000000000000-156da77f891786f8-01",
            "00-32d796bfcf46f9746b04321034d0eee7-0000000000000000-01",
            "00-32D796BFCF46F9746B04321034D0EEE7-156da77f891786f8-01",
            "00-32d796bfcf46f9746b04321034d0eee7-156da77f891786f8-1",
            "00-32d796bfcf46f9746b04321034d0eee7-156da77f891786f8-01-x",
        ] {
            assert_eq!(TraceParent::parse(value), None, "{value}");
        }
    }

    #[test]
    fn tool_hook_requires_tool_name() {
        let input = fixture("post-tool-use").replace("\"toolName\":\"bash\",", "");
        assert_eq!(
            read_hook(input.as_bytes(), HookEvent::PostToolUse),
            Err(ProviderError::InvalidInput)
        );
    }

    #[test]
    fn oversized_lifecycle_input_is_rejected() {
        let input = format!("{{\"pad\":\"{}\"}}", "x".repeat(HOOK_INPUT_LIMIT));
        assert_eq!(
            read_hook(input.as_bytes(), HookEvent::SessionStart),
            Err(ProviderError::InputTooLarge)
        );
    }
}
