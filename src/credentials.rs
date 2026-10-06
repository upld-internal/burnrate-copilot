//! Explicit setup and OS-vault retrieval. Hooks read only a non-secret marker.
use std::env;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::langfuse::{Destination, SkipReason};
use crate::provider::{Paths, ProviderError, read_bounded, write_private};

const LIMIT: usize = 16 * 1024;
#[cfg(any(target_os = "macos", windows))]
const SERVICE: &str = "com.upland.burnrate-copilot.langfuse";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Credentials {
    pub(crate) base_url: String,
    pub(crate) public_key: String,
    pub(crate) secret_key: String,
}

impl Drop for Credentials {
    fn drop(&mut self) {
        self.public_key.zeroize();
        self.secret_key.zeroize();
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Marker {
    schema_version: u8,
    base_url: String,
}

fn marker_path(paths: &Paths) -> std::path::PathBuf {
    paths.config.join("langfuse-vault.json")
}

fn marker(paths: &Paths) -> Result<Marker, SkipReason> {
    let path = marker_path(paths);
    let file = fs::File::open(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            SkipReason::NotConfigured
        } else {
            SkipReason::InvalidConfiguration
        }
    })?;
    let bytes = read_bounded(file, LIMIT).map_err(|_| SkipReason::InvalidConfiguration)?;
    let marker: Marker =
        serde_json::from_slice(&bytes).map_err(|_| SkipReason::InvalidConfiguration)?;
    if marker.schema_version != 1 || crate::langfuse::endpoint(&marker.base_url).is_none() {
        return Err(SkipReason::InvalidConfiguration);
    }
    Ok(marker)
}

/// No credential-store access on the host's hook path.
pub fn configured_hint(paths: &Paths) -> Result<(), SkipReason> {
    marker(paths).map(|_| ())
}

trait Vault {
    fn get(&self) -> Result<Option<Zeroizing<String>>, ProviderError>;
    fn set(&self, secret: &str) -> Result<(), ProviderError>;
    fn delete(&self) -> Result<(), ProviderError>;
}

#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
struct NativeVault {
    account: String,
    #[cfg(target_os = "macos")]
    interactive: bool,
}
impl NativeVault {
    fn for_paths(paths: &Paths) -> Self {
        Self {
            account: format!(
                "{:x}",
                Sha256::digest(paths.config.to_string_lossy().as_bytes())
            ),
            #[cfg(target_os = "macos")]
            interactive: false,
        }
    }
    fn interactive(self) -> Self {
        #[cfg(target_os = "macos")]
        {
            let mut result = self;
            result.interactive = true;
            result
        }
        #[cfg(not(target_os = "macos"))]
        {
            self
        }
    }
    #[cfg(any(target_os = "macos", windows))]
    fn entry(&self) -> Result<keyring::Entry, ProviderError> {
        keyring::Entry::new(SERVICE, &self.account).map_err(|_| ProviderError::CredentialStore)
    }
}

