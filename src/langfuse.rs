//! Langfuse metadata span for Copilot turns.
//!
//! Copilot sends its own turn traces through its built-in OTel exporter. At
//! `agentStop`, Burnrate adds one span to that trace, as a child of the turn's
//! root span, carrying the cross-harness metadata from
//! `burnrate-spec/docs/spec/trace-metadata.md`. Copilot removes `OTEL_*`
//! variables from hook environments, so the destination comes from the
//! standard `LANGFUSE_*` variables. Contract:
//! `burnrate-spec/docs/spec/copilot-langfuse-attribution.md`.

use std::collections::BTreeMap;
use std::env;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::hook::{HookInput, TraceParent};
use crate::provider::{PRODUCT, Paths, ProviderError, read_bounded, write_private};
use crate::turn_io::{self, TurnIo};

pub const HARNESS: &str = "harness";
pub const COPILOT_HARNESS: &str = "copilot_cli";
pub const GIT_BRANCH: &str = "git_branch";
pub const GIT_REPOSITORY: &str = "git_repository";
pub const JIRA_KEY: &str = "jira_key";
pub const JIRA_KEYS: &str = "jira_keys";

const OTLP_PATH: &str = "/api/public/otel/v1/traces";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_LIMIT: usize = 1024 * 1024;
const TRANSCRIPT_WAIT: Duration = Duration::from_secs(5);
const SPAN_NAME: &str = "burnrate.attribution";
/// Replaces the default trace name, Copilot's root span `invoke_agent`, to
/// match Codex's `Codex Turn`.
pub const TRACE_NAME: &str = "Copilot Turn";
const SEND_SUBCOMMAND: [&str; 2] = ["langfuse", "send"];

/// Where the metadata span is sent. Credentials stay in memory only.
pub struct Destination {
    url: reqwest::Url,
    public_key: String,
    secret_key: String,
}

impl Destination {
    pub fn from_environment() -> Result<Self, SkipReason> {
        let base = env::var("LANGFUSE_BASE_URL")
            .or_else(|_| env::var("LANGFUSE_HOST"))
            .map_err(|_| SkipReason::NotConfigured)?;
        let public_key = env::var("LANGFUSE_PUBLIC_KEY").map_err(|_| SkipReason::NotConfigured)?;
        let secret_key = env::var("LANGFUSE_SECRET_KEY").map_err(|_| SkipReason::NotConfigured)?;
        let usable = |value: &str| !value.is_empty() && !value.chars().any(char::is_control);
        if !usable(&public_key) || !usable(&secret_key) {
            return Err(SkipReason::InvalidConfiguration);
        }
        Ok(Self {
            url: endpoint(&base).ok_or(SkipReason::InvalidConfiguration)?,
            public_key,
            secret_key,
        })
    }

    pub fn host(&self) -> Option<&str> {
        self.url.host_str()
    }
}

/// Resolves the OTLP trace endpoint below a Langfuse base URL. Only HTTPS
/// without embedded credentials, query, or fragment is accepted, matching the
/// host exporter's refusal of cleartext endpoints.
fn endpoint(base: &str) -> Option<reqwest::Url> {
    let base = reqwest::Url::parse(base.trim_end_matches('/')).ok()?;
    if base.scheme() != "https"
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return None;
    }
    let mut url = base.clone();
    url.set_path(&format!("{}{OTLP_PATH}", base.path().trim_end_matches('/')));
    Some(url)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    NotConfigured,
    InvalidConfiguration,
    NoTraceContext,
}

impl SkipReason {
    const fn state(self) -> &'static str {
        match self {
            Self::NotConfigured => "skipped_not_configured",
            Self::InvalidConfiguration => "skipped_invalid_configuration",
            Self::NoTraceContext => "skipped_no_trace_context",
        }
    }
}

/// Cross-harness metadata for the current turn. Values are derived only from
/// event-time attribution; nothing is inherited from earlier turns.
pub fn metadata(paths: &Paths, cwd: &str) -> Result<BTreeMap<&'static str, String>, ProviderError> {
    let attribution = crate::runtime::observe(paths, "langfuse-agent-stop", cwd)?;
    let mut result = BTreeMap::new();
    result.insert(HARNESS, COPILOT_HARNESS.to_owned());
    if let Some(git) = attribution.git {
        if let Some(branch) = git.branch {
            result.insert(GIT_BRANCH, branch);
        }
        // A bare checkout directory name is a local display fallback, not a
        // remote repository identity suitable for a trace filter.
        if let Some(repository) = git.repository.filter(|value| value.contains('/')) {
            result.insert(GIT_REPOSITORY, repository);
        }
    }
    let keys: Vec<_> = attribution
        .work_items
        .iter()
        .filter(|item| item.system == "jira")
        .map(|item| item.key.as_str())
        .collect();
    if !keys.is_empty() {
        result.insert(JIRA_KEYS, keys.join(","));
        if let [key] = keys.as_slice() {
            result.insert(JIRA_KEY, (*key).to_owned());
        }
    }
    Ok(result)
}

