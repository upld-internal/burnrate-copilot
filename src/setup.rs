//! `burnrate-setup`: one command that configures the shared Upland Langfuse
//! project for both Copilot's own trace exporter and Burnrate's attribution
//! span, without prompting for keys.
//!
//! Copilot reads its exporter settings only from the environment (or an
//! administrator's managed settings), so setup persists them as user
//! environment variables. It sets only the trace-specific OTLP variables, which
//! Copilot honors and which leave other tools' metrics and logs exporters
//! alone. It never sets `LANGFUSE_*` keys: the hooks read the OS credential
//! store, and Codex's Langfuse handler would otherwise pick them up.
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};
use zeroize::Zeroizing;

use crate::credentials::{self, Credentials};
use crate::langfuse::{self, SkipReason, USER_ID_VARIABLE};
use crate::provider::{Paths, ProviderError, read_bounded};

/// The Langfuse project every Upland user already receives; shared, not a
/// per-user secret. See `config/README.md`.
const UPLAND_CONFIG: &str = include_str!("../config/upland-langfuse.json");
const UPLAND_HOST: &str = "https://langf-admin.upland.one";
const USER_ID_PREFIX: &str = "upland-human-";
const ENABLED: &str = "COPILOT_OTEL_ENABLED";
const TRACES_ENDPOINT: &str = "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT";
const TRACES_HEADERS: &str = "OTEL_EXPORTER_OTLP_TRACES_HEADERS";
/// Every variable setup owns; `setup remove` deletes exactly these.
const OWNED: [&str; 4] = [ENABLED, TRACES_ENDPOINT, TRACES_HEADERS, USER_ID_VARIABLE];
#[cfg_attr(windows, allow(dead_code))]
const PROFILE_BEGIN: &str = "# >>> burnrate-copilot setup >>>";
#[cfg_attr(windows, allow(dead_code))]
const PROFILE_END: &str = "# <<< burnrate-copilot setup <<<";

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Status,
    Apply,
}

#[derive(Deserialize)]
struct UplandConfig {
    base_url: String,
    public_key: String,
    secret_key: String,
}

/// Persistent per-user environment: the Windows user environment, or a
/// marked block in shell profiles elsewhere.
pub(crate) trait UserEnvironment {
    fn get(&self, name: &str) -> Result<Option<String>, ProviderError>;
    fn set(&self, values: &[(&str, &str)]) -> Result<(), ProviderError>;
    fn remove(&self, names: &[&str]) -> Result<(), ProviderError>;
}

pub fn run(mode: Mode, user_id: Option<&str>) -> Result<Value, ProviderError> {
    let paths = Paths::discover()?;
    let cwd = env::current_dir()?;
    let environment = native_environment()?;
    let email = langfuse::suggest_user_id(&cwd);
    run_with(
        mode,
        user_id,
        email.as_deref(),
        &paths,
        &environment,
        &Store,
    )
}

/// Removes the variables setup owns. Stored credentials stay; `langfuse forget` removes them.
pub fn remove() -> Result<Value, ProviderError> {
    native_environment()?.remove(&OWNED)?;
    Ok(
        json!({"state": "environment_removed", "removed": OWNED, "credentials": "unchanged",
        "restart_required": true}),
    )
}

/// Credential access, separated so tests never touch the OS store.
pub(crate) trait CredentialStore {
    fn load(&self, paths: &Paths) -> Result<Credentials, SkipReason>;
    fn save(&self, paths: &Paths, credentials: &Credentials) -> Result<(), ProviderError>;
    fn reachable(&self, base_url: &str) -> bool;
    /// The current process environment; tests supply their own.
    fn process(&self, name: &str) -> Option<String>;
}

struct Store;