#[cfg(any(target_os = "macos", windows))]
impl Vault for NativeVault {
    fn get(&self) -> Result<Option<Zeroizing<String>>, ProviderError> {
        #[cfg(target_os = "macos")]
        let _interaction = if self.interactive {
            None
        } else {
            Some(
                security_framework::os::macos::keychain::SecKeychain::disable_user_interaction()
                    .map_err(|_| ProviderError::CredentialStore)?,
            )
        };
        match self.entry()?.get_password() {
            Ok(value) if value.len() <= LIMIT => Ok(Some(Zeroizing::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            _ => Err(ProviderError::CredentialStore),
        }
    }
    fn set(&self, secret: &str) -> Result<(), ProviderError> {
        self.entry()?
            .set_password(secret)
            .map_err(|_| ProviderError::CredentialStore)
    }
    fn delete(&self) -> Result<(), ProviderError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            _ => Err(ProviderError::CredentialStore),
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
impl Vault for NativeVault {
    fn get(&self) -> Result<Option<Zeroizing<String>>, ProviderError> {
        Err(ProviderError::CredentialStore)
    }
    fn set(&self, _: &str) -> Result<(), ProviderError> {
        Err(ProviderError::CredentialStore)
    }
    fn delete(&self) -> Result<(), ProviderError> {
        Err(ProviderError::CredentialStore)
    }
}

fn load(paths: &Paths, vault: &impl Vault) -> Result<Credentials, SkipReason> {
    let marker = marker(paths)?;
    let secret = vault
        .get()
        .map_err(|_| SkipReason::CredentialUnavailable)?
        .ok_or(SkipReason::CredentialUnavailable)?;
    let credentials: Credentials =
        serde_json::from_str(&secret).map_err(|_| SkipReason::InvalidConfiguration)?;
    if credentials.base_url != marker.base_url {
        return Err(SkipReason::InvalidConfiguration);
    }
    Destination::new(
        &credentials.base_url,
        &credentials.public_key,
        &credentials.secret_key,
    )?;
    Ok(credentials)
}

pub fn destination(paths: &Paths) -> Result<Destination, SkipReason> {
    let credentials = load(paths, &NativeVault::for_paths(paths))?;
    Destination::new(
        &credentials.base_url,
        &credentials.public_key,
        &credentials.secret_key,
    )
}

fn save(paths: &Paths, credentials: &Credentials, vault: &impl Vault) -> Result<(), ProviderError> {
    Destination::new(
        &credentials.base_url,
        &credentials.public_key,
        &credentials.secret_key,
    )
    .map_err(|_| ProviderError::InvalidInput)?;
    let previous = vault.get()?;
    let secret = Zeroizing::new(
        serde_json::to_string(credentials).map_err(|_| ProviderError::InvalidInput)?,
    );
    if secret.len() > LIMIT {
        return Err(ProviderError::InputTooLarge);
    }
    vault.set(&secret)?;
    let result = (|| {
        // Read back before activating the marker; repair and rotation use this same path.
        if vault.get()?.as_deref().map(|v| v.as_str()) != Some(secret.as_str()) {
            return Err(ProviderError::CredentialStore);
        }
        let bytes = serde_json::to_vec(&Marker {
            schema_version: 1,
            base_url: credentials.base_url.clone(),
        })
        .map_err(|_| ProviderError::InvalidInput)?;
        write_private(&marker_path(paths), &bytes)
    })();
    if result.is_err() {
        match previous {
            Some(previous) => vault.set(&previous)?,
            None => vault.delete()?,
        }
    }
    result
}

/// Reads this profile's stored credentials, allowing an OS authorization prompt.
pub(crate) fn load_stored(paths: &Paths) -> Result<Credentials, SkipReason> {
    load(paths, &NativeVault::for_paths(paths).interactive())
}

/// Stores credentials through the same verified write, marker and rollback path as setup.
pub(crate) fn save_stored(paths: &Paths, credentials: &Credentials) -> Result<(), ProviderError> {
    save(
        paths,
        credentials,
        &NativeVault::for_paths(paths).interactive(),
    )
}

/// OTLP headers for Copilot's own exporter, using the same project as the span sender.
pub(crate) fn otlp_headers(credentials: &Credentials) -> Zeroizing<String> {
    Zeroizing::new(format!(
        "Authorization=Basic%20{},x-langfuse-ingestion-version=4",
        STANDARD.encode(format!(
            "{}:{}",
            credentials.public_key, credentials.secret_key
        ))
    ))
}

/// Explicit cleanup of this profile's entry, never a global credential purge.
pub fn forget() -> Result<Value, ProviderError> {
    let paths = Paths::discover()?;
    NativeVault::for_paths(&paths).interactive().delete()?;
    match fs::remove_file(marker_path(&paths)) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => return Err(ProviderError::Io),
    }
    Ok(json!({"state": "vault_entry_removed", "environment_credentials": "unchanged"}))
}

pub(crate) fn environment_credentials() -> Result<Credentials, ProviderError> {
    Ok(Credentials {
        base_url: env::var("LANGFUSE_BASE_URL")
            .or_else(|_| env::var("LANGFUSE_HOST"))
            .map_err(|_| ProviderError::InvalidInput)?,
        public_key: env::var("LANGFUSE_PUBLIC_KEY").map_err(|_| ProviderError::InvalidInput)?,
        secret_key: env::var("LANGFUSE_SECRET_KEY").map_err(|_| ProviderError::InvalidInput)?,
    })
}

pub(crate) fn client() -> Result<reqwest::blocking::Client, ProviderError> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .build()
        .map_err(|_| ProviderError::Io)
}

fn api(credentials: &Credentials, path: &str) -> Result<Value, ProviderError> {
    Destination::new(
        &credentials.base_url,
        &credentials.public_key,
        &credentials.secret_key,
    )
    .map_err(|_| ProviderError::InvalidInput)?;
    let response = client()?
        .get(format!(
            "{}{path}",
            credentials.base_url.trim_end_matches('/')
        ))
        .basic_auth(&credentials.public_key, Some(&credentials.secret_key))
        .send()
        .map_err(|_| ProviderError::RemoteVerification)?;
    if !response.status().is_success() {
        return Err(ProviderError::RemoteVerification);
    }
    let bytes = read_bounded(response, 4 * 1024 * 1024)?;
    serde_json::from_slice(&bytes).map_err(|_| ProviderError::RemoteVerification)
}

/// Run directly in a user's terminal. No secret appears in arguments or output.
pub fn setup(from_environment: bool) -> Result<Value, ProviderError> {
    if !cfg!(any(target_os = "macos", windows)) {
        return Err(ProviderError::CredentialStore);
    }
    let paths = Paths::discover()?;
    let credentials = if from_environment {
        environment_credentials()?
    } else {
        let base_url = rpassword::prompt_password("Langfuse HTTPS base URL: ")?;
        let public_key = rpassword::prompt_password("Langfuse public key (hidden): ")?;
        let secret_key = rpassword::prompt_password("Langfuse secret key (hidden): ")?;
        Credentials {
            base_url,
            public_key,
            secret_key,
        }
    };
    let projects = api(&credentials, "/api/public/projects")?;
    if projects["data"]
        .as_array()
        .is_none_or(|p| p.len() != 1 || p[0]["id"].as_str().is_none())
    {
        return Err(ProviderError::RemoteVerification);
    }
    save(
        &paths,
        &credentials,
        &NativeVault::for_paths(&paths).interactive(),
    )?;
    Ok(
        json!({"state": "saved_in_os_credential_store", "project_id": projects["data"][0]["id"],
        "next": "Restart using langfuse launch; run a real turn, then langfuse verify TRACE_ID. Content capture remains opt-in."}),
    )
}

/// Managed telemetry overrides environment configuration. Refuse a different project.
fn managed_matches(value: &Value, credentials: &Credentials) -> bool {
    let telemetry = &value["telemetry"];
    if telemetry.is_null() {
        return true;
    }
    telemetry["enabled"] == true
        && telemetry["endpoint"].as_str()
            == Some(
                format!(
                    "{}/api/public/otel",
                    credentials.base_url.trim_end_matches('/')
                )
                .as_str(),
            )
        && telemetry["headers"]["Authorization"].as_str()
            == Some(
                format!(
                    "Basic {}",
                    STANDARD.encode(format!(
                        "{}:{}",
                        credentials.public_key, credentials.secret_key
                    ))
                )
                .as_str(),
            )
}

/// Explicit user launch; the plugin hook never changes or relays host spans.
pub fn launch(arguments: &[String]) -> Result<(), ProviderError> {
    let paths = Paths::discover()?;
    let credentials = if crate::langfuse::has_environment_configuration() {
        environment_credentials()?
    } else {
        load(&paths, &NativeVault::for_paths(&paths).interactive())
            .map_err(|_| ProviderError::CredentialStore)?
    };
    Destination::new(
        &credentials.base_url,
        &credentials.public_key,
        &credentials.secret_key,
    )
    .map_err(|_| ProviderError::InvalidInput)?;
    let managed = if cfg!(windows) {
        env::var_os("ProgramFiles")
            .map(|p| Path::new(&p).join("GitHubCopilot/managed-settings.json"))
    } else if cfg!(target_os = "macos") {
        Some(
            Path::new("/Library/Application Support/GitHubCopilot/managed-settings.json")
                .to_owned(),
        )
    } else {
        None
    };
    if let Some(path) = managed {
        match fs::File::open(path) {
            Ok(file) => {
                let bytes = Zeroizing::new(read_bounded(file, 1024 * 1024)?);
                let value: Value = serde_json::from_slice(&bytes)
                    .map_err(|_| ProviderError::HostProjectMismatch)?;
                if !managed_matches(&value, &credentials) {
                    return Err(ProviderError::HostProjectMismatch);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(ProviderError::HostProjectMismatch),
        }
    }
    let headers = Zeroizing::new(format!(
        "Authorization=Basic%20{},x-langfuse-ingestion-version=4",
        STANDARD.encode(format!(
            "{}:{}",
            credentials.public_key, credentials.secret_key
        ))
    ));
    let mut command = Command::new("copilot");
    command
        .args(arguments)
        .env("LANGFUSE_BASE_URL", &credentials.base_url)
        .env("LANGFUSE_PUBLIC_KEY", &credentials.public_key)
        .env("LANGFUSE_SECRET_KEY", &credentials.secret_key)
        .env("COPILOT_OTEL_ENABLED", "true")
        .env("COPILOT_OTEL_EXPORTER_TYPE", "otlp-http")
        .env(
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            format!(
                "{}/api/public/otel",
                credentials.base_url.trim_end_matches('/')
            ),
        )
        .env("OTEL_EXPORTER_OTLP_HEADERS", headers.as_str())
        .env_remove("COPILOT_OTEL_FILE_EXPORTER_PATH")
        .env_remove("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
        .env_remove("OTEL_EXPORTER_OTLP_TRACES_HEADERS")
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    // Preserve opt-in content settings exactly; setup does not enable capture.
    if !command.status()?.success() {
        return Err(ProviderError::Io);
    }
    Ok(())
}

pub fn verify(trace_id: &str) -> Result<Value, ProviderError> {
    if trace_id.len() != 32 || !trace_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ProviderError::InvalidInput);
    }
    let paths = Paths::discover()?;
    let credentials = if crate::langfuse::has_environment_configuration() {
        environment_credentials()?
    } else {
        load(&paths, &NativeVault::for_paths(&paths)).map_err(|_| ProviderError::CredentialStore)?
    };
    let trace = api(&credentials, &format!("/api/public/traces/{trace_id}"))?;
    let observations = api(
        &credentials,
        &format!("/api/public/observations?traceId={trace_id}&limit=100"),
    )?;
    let expected = crate::langfuse::metadata(&paths, &env::current_dir()?.to_string_lossy())?;
    let pass = trace_matches(&trace, &observations, &expected);
    Ok(
        json!({"trace_id": trace_id, "verified": pass, "comparison": "current working directory attribution; run before changing branch", "content_included": false}),
    )
}

fn reaches_native_root(rows: &[Value], parent: &Value) -> bool {
    let Some(mut id) = parent.as_str() else {
        return false;
    };
    let mut seen = std::collections::BTreeSet::new();
    for _ in 0..rows.len() {
        if !seen.insert(id) {
            return false;
        }
        let mut matches = rows.iter().filter(|o| o["id"].as_str() == Some(id));
        let Some(observation) = matches.next() else {
            return false;
        };
        if matches.next().is_some() || observation["name"] == "burnrate.attribution" {
            return false;
        }
        if observation["parentObservationId"].is_null() {
            return observation["name"] == "invoke_agent";
        }
        let Some(next) = observation["parentObservationId"].as_str() else {
            return false;
        };
        id = next;
    }
    false
}

fn trace_matches(
    trace: &Value,
    observations: &Value,
    expected: &std::collections::BTreeMap<&str, String>,
) -> bool {
    let Some(rows) = observations["data"].as_array() else {
        return false;
    };
    let attribution: Vec<_> = rows
        .iter()
        .filter(|o| o["name"] == "burnrate.attribution")
        .collect();
    trace["name"] == "Copilot Turn"
        && observations["meta"]["totalItems"]
            .as_u64()
            .is_none_or(|n| n <= rows.len() as u64)
        && attribution.len() == 1
        && reaches_native_root(rows, &attribution[0]["parentObservationId"])
        && [
            "harness",
            "git_branch",
            "git_repository",
            "jira_key",
            "jira_keys",
        ]
        .iter()
        .all(|key| match expected.get(key) {
            Some(value) => trace["metadata"][key].as_str() == Some(value),
            None => trace["metadata"][key].is_null(),
        })
        && trace["metadata"]["gitBranch"].is_null()
        && trace["metadata"]["jiraKey"].is_null()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempRoot;
    use std::cell::RefCell;
    #[derive(Default)]
    struct MemoryVault(RefCell<Option<String>>);
    impl Vault for MemoryVault {
        fn get(&self) -> Result<Option<Zeroizing<String>>, ProviderError> {
            Ok(self.0.borrow().clone().map(Zeroizing::new))
        }
        fn set(&self, value: &str) -> Result<(), ProviderError> {
            *self.0.borrow_mut() = Some(value.into());
            Ok(())
        }
        fn delete(&self) -> Result<(), ProviderError> {
            *self.0.borrow_mut() = None;
            Ok(())
        }
    }
    fn fixture(secret: &str) -> Credentials {
        Credentials {
            base_url: "https://example.test".into(),
            public_key: "pk-fixture".into(),
            secret_key: secret.into(),
        }
    }
    #[test]
    fn setup_rotation_missing_and_marker_failure_preserve_credentials() {
        let root = TempRoot::new("vault");
        let paths = root.paths();
        let vault = MemoryVault::default();
        assert!(load(&paths, &vault).is_err());
        save(&paths, &fixture("old-secret"), &vault).unwrap();
        assert_eq!(load(&paths, &vault).unwrap().secret_key, "old-secret");
        let bytes = fs::read(marker_path(&paths)).unwrap();
        assert!(!String::from_utf8(bytes).unwrap().contains("secret"));
        save(&paths, &fixture("new-secret"), &vault).unwrap();
        assert_eq!(load(&paths, &vault).unwrap().secret_key, "new-secret");
        fs::remove_file(marker_path(&paths)).unwrap();
        fs::create_dir(marker_path(&paths)).unwrap();
        assert!(save(&paths, &fixture("failed-secret"), &vault).is_err());
        assert!(vault.get().unwrap().unwrap().contains("new-secret"));
        vault.delete().unwrap();
        fs::remove_dir(marker_path(&paths)).unwrap();
        write_private(
            &marker_path(&paths),
            br#"{"schema_version":1,"base_url":"https://example.test"}"#,
        )
        .unwrap();
        assert!(matches!(
            load(&paths, &vault),
            Err(SkipReason::CredentialUnavailable)
        ));
    }
    #[test]
    fn reject_mismatched_managed_project_and_incomplete_trace() {
        let credentials = fixture("secret");
        assert!(!managed_matches(
            &json!({"telemetry":{"enabled":true,"endpoint":"https://other.test"}}),
            &credentials
        ));
        let expected = std::collections::BTreeMap::from([("harness", "copilot_cli".into())]);
        let trace = json!({"name":"Copilot Turn","metadata":{"harness":"copilot_cli"}});
        let mut rows = json!({"data":[{"id":"root","name":"invoke_agent"},{"name":"burnrate.attribution","parentObservationId":"root"}],"meta":{"totalItems":2}});
        assert!(trace_matches(&trace, &rows, &expected));
        let mut nested = json!({"data":[
            {"id":"root","name":"invoke_agent"},
            {"id":"generation","name":"chat gpt-5-mini","parentObservationId":"root"},
            {"id":"attribution","name":"burnrate.attribution","parentObservationId":"generation"}
        ],"meta":{"totalItems":3}});
        assert!(trace_matches(&trace, &nested, &expected));
        nested["data"][1]["parentObservationId"] = json!("missing");
        assert!(!trace_matches(&trace, &nested, &expected));
        nested["data"][1]["parentObservationId"] = json!("generation");
        assert!(!trace_matches(&trace, &nested, &expected));
        nested["data"][1]["parentObservationId"] = json!("root");
        nested["data"][0]["name"] = json!("unrelated");
        assert!(!trace_matches(&trace, &nested, &expected));
        rows["data"]
            .as_array_mut()
            .unwrap()
            .push(json!({"name":"burnrate.attribution"}));
        assert!(!trace_matches(&trace, &rows, &expected));
        assert!(!trace_matches(
            &trace,
            &json!({"data":[{"name":"burnrate.attribution"}]}),
            &expected
        ));
    }
    #[test]
    #[ignore = "requires a native OS credential store; creates and deletes an isolated test entry"]
    #[cfg(any(target_os = "macos", windows))]
    fn native_vault_rotation_and_missing() {
        let root = TempRoot::new("native-vault");
        let paths = root.paths();
        let vault = NativeVault::for_paths(&paths);
        save(&paths, &fixture("fixture-old"), &vault).unwrap();
        save(&paths, &fixture("fixture-new"), &vault).unwrap();
        assert_eq!(load(&paths, &vault).unwrap().secret_key, "fixture-new");
        vault.delete().unwrap();
        assert!(matches!(
            load(&paths, &vault),
            Err(SkipReason::CredentialUnavailable)
        ));
    }
}