/// The span identity is derived from the session and the turn's root span, so
/// a repeated `agentStop` for the same turn produces the same span.
fn span_id(session_id: &str, parent: &TraceParent) -> String {
    let material = format!(
        "burnrate:copilot:agent-stop:{session_id}:{}:{}",
        hex(&parent.trace_id),
        hex(&parent.span_id)
    );
    let digest = Sha256::digest(material.as_bytes());
    let mut id: [u8; 8] = digest[..8].try_into().expect("digest has 32 bytes");
    if id == [0; 8] {
        id[7] = 1;
    }
    hex(&id)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn attribute(key: &str, value: &str) -> Value {
    json!({"key": key, "value": {"stringValue": value}})
}

/// Builds an OTLP/HTTP JSON request containing only the metadata span.
pub fn request_body(
    session_id: &str,
    parent: &TraceParent,
    metadata: &BTreeMap<&'static str, String>,
    now_unix_nanos: i128,
) -> Value {
    let mut attributes = vec![attribute("langfuse.trace.name", TRACE_NAME)];
    attributes.extend(
        metadata
            .iter()
            .map(|(key, value)| attribute(&format!("langfuse.trace.metadata.{key}"), value)),
    );
    let span = json!({
        "traceId": hex(&parent.trace_id),
        "spanId": span_id(session_id, parent),
        "parentSpanId": hex(&parent.span_id),
        "name": SPAN_NAME,
        "kind": 1,
        "startTimeUnixNano": now_unix_nanos.to_string(),
        "endTimeUnixNano": now_unix_nanos.to_string(),
        "attributes": attributes,
    });
    // No resource attributes: Langfuse copies the resource of the span that
    // carries trace metadata onto the trace, which would present Burnrate as
    // the service that produced Copilot's trace.
    json!({"resourceSpans": [{
        "resource": {"attributes": []},
        "scopeSpans": [{
            "scope": {"name": PRODUCT, "version": env!("CARGO_PKG_VERSION")},
            "spans": [span],
        }],
    }]})
}

/// Sets the Codex-style trace input and output shown in Langfuse's trace list.
pub fn add_turn_io(body: &mut Value, turn_io: &TurnIo) {
    if let Some(attributes) =
        body["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["attributes"].as_array_mut()
    {
        attributes.push(attribute("langfuse.trace.input", &turn_io.input));
        attributes.push(attribute("langfuse.trace.output", &turn_io.output));
    }
}

/// Handed from the hook to the detached sender on stdin. It carries the
/// transcript path, never transcript text.
#[derive(Debug, Serialize, Deserialize)]
struct SendRequest {
    session_id: String,
    body: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    transcript_path: Option<String>,
}

/// `agentStop`: observe attribution, then hand the span to a detached sender
/// so the turn is not delayed by the network.
pub fn dispatch_agent_stop(paths: &Paths, input: &HookInput) -> Result<(), ProviderError> {
    let Some(parent) = input.trace_parent() else {
        record_attempt(
            paths,
            &input.session_id,
            SkipReason::NoTraceContext.state(),
            None,
        );
        return Ok(());
    };
    if let Err(reason) = Destination::from_environment() {
        record_attempt(paths, &input.session_id, reason.state(), None);
        return Ok(());
    }
    let metadata = metadata(paths, &input.cwd)?;
    let request = SendRequest {
        session_id: input.session_id.clone(),
        body: request_body(
            &input.session_id,
            &parent,
            &metadata,
            OffsetDateTime::now_utc().unix_timestamp_nanos(),
        ),
        transcript_path: input.transcript_path.clone().filter(|_| turn_io::enabled()),
    };
    let bytes = serde_json::to_vec(&request).map_err(|_| ProviderError::InvalidInput)?;
    record_attempt(paths, &input.session_id, "dispatched", None);
    let mut child = Command::new(env::current_exe()?)
        .args(SEND_SUBCOMMAND)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let mut stdin = child.stdin.take().ok_or(ProviderError::Io)?;
    stdin.write_all(&bytes)?;
    // Dropping stdin closes the pipe; the sender continues after this hook exits.
    Ok(())
}

/// The detached sender. It records its outcome but never reports it to the host.
pub fn send(reader: impl Read) -> Result<(), ProviderError> {
    let paths = Paths::discover()?;
    let bytes = read_bounded(reader, REQUEST_LIMIT)?;
    let mut request: SendRequest =
        serde_json::from_slice(&bytes).map_err(|_| ProviderError::InvalidInput)?;
    let destination = match Destination::from_environment() {
        Ok(destination) => destination,
        Err(reason) => {
            record_attempt(&paths, &request.session_id, reason.state(), None);
            return Ok(());
        }
    };
    if let Some(path) = &request.transcript_path {
        let transcript = std::path::Path::new(path);
        if let Some(turn_io) =
            turn_io::read_completed(transcript, &request.session_id, TRANSCRIPT_WAIT)
        {
            add_turn_io(&mut request.body, &turn_io);
        }
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .build()
        .map_err(|_| ProviderError::Io)?;
    let response = client
        .post(destination.url.clone())
        .basic_auth(&destination.public_key, Some(&destination.secret_key))
        .header("x-langfuse-ingestion-version", "4")
        .json(&request.body)
        .send();
    let (state, status) = match response {
        Ok(value) if value.status().is_success() => ("sent", Some(value.status().as_u16())),
        Ok(value) => ("rejected", Some(value.status().as_u16())),
        Err(error) if error.is_timeout() => ("timed_out", None),
        Err(_) => ("transport_failed", None),
    };
    record_attempt(&paths, &request.session_id, state, status);
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LastAttempt {
    pub schema_version: String,
    pub session_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    pub observed_at: String,
    pub adapter_version: String,
}

fn last_attempt_path(paths: &Paths) -> std::path::PathBuf {
    paths.state().join("langfuse-last-turn.json")
}

fn record_attempt(paths: &Paths, session_id: &str, state: &str, http_status: Option<u16>) {
    let Ok(observed_at) = OffsetDateTime::now_utc().format(&Rfc3339) else {
        return;
    };
    let attempt = LastAttempt {
        schema_version: "1".into(),
        session_id: session_id.into(),
        state: state.into(),
        http_status,
        observed_at,
        adapter_version: env!("CARGO_PKG_VERSION").into(),
    };
    if let Ok(bytes) = serde_json::to_vec(&attempt) {
        if write_private(&last_attempt_path(paths), &bytes).is_err() {
            eprintln!("burnrate_langfuse_diagnostic_write_failed");
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Status {
    /// `configured`, `not_configured`, or `invalid_configuration`.
    pub configuration: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_attempt: Option<LastAttempt>,
    /// A `sent` attempt is not proof of ingestion; read the trace back.
    pub note: &'static str,
}

pub fn status() -> Result<Status, ProviderError> {
    let paths = Paths::discover()?;
    let (configuration, host) = match Destination::from_environment() {
        Ok(destination) => ("configured", destination.host().map(str::to_owned)),
        Err(SkipReason::InvalidConfiguration) => ("invalid_configuration", None),
        Err(_) => ("not_configured", None),
    };
    let last_attempt = std::fs::read(last_attempt_path(&paths))
        .ok()
        .filter(|bytes| bytes.len() <= REQUEST_LIMIT)
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    Ok(Status {
        configuration,
        host,
        last_attempt,
        note: "sent means Langfuse accepted the request; confirm the metadata on the trace in Langfuse",
    })
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;
    use crate::test_support::TempRoot;

    fn parent() -> TraceParent {
        TraceParent::parse("00-32d796bfcf46f9746b04321034d0eee7-156da77f891786f8-01").unwrap()
    }

    #[test]
    fn endpoint_requires_https_without_credentials() {
        assert_eq!(
            endpoint("https://cloud.langfuse.com").unwrap().as_str(),
            "https://cloud.langfuse.com/api/public/otel/v1/traces"
        );
        assert_eq!(
            endpoint("https://example.test/langfuse/").unwrap().as_str(),
            "https://example.test/langfuse/api/public/otel/v1/traces"
        );
        for rejected in [
            "http://cloud.langfuse.com",
            "http://127.0.0.1:3000",
            "https://user:secret@cloud.langfuse.com",
            "https://cloud.langfuse.com?x=1",
            "https://cloud.langfuse.com#x",
            "not a url",
        ] {
            assert!(endpoint(rejected).is_none(), "{rejected}");
        }
    }

    #[test]
    fn span_is_a_deterministic_child_of_the_turn_root() {
        let mut metadata = BTreeMap::new();
        metadata.insert(HARNESS, COPILOT_HARNESS.to_owned());
        metadata.insert(JIRA_KEY, "ABC-123".to_owned());
        let first = request_body("session", &parent(), &metadata, 1);
        let second = request_body("session", &parent(), &metadata, 2);
        let span = &first["resourceSpans"][0]["scopeSpans"][0]["spans"][0];
        assert_eq!(span["traceId"], "32d796bfcf46f9746b04321034d0eee7");
        assert_eq!(span["parentSpanId"], "156da77f891786f8");
        assert_eq!(span["name"], SPAN_NAME);
        assert_eq!(
            span["spanId"],
            second["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["spanId"]
        );
        assert_ne!(
            span["spanId"],
            request_body("other", &parent(), &metadata, 1)["resourceSpans"][0]["scopeSpans"][0]["spans"]
                [0]["spanId"]
        );
        let keys: Vec<_> = span["attributes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|attribute| attribute["key"].as_str().unwrap())
            .collect();
        assert_eq!(
            keys,
            [
                "langfuse.trace.name",
                "langfuse.trace.metadata.harness",
                "langfuse.trace.metadata.jira_key"
            ]
        );
    }

    #[test]
    fn turn_io_sets_trace_input_and_output_without_a_service_resource() {
        let metadata = BTreeMap::from([(HARNESS, COPILOT_HARNESS.to_owned())]);
        let turn_io = TurnIo {
            input: "question".into(),
            output: "answer".into(),
        };
        let mut body = request_body("session", &parent(), &metadata, 1);
        add_turn_io(&mut body, &turn_io);
        assert_eq!(
            body["resourceSpans"][0]["resource"]["attributes"],
            json!([])
        );
        let attributes = &body["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["attributes"];
        let value = |key: &str| {
            attributes
                .as_array()
                .unwrap()
                .iter()
                .find(|attribute| attribute["key"] == key)
                .map(|attribute| attribute["value"]["stringValue"].clone())
        };
        assert_eq!(value("langfuse.trace.input"), Some(json!("question")));
        assert_eq!(value("langfuse.trace.output"), Some(json!("answer")));
        let without = request_body("session", &parent(), &metadata, 1);
        assert!(!without.to_string().contains("langfuse.trace.input"));
    }

    fn git(repository: &std::path::Path, args: &[&str]) {
        assert!(
            Command::new("git")
                .arg("-C")
                .arg(repository)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }

    #[test]
    fn metadata_uses_registry_names_and_transport_independent_repository() {
        let root = TempRoot::new("metadata");
        let paths = root.paths();
        let repository = root.path().join("source with spaces");
        std::fs::create_dir_all(&repository).unwrap();
        git(&repository, &["init", "-q"]);
        git(
            &repository,
            &["checkout", "-q", "-b", "feature/BR-904-test"],
        );
        git(
            &repository,
            &[
                "remote",
                "add",
                "origin",
                "git@github.com:upld-internal/burnrate-spec.git",
            ],
        );
        let cwd = repository.to_string_lossy().into_owned();
        for remote in [
            "git@github.com:upld-internal/burnrate-spec.git",
            "https://github.com/upld-internal/burnrate-spec.git",
        ] {
            git(&repository, &["remote", "set-url", "origin", remote]);
            let result = metadata(&paths, &cwd).unwrap();
            assert_eq!(result[HARNESS], COPILOT_HARNESS);
            assert_eq!(result[GIT_BRANCH], "feature/BR-904-test");
            assert_eq!(result[GIT_REPOSITORY], "upld-internal/burnrate-spec");
            assert_eq!(result[JIRA_KEY], "BR-904");
            assert_eq!(result[JIRA_KEYS], "BR-904");
        }
        git(
            &repository,
            &[
                "remote",
                "set-url",
                "origin",
                "https://user:token@github.com/upld-internal/burnrate-spec.git",
            ],
        );
        let unsafe_remote = metadata(&paths, &cwd).unwrap();
        assert!(!unsafe_remote.contains_key(GIT_REPOSITORY));
        assert_eq!(unsafe_remote[GIT_BRANCH], "feature/BR-904-test");
    }

    #[test]
    fn metadata_outside_git_has_only_the_harness() {
        let root = TempRoot::new("no-git");
        let result = metadata(&root.paths(), &root.path().to_string_lossy()).unwrap();
        assert_eq!(result.keys().copied().collect::<Vec<_>>(), [HARNESS]);
    }
}