impl CredentialStore for Store {
    fn load(&self, paths: &Paths) -> Result<Credentials, SkipReason> {
        credentials::load_stored(paths)
    }
    fn save(&self, paths: &Paths, credentials: &Credentials) -> Result<(), ProviderError> {
        credentials::save_stored(paths, credentials)
    }
    fn reachable(&self, base_url: &str) -> bool {
        // Any HTTP answer proves the host is reachable (ZPA connected).
        credentials::client().is_ok_and(|client| {
            client
                .get(format!(
                    "{}/api/public/health",
                    base_url.trim_end_matches('/')
                ))
                .timeout(Duration::from_secs(5))
                .send()
                .is_ok()
        })
    }
    fn process(&self, name: &str) -> Option<String> {
        env::var(name).ok()
    }
}

pub(crate) fn run_with(
    mode: Mode,
    requested_user_id: Option<&str>,
    git_email: Option<&str>,
    paths: &Paths,
    environment: &impl UserEnvironment,
    store: &impl CredentialStore,
) -> Result<Value, ProviderError> {
    if !cfg!(any(target_os = "macos", windows)) && mode == Mode::Apply {
        return Ok(json!({"state": "unsupported_platform",
            "next": "Linux keeps environment-only configuration; see setup-langfuse."}));
    }
    let apply = mode == Mode::Apply;
    let mut changes = Vec::new();
    let mut notices = Vec::new();

    // 1. Credentials: a complete environment configuration or a working stored
    //    entry is kept; otherwise the shared Upland project is stored.
    let process = |name: &str| store.process(name);
    let (credentials, source) = if [
        "LANGFUSE_BASE_URL",
        "LANGFUSE_HOST",
        "LANGFUSE_PUBLIC_KEY",
        "LANGFUSE_SECRET_KEY",
    ]
    .iter()
    .any(|name| process(name).is_some())
    {
        notices.push("langfuse_environment_override");
        let from_process = (|| {
            Some(Credentials {
                base_url: process("LANGFUSE_BASE_URL").or_else(|| process("LANGFUSE_HOST"))?,
                public_key: process("LANGFUSE_PUBLIC_KEY")?,
                secret_key: process("LANGFUSE_SECRET_KEY")?,
            })
        })();
        (from_process, "environment")
    } else {
        match store.load(paths) {
            Ok(existing) => (Some(existing), "stored"),
            Err(_) if apply => {
                let shared = upland_credentials()?;
                store.save(paths, &shared)?;
                changes.push("stored_shared_upland_credentials");
                (Some(shared), "stored")
            }
            Err(SkipReason::CredentialUnavailable) => (None, "unavailable"),
            Err(_) => (None, "missing"),
        }
    };
    if let Some(credentials) = &credentials {
        if credentials.base_url.trim_end_matches('/') != UPLAND_HOST {
            notices.push("nonstandard_langfuse_server");
        }
    }

    // 2. User id: keep a configured value; otherwise derive it from an Upland
    //    Git email or from the value the user typed when asked.
    let current = match environment.get(USER_ID_VARIABLE)? {
        Some(value) => Some(value),
        None => process(USER_ID_VARIABLE),
    };
    let user_id = match current {
        Some(value) if !value.trim().is_empty() => {
            if value.contains('@') {
                notices.push("user_id_looks_like_email");
            } else if !value.starts_with(USER_ID_PREFIX) {
                notices.push("nonstandard_user_id");
            }
            Some(value)
        }
        _ => match requested_user_id {
            Some(requested) => Some(upland_user_id(requested).ok_or(ProviderError::InvalidInput)?),
            None => git_email.and_then(upland_user_id),
        },
    };

    // 3. Copilot's exporter: trace-specific variables, persisted per user.
    let mut desired = Vec::new();
    let headers;
    if let Some(credentials) = &credentials {
        headers = credentials::otlp_headers(credentials);
        desired.push((ENABLED, Zeroizing::new("true".to_owned())));
        desired.push((
            TRACES_ENDPOINT,
            Zeroizing::new(format!(
                "{}/api/public/otel/v1/traces",
                credentials.base_url.trim_end_matches('/')
            )),
        ));
        desired.push((TRACES_HEADERS, headers.clone()));
    }
    if let Some(user_id) = &user_id {
        desired.push((USER_ID_VARIABLE, Zeroizing::new(user_id.clone())));
    }
    let mut stale = Vec::new();
    for (name, value) in &desired {
        if environment.get(name)?.as_deref() != Some(value.as_str()) {
            stale.push((*name, value.as_str()));
        }
    }
    let telemetry_ready =
        credentials.is_some() && !stale.iter().any(|(n, _)| *n != USER_ID_VARIABLE);
    if apply && !stale.is_empty() {
        environment.set(&stale)?;
        changes.extend(stale.iter().map(|(name, _)| match *name {
            USER_ID_VARIABLE => "set_user_id",
            _ => "set_copilot_trace_exporter",
        }));
        changes.dedup();
    }
    // The saved variables reach only processes started afterwards. Windows
    // Terminal keeps its launch-time environment for every new tab and
    // window, so compare this terminal with what Copilot needs.
    let current_terminal = if desired
        .iter()
        .all(|(name, value)| process(name).as_deref() == Some(value.as_str()))
    {
        "ready"
    } else {
        "restart_required"
    };
    for name in ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS"] {
        if process(name).is_some() {
            notices.push("generic_otlp_exporter_present");
            break;
        }
    }

    let network = credentials.as_ref().map(|c| {
        if store.reachable(&c.base_url) {
            "reachable"
        } else {
            "unreachable"
        }
    });
    let state = if user_id.is_none() {
        "user_id_required"
    } else if credentials.is_none() {
        "configuration_needed"
    } else if apply || (telemetry_ready && stale.is_empty()) {
        "configured"
    } else {
        "configuration_needed"
    };
    Ok(json!({
        "state": state,
        "credentials": source,
        "user_id": user_id,
        "copilot_trace_exporter": if apply || telemetry_ready { "configured" } else { "missing" },
        "langfuse_network": network,
        "current_terminal": current_terminal,
        "changes": changes,
        "notices": notices,
        "restart_required": !changes.is_empty() || current_terminal != "ready",
    }))
}

