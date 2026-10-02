//! Deliberate legacy deactivation. Preserve legacy data and unrelated settings.
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::provider::{Paths, ProviderError, read_bounded, write_private};
const LIMIT: usize = 1024 * 1024;

fn host_home() -> Result<PathBuf, ProviderError> {
    if let Some(value) = env::var_os("COPILOT_HOME") {
        let path = PathBuf::from(value);
        return if path.is_absolute() {
            Ok(path)
        } else {
            Err(ProviderError::InvalidInput)
        };
    }
    let variable = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    env::var_os(variable)
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .map(|p| p.join(".copilot"))
        .ok_or(ProviderError::HomeUnavailable)
}

fn read(path: &Path) -> Result<Value, ProviderError> {
    match fs::File::open(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(_) => Err(ProviderError::Io),
        Ok(file) => {
            let bytes = read_bounded(file, LIMIT)?;
            let text = std::str::from_utf8(&bytes).map_err(|_| ProviderError::InvalidInput)?;
            json5::from_str(text.trim_start_matches('\u{feff}'))
                .map_err(|_| ProviderError::InvalidInput)
        }
    }
}

fn legacy_root(home: &Path, config: &Value) -> Result<Option<PathBuf>, ProviderError> {
    let Some(plugins) = config["installedPlugins"].as_array() else {
        return Ok(None);
    };
    let mut found = None;
    for plugin in plugins
        .iter()
        .filter(|p| p["name"] == "burnrate-copilot" && p["version"] == "0.1.0")
    {
        let source = &plugin["source"];
        let owned = source["url"] == "https://github.com/upld-internal/burnrate-copilot.git"
            || (source["source"] == "github" && source["repo"] == "upld-internal/burnrate-copilot");
        if !owned || plugin["marketplace"].as_str().is_none_or(|s| !s.is_empty()) || found.is_some()
        {
            return Err(ProviderError::InvalidInput);
        }
        let root = PathBuf::from(
            plugin["cache_path"]
                .as_str()
                .ok_or(ProviderError::InvalidInput)?,
        );
        let canonical = root.canonicalize()?;
        if !canonical.starts_with(home.join("installed-plugins").canonicalize()?) {
            return Err(ProviderError::InvalidInput);
        }
        let manifest = read(&root.join("plugin.json"))?;
        if manifest["name"] != "burnrate-copilot" || manifest["version"] != "0.1.0" {
            return Err(ProviderError::InvalidInput);
        }
        found = Some(root);
    }
    Ok(found)
}

const SCRIPTS: &[&str] = &[
    "statusline.js",
    "session-start.js",
    "user-prompt.js",
    "pre-tool-use.js",
    "post-tool-use.js",
    "subagent-start.js",
    "subagent-stop.js",
    "pre-compact.js",
    "session-end.js",
];
fn owned_command(value: &Value, root: &Path, statusline: bool) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object
        .keys()
        .any(|k| !["command", "type", "timeoutSec"].contains(&k.as_str()))
    {
        return false;
    }
    if value["type"].as_str().is_some_and(|t| t != "command")
        || (!value["timeoutSec"].is_null()
            && value["timeoutSec"]
                .as_u64()
                .is_none_or(|n| n == 0 || n > 120))
    {
        return false;
    }
    let Some(command) = value["command"].as_str() else {
        return false;
    };
    SCRIPTS
        .iter()
        .filter(|name| !statusline || **name == "statusline.js")
        .any(|name| {
            let path = root
                .join("scripts")
                .join(name)
                .to_string_lossy()
                .into_owned();
            [
                format!("node {path}"),
                format!("node \"{path}\""),
                format!("node '{path}'"),
            ]
            .contains(&command.to_owned())
        })
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    schema_version: u8,
    previously_enabled: bool,
    statusline: Option<Value>,
    hooks: Vec<(String, Value)>,
}
fn remove_owned(settings: &mut Value, root: &Path, enabled: bool) -> Journal {
    let mut journal = Journal {
        schema_version: 1,
        previously_enabled: enabled,
        statusline: None,
        hooks: Vec::new(),
    };
    if owned_command(&settings["statusLine"], root, true) {
        journal.statusline = settings
            .as_object_mut()
            .and_then(|o| o.remove("statusLine"));
    }
    if let Some(hooks) = settings["hooks"].as_object_mut() {
        for (event, rows) in hooks {
            if let Some(rows) = rows.as_array_mut() {
                rows.retain(|row| {
                    if owned_command(row, root, false) {
                        journal.hooks.push((event.clone(), row.clone()));
                        false
                    } else {
                        true
                    }
                });
            }
        }
    }
    journal
}

