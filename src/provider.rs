use std::env;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const PRODUCT: &str = "burnrate-copilot";
pub const HARNESS: &str = "copilot";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderError {
    HomeUnavailable,
    Io,
    InputTooLarge,
    InvalidInput,
    UnsupportedSchema,
}

impl ProviderError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::HomeUnavailable => "home_unavailable",
            Self::Io => "io_error",
            Self::InputTooLarge => "input_too_large",
            Self::InvalidInput => "invalid_input",
            Self::UnsupportedSchema => "unsupported_schema",
        }
    }
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for ProviderError {}

impl From<std::io::Error> for ProviderError {
    fn from(_: std::io::Error) -> Self {
        Self::Io
    }
}

/// Burnrate-owned local roots. Copilot's own `~/.copilot` configuration and
/// plugin cache remain host state and are never used for Burnrate records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    pub data: PathBuf,
    pub config: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    MacOs,
    Windows,
    Linux,
}

impl Platform {
    pub const fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::MacOs
        } else if cfg!(windows) {
            Self::Windows
        } else {
            Self::Linux
        }
    }
}

impl Paths {
    pub fn discover() -> Result<Self, ProviderError> {
        let platform = Platform::current();
        let home_variable = match platform {
            Platform::Windows => "USERPROFILE",
            _ => "HOME",
        };
        let variable = |name: &str| env::var_os(name).filter(|value| !value.is_empty());
        let home = variable(home_variable)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or(ProviderError::HomeUnavailable)?;
        Ok(Self::for_platform(platform, &home, |name| {
            variable(name).map(PathBuf::from)
        }))
    }

    /// macOS: `~/Library/Application Support/burnrate-copilot`.
    /// Windows: `%LOCALAPPDATA%\burnrate-copilot`.
    /// Linux: `$XDG_STATE_HOME` and `$XDG_CONFIG_HOME`, with XDG defaults.
    /// Relative variable values are ignored.
    fn for_platform(
        platform: Platform,
        home: &Path,
        variable: impl Fn(&str) -> Option<PathBuf>,
    ) -> Self {
        let absolute = |name: &str| variable(name).filter(|path| path.is_absolute());
        match platform {
            Platform::MacOs => {
                let data = home
                    .join("Library")
                    .join("Application Support")
                    .join(PRODUCT);
                Self {
                    config: data.join("config"),
                    data,
                }
            }
            Platform::Windows => {
                let data = absolute("LOCALAPPDATA")
                    .unwrap_or_else(|| home.join("AppData").join("Local"))
                    .join(PRODUCT);
                Self {
                    config: data.join("config"),
                    data,
                }
            }
            Platform::Linux => Self {
                data: absolute("XDG_STATE_HOME")
                    .unwrap_or_else(|| home.join(".local").join("state"))
                    .join(PRODUCT),
                config: absolute("XDG_CONFIG_HOME")
                    .unwrap_or_else(|| home.join(".config"))
                    .join(PRODUCT),
            },
        }
    }

    pub fn store(&self) -> PathBuf {
        self.data.join("store")
    }

    pub fn state(&self) -> PathBuf {
        self.data.join("state")
    }
}

/// Atomically replaces `path` with owner-only permissions.
pub fn write_private(path: &Path, bytes: &[u8]) -> Result<(), ProviderError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    Ok(())
}

/// Reads at most `limit` bytes, failing rather than truncating oversized input.
pub fn read_bounded(reader: impl Read, limit: usize) -> Result<Vec<u8>, ProviderError> {
    let mut bytes = Vec::new();
    reader.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(ProviderError::InputTooLarge);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_read_accepts_exact_limit_and_rejects_overflow() {
        assert_eq!(read_bounded(&b"abcd"[..], 4).unwrap(), b"abcd");
        assert_eq!(
            read_bounded(&b"abcde"[..], 4),
            Err(ProviderError::InputTooLarge)
        );
    }

    fn absolute(path: &str) -> PathBuf {
        // A path that is absolute on the host running the tests.
        std::env::temp_dir().join(path)
    }

    #[test]
    fn roots_follow_each_platform_convention() {
        let home = absolute("home");
        let none = |_: &str| None;
        let mac = Paths::for_platform(Platform::MacOs, &home, none);
        assert_eq!(
            mac.data,
            home.join("Library")
                .join("Application Support")
                .join(PRODUCT)
        );
        assert_eq!(mac.config, mac.data.join("config"));

        let windows = Paths::for_platform(Platform::Windows, &home, none);
        assert_eq!(
            windows.data,
            home.join("AppData").join("Local").join(PRODUCT)
        );
        let local = absolute("local-app-data");
        let windows = Paths::for_platform(Platform::Windows, &home, |name| {
            (name == "LOCALAPPDATA").then(|| local.clone())
        });
        assert_eq!(windows.data, local.join(PRODUCT));
        assert_eq!(windows.config, local.join(PRODUCT).join("config"));

        let linux = Paths::for_platform(Platform::Linux, &home, none);
        assert_eq!(linux.data, home.join(".local").join("state").join(PRODUCT));
        assert_eq!(linux.config, home.join(".config").join(PRODUCT));
    }

    #[test]
    fn relative_variables_are_ignored() {
        let home = absolute("home");
        let config = absolute("xdg-config");
        let linux = Paths::for_platform(Platform::Linux, &home, |name| match name {
            "XDG_STATE_HOME" => Some(PathBuf::from("relative")),
            "XDG_CONFIG_HOME" => Some(config.clone()),
            _ => None,
        });
        assert_eq!(linux.data, home.join(".local").join("state").join(PRODUCT));
        assert_eq!(linux.config, config.join(PRODUCT));
        let windows = Paths::for_platform(Platform::Windows, &home, |name| {
            (name == "LOCALAPPDATA").then(|| PathBuf::from("relative"))
        });
        assert_eq!(
            windows.data,
            home.join("AppData").join("Local").join(PRODUCT)
        );
    }

    #[test]
    fn roots_never_use_copilot_host_state() {
        let home = absolute("home");
        for platform in [Platform::MacOs, Platform::Windows, Platform::Linux] {
            let paths = Paths::for_platform(platform, &home, |_| None);
            assert!(!paths.data.to_string_lossy().contains(".copilot"));
            assert!(paths.data.ends_with(PRODUCT));
        }
    }
}