fn upland_credentials() -> Result<Credentials, ProviderError> {
    let config: UplandConfig =
        serde_json::from_str(UPLAND_CONFIG).map_err(|_| ProviderError::InvalidInput)?;
    Ok(Credentials {
        base_url: config.base_url,
        public_key: config.public_key,
        secret_key: config.secret_key,
    })
}

/// `upland-human-<slug>` from an Upland email or a typed local part. The email
/// itself is never stored.
fn upland_user_id(value: &str) -> Option<String> {
    let value = value.trim();
    let local = match value.rsplit_once('@') {
        Some((local, domain)) if domain.eq_ignore_ascii_case("uplandsoftware.com") => local,
        Some(_) => return None,
        None => value.strip_prefix(USER_ID_PREFIX).unwrap_or(value),
    };
    let slug = local.to_ascii_lowercase();
    (!slug.is_empty()
        && slug.len() <= 64
        && slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b)))
    .then(|| format!("{USER_ID_PREFIX}{slug}"))
}

fn native_environment() -> Result<impl UserEnvironment, ProviderError> {
    #[cfg(windows)]
    {
        Ok(WindowsEnvironment)
    }
    #[cfg(not(windows))]
    {
        let home = env::var_os("HOME")
            .filter(|h| !h.is_empty())
            .ok_or(ProviderError::HomeUnavailable)?;
        let zdotdir = env::var_os("ZDOTDIR").filter(|z| !z.is_empty());
        Ok(ProfileEnvironment::new(
            Path::new(&home),
            Path::new(zdotdir.as_deref().unwrap_or(&home)),
        ))
    }
}

/// Marked block in shell startup files. zsh is the macOS default, so
/// `.zshrc` is always written; bash files only when they already exist.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) struct ProfileEnvironment {
    files: Vec<PathBuf>,
}