fn host_toggle(enable: bool) -> Result<(), ProviderError> {
    // Identity is validated from host state before calling the unqualified legacy name.
    let status = Command::new("copilot")
        .args([
            "plugin",
            if enable { "enable" } else { "disable" },
            "burnrate-copilot",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(ProviderError::Io)
    }
}

pub fn status() -> Result<Value, ProviderError> {
    let home = host_home()?;
    let config = read(&home.join("config.json"))?;
    let root = legacy_root(&home, &config)?;
    Ok(
        json!({"legacy_detected": root.is_some(), "action": "migration disable-legacy deactivates v0.1.0 and removes only its exact statusline and user hooks; historical data remains intact"}),
    )
}

pub fn disable_legacy() -> Result<Value, ProviderError> {
    let home = host_home()?;
    let paths = Paths::discover()?;
    let journal_path = paths.state().join("legacy-migration.json");
    // Do not overwrite the first reversible journal on a repeat invocation.
    if journal_path.exists() {
        // Reconcile an interrupted preparation rather than trusting the journal alone.
        let config = read(&home.join("config.json"))?;
        if let Some(root) = legacy_root(&home, &config)? {
            host_toggle(false)?;
            let mut settings = read(&home.join("settings.json"))?;
            remove_owned(&mut settings, &root, false);
            write_private(
                &home.join("settings.json"),
                &serde_json::to_vec_pretty(&settings).map_err(|_| ProviderError::InvalidInput)?,
            )?;
        }
        return Ok(json!({"state":"already_prepared", "activation":"pending_live_host_proof"}));
    }
    let config = read(&home.join("config.json"))?;
    let Some(root) = legacy_root(&home, &config)? else {
        return Ok(json!({"state":"no_legacy_install"}));
    };
    let enabled = config["installedPlugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "burnrate-copilot" && p["version"] == "0.1.0")
        .is_some_and(|p| p["enabled"] == true);
    let settings_path = home.join("settings.json");
    let mut settings = read(&settings_path)?;
    let journal = remove_owned(&mut settings, &root, enabled);
    write_private(
        &journal_path,
        &serde_json::to_vec(&journal).map_err(|_| ProviderError::InvalidInput)?,
    )?;
    if let Err(error) = host_toggle(false) {
        let _ = fs::remove_file(&journal_path);
        return Err(error);
    }
    settings = read(&settings_path)?;
    remove_owned(&mut settings, &root, enabled);
    if write_private(
        &settings_path,
        &serde_json::to_vec_pretty(&settings).map_err(|_| ProviderError::InvalidInput)?,
    )
    .is_err()
    {
        if enabled {
            host_toggle(true)?;
        }
        let _ = fs::remove_file(&journal_path);
        return Err(ProviderError::Io);
    }
    Ok(
        json!({"state":"legacy_disabled", "statusline_removed":journal.statusline.is_some(), "user_hooks_removed":journal.hooks.len(), "activation":"pending_live_host_proof", "restart_required":true}),
    )
}

pub fn rollback() -> Result<Value, ProviderError> {
    let home = host_home()?;
    let paths = Paths::discover()?;
    let config = read(&home.join("config.json"))?;
    let root = legacy_root(&home, &config)?.ok_or(ProviderError::InvalidInput)?;
    // A marketplace install must be removed before reactivating the old copy.
    if config["installedPlugins"].as_array().is_some_and(|p| {
        p.iter()
            .any(|p| p["name"] == "burnrate-copilot" && p["version"] != "0.1.0")
    }) {
        return Err(ProviderError::InvalidInput);
    }
    let journal_path = paths.state().join("legacy-migration.json");
    let bytes = read_bounded(fs::File::open(&journal_path)?, LIMIT)?;
    let journal: Journal =
        serde_json::from_slice(&bytes).map_err(|_| ProviderError::InvalidInput)?;
    if journal.schema_version != 1 {
        return Err(ProviderError::UnsupportedSchema);
    }
    let settings_path = home.join("settings.json");
    let mut settings = read(&settings_path)?;
    if let Some(line) = &journal.statusline {
        if !owned_command(line, &root, true) || !settings["statusLine"].is_null() {
            return Err(ProviderError::InvalidInput);
        }
        settings["statusLine"] = line.clone();
    }
    for (event, hook) in &journal.hooks {
        if !owned_command(hook, &root, false) {
            return Err(ProviderError::InvalidInput);
        }
        if settings["hooks"].is_null() {
            settings["hooks"] = json!({});
        }
        if settings["hooks"][event].is_null() {
            settings["hooks"][event] = json!([]);
        }
        let rows = settings["hooks"][event]
            .as_array_mut()
            .ok_or(ProviderError::InvalidInput)?;
        if !rows.contains(hook) {
            rows.push(hook.clone());
        }
    }
    write_private(
        &settings_path,
        &serde_json::to_vec_pretty(&settings).map_err(|_| ProviderError::InvalidInput)?,
    )?;
    if journal.previously_enabled {
        host_toggle(true)?;
    }
    fs::remove_file(journal_path)?;
    Ok(json!({"state":"legacy_restored", "restart_required":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_ownership_preserves_unrelated_and_ambiguous_commands() {
        let temporary = crate::test_support::TempRoot::new("migration-command");
        let root = temporary.path().join("installed plugin ü");
        let root = root.as_path();
        let owned = json!({"type":"command","command":format!("node \"{}\"",root.join("scripts").join("statusline.js").display())});
        let extra = json!({"command":format!("node {}; echo other",root.join("scripts").join("statusline.js").display())});
        let mut settings = json!({"statusLine":owned,"theme":"user","hooks":{"sessionStart":[{"command":format!("node {}",root.join("scripts").join("session-start.js").display())}, extra.clone(), {"command":"other"}]}});
        let journal = remove_owned(&mut settings, root, true);
        assert!(journal.statusline.is_some());
        assert_eq!(journal.hooks.len(), 1);
        assert_eq!(settings["theme"], "user");
        assert_eq!(
            settings["hooks"]["sessionStart"].as_array().unwrap().len(),
            2
        );
        assert!(!owned_command(&extra, root, true));
        assert!(!owned_command(
            &json!({"command":format!("node {}",root.join("scripts").join("statusline.js").display()),"env":{"SECRET":"x"}}),
            root,
            true
        ));
    }
}