#[cfg_attr(windows, allow(dead_code))]
impl ProfileEnvironment {
    #[cfg(test)]
    #[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
    pub(crate) fn for_home(home: &Path) -> Self {
        Self::new(home, home)
    }

    /// zsh reads `.zshrc` from `ZDOTDIR` when set; bash files live in `HOME`.
    fn new(home: &Path, zdotdir: &Path) -> Self {
        let mut files = vec![zdotdir.join(".zshrc")];
        files.extend(
            [".bash_profile", ".bashrc"]
                .iter()
                .map(|name| home.join(name))
                .filter(|path| path.exists()),
        );
        Self { files }
    }

    fn read(path: &Path) -> Result<String, ProviderError> {
        match fs::File::open(path) {
            Ok(file) => String::from_utf8(read_bounded(file, 1024 * 1024)?)
                .map_err(|_| ProviderError::InvalidInput),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(_) => Err(ProviderError::Io),
        }
    }

    fn block_values(text: &str) -> Vec<(String, String)> {
        let Some(start) = text.find(PROFILE_BEGIN) else {
            return Vec::new();
        };
        let Some(end) = text[start..].find(PROFILE_END) else {
            return Vec::new();
        };
        text[start..start + end]
            .lines()
            .filter_map(|line| {
                let (name, value) = line.strip_prefix("export ")?.split_once('=')?;
                let value = value.strip_prefix('\'')?.strip_suffix('\'')?;
                Some((name.to_owned(), value.to_owned()))
            })
            .collect()
    }

    fn write(&self, values: &[(String, String)]) -> Result<(), ProviderError> {
        for path in &self.files {
            let text = Self::read(path)?;
            let without = match text.find(PROFILE_BEGIN) {
                Some(start) => {
                    let end = text[start..]
                        .find(PROFILE_END)
                        .map_or(text.len(), |e| start + e + PROFILE_END.len());
                    let rest = text[end..].strip_prefix('\n').unwrap_or(&text[end..]);
                    format!("{}{rest}", &text[..start])
                }
                None => text,
            };
            let mut output = without;
            if !values.is_empty() {
                if !output.is_empty() && !output.ends_with('\n') {
                    output.push('\n');
                }
                output.push_str(PROFILE_BEGIN);
                output.push('\n');
                for (name, value) in values {
                    output.push_str(&format!("export {name}='{value}'\n"));
                }
                output.push_str(PROFILE_END);
                output.push('\n');
            }
            let temporary = path.with_extension("burnrate-tmp");
            let mut file = fs::File::create(&temporary)?;
            file.write_all(output.as_bytes())?;
            file.sync_all()?;
            if let Ok(meta) = fs::metadata(path) {
                fs::set_permissions(&temporary, meta.permissions())?;
            } else {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
                }
            }
            fs::rename(&temporary, path)?;
        }
        Ok(())
    }

    fn current(&self) -> Result<Vec<(String, String)>, ProviderError> {
        Ok(Self::block_values(&Self::read(&self.files[0])?))
    }
}

impl UserEnvironment for ProfileEnvironment {
    fn get(&self, name: &str) -> Result<Option<String>, ProviderError> {
        Ok(self
            .current()?
            .into_iter()
            .find_map(|(n, v)| (n == name).then_some(v)))
    }
    fn set(&self, values: &[(&str, &str)]) -> Result<(), ProviderError> {
        if values.iter().any(|(_, v)| v.contains(['\'', '\n'])) {
            return Err(ProviderError::InvalidInput);
        }
        let mut merged = self.current()?;
        for (name, value) in values {
            merged.retain(|(n, _)| n != name);
            merged.push(((*name).to_owned(), (*value).to_owned()));
        }
        merged.sort_by_key(|(n, _)| OWNED.iter().position(|o| o == n));
        self.write(&merged)
    }
    fn remove(&self, names: &[&str]) -> Result<(), ProviderError> {
        let mut merged = self.current()?;
        merged.retain(|(n, _)| !names.contains(&n.as_str()));
        self.write(&merged)
    }
}

/// The Windows user environment, through PowerShell so the change is
/// broadcast to new processes. Values travel on stdin, never in arguments.
#[cfg_attr(not(windows), allow(dead_code))]
struct WindowsEnvironment;

#[cfg_attr(not(windows), allow(dead_code))]
impl WindowsEnvironment {
    fn powershell(script: &str) -> Result<String, ProviderError> {
        let mut child = Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        child
            .stdin
            .take()
            .ok_or(ProviderError::Io)?
            .write_all(script.as_bytes())?;
        let output = child.wait_with_output()?;
        if !output.status.success() || output.stdout.len() > 64 * 1024 {
            return Err(ProviderError::Io);
        }
        String::from_utf8(output.stdout).map_err(|_| ProviderError::Io)
    }
}

impl UserEnvironment for WindowsEnvironment {
    fn get(&self, name: &str) -> Result<Option<String>, ProviderError> {
        let value = Self::powershell(&format!(
            "$v = [Environment]::GetEnvironmentVariable('{name}', 'User'); if ($null -ne $v) {{ [Console]::Out.Write('=' + $v) }}\n"
        ))?;
        Ok(value.strip_prefix('=').map(str::to_owned))
    }
    fn set(&self, values: &[(&str, &str)]) -> Result<(), ProviderError> {
        if values.iter().any(|(_, v)| v.contains(['\'', '\n', '\r'])) {
            return Err(ProviderError::InvalidInput);
        }
        let script = Zeroizing::new(
            values
                .iter()
                .map(|(n, v)| {
                    format!("[Environment]::SetEnvironmentVariable('{n}', '{v}', 'User')\n")
                })
                .collect::<String>(),
        );
        Self::powershell(&script).map(|_| ())
    }
    fn remove(&self, names: &[&str]) -> Result<(), ProviderError> {
        Self::powershell(
            &names
                .iter()
                .map(|n| format!("[Environment]::SetEnvironmentVariable('{n}', $null, 'User')\n"))
                .collect::<String>(),
        )
        .map(|_| ())
    }
}

#[cfg(test)]
#[cfg_attr(
    not(any(target_os = "macos", windows)),
    allow(dead_code, unused_imports)
)]
mod tests {
    use super::*;
    use crate::test_support::TempRoot;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Memory {
        stored: RefCell<Option<(String, String, String)>>,
        saves: RefCell<usize>,
        process: RefCell<std::collections::BTreeMap<String, String>>,
    }
    impl CredentialStore for Memory {
        fn load(&self, _: &Paths) -> Result<Credentials, SkipReason> {
            self.stored
                .borrow()
                .clone()
                .map(|(base_url, public_key, secret_key)| Credentials {
                    base_url,
                    public_key,
                    secret_key,
                })
                .ok_or(SkipReason::NotConfigured)
        }
        fn save(&self, _: &Paths, c: &Credentials) -> Result<(), ProviderError> {
            *self.saves.borrow_mut() += 1;
            *self.stored.borrow_mut() = Some((
                c.base_url.clone(),
                c.public_key.clone(),
                c.secret_key.clone(),
            ));
            Ok(())
        }
        fn reachable(&self, _: &str) -> bool {
            false
        }
        fn process(&self, name: &str) -> Option<String> {
            self.process.borrow().get(name).cloned()
        }
    }

    #[test]
    fn user_ids_use_the_upland_local_part_only() {
        assert_eq!(
            upland_user_id("BRipley@UplandSoftware.com").as_deref(),
            Some("upland-human-bripley")
        );
        assert_eq!(
            upland_user_id("jane.doe").as_deref(),
            Some("upland-human-jane.doe")
        );
        assert_eq!(
            upland_user_id("upland-human-jane").as_deref(),
            Some("upland-human-jane")
        );
        for invalid in ["someone@example.com", "", "has space", "x'y"] {
            assert_eq!(upland_user_id(invalid), None, "{invalid}");
        }
    }

    #[test]
    #[cfg(any(target_os = "macos", windows))]
    fn setup_stores_shared_project_once_and_is_idempotent() {
        let root = TempRoot::new("setup");
        let paths = root.paths();
        let home = root.path().join("home ü");
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join(".zshrc"), "alias ll='ls -l'\n").unwrap();
        let environment = ProfileEnvironment::for_home(&home);
        let store = Memory::default();

        let asked = run_with(Mode::Apply, None, None, &paths, &environment, &store).unwrap();
        assert_eq!(asked["state"], "user_id_required");
        assert_eq!(asked["langfuse_network"], "unreachable");

        let first = run_with(
            Mode::Apply,
            Some("Jane.Doe"),
            None,
            &paths,
            &environment,
            &store,
        )
        .unwrap();
        assert_eq!(first["state"], "configured");
        assert_eq!(first["user_id"], "upland-human-jane.doe");
        assert_eq!(*store.saves.borrow(), 1);
        let profile = fs::read_to_string(home.join(".zshrc")).unwrap();
        assert!(profile.starts_with("alias ll='ls -l'\n"));
        assert!(profile.contains(&format!(
            "export {TRACES_ENDPOINT}='{UPLAND_HOST}/api/public/otel/v1/traces'"
        )));
        assert!(profile.contains("export COPILOT_OTEL_ENABLED='true'"));
        assert!(
            !profile.contains("LANGFUSE_PUBLIC_KEY")
                && !profile.contains("OTEL_EXPORTER_OTLP_ENDPOINT")
        );

        let again = run_with(
            Mode::Apply,
            None,
            Some("other@uplandsoftware.com"),
            &paths,
            &environment,
            &store,
        )
        .unwrap();
        assert_eq!(again["changes"], json!([]));
        assert_eq!(again["user_id"], "upland-human-jane.doe");
        // Same terminal: the saved variables are not in this process yet.
        assert_eq!(again["current_terminal"], "restart_required");
        assert_eq!(again["restart_required"], true);
        // A terminal started afterwards carries them.
        for name in OWNED {
            if let Some(value) = environment.get(name).unwrap() {
                store.process.borrow_mut().insert(name.to_owned(), value);
            }
        }
        let fresh = run_with(Mode::Status, None, None, &paths, &environment, &store).unwrap();
        assert_eq!(fresh["current_terminal"], "ready");
        assert_eq!(fresh["restart_required"], false);
        assert_eq!(fs::read_to_string(home.join(".zshrc")).unwrap(), profile);

        let status = run_with(Mode::Status, None, None, &paths, &environment, &store).unwrap();
        assert_eq!(status["state"], "configured");

        environment.remove(&OWNED).unwrap();
        assert_eq!(
            fs::read_to_string(home.join(".zshrc")).unwrap(),
            "alias ll='ls -l'\n"
        );
    }

    #[test]
    #[cfg(any(target_os = "macos", windows))]
    fn existing_configuration_is_kept_and_git_email_derives_user_id() {
        let root = TempRoot::new("setup-existing");
        let paths = root.paths();
        let home = root.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let environment = ProfileEnvironment::for_home(&home);
        let store = Memory::default();
        *store.stored.borrow_mut() = Some((
            "https://other.example".into(),
            "pk-own".into(),
            "sk-own".into(),
        ));
        let result = run_with(
            Mode::Apply,
            None,
            Some("bripley@uplandsoftware.com"),
            &paths,
            &environment,
            &store,
        )
        .unwrap();
        assert_eq!(*store.saves.borrow(), 0);
        assert_eq!(result["user_id"], "upland-human-bripley");
        assert_eq!(result["notices"], json!(["nonstandard_langfuse_server"]));
        assert_eq!(
            environment.get(TRACES_ENDPOINT).unwrap().as_deref(),
            Some("https://other.example/api/public/otel/v1/traces")
        );
    }
}
