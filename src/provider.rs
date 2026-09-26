use std::env;
use std::io::Read;
use std::path::PathBuf;

pub const PRODUCT: &str = "burnrate-copilot";
pub const HARNESS: &str = "copilot";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderError {
    HomeUnavailable,
    Io,
    InputTooLarge,
    InvalidInput,
    NotImplemented,
}

impl ProviderError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::HomeUnavailable => "home_unavailable",
            Self::Io => "io_error",
            Self::InputTooLarge => "input_too_large",
            Self::InvalidInput => "invalid_input",
            Self::NotImplemented => "not_implemented",
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

impl Paths {
    pub fn discover() -> Result<Self, ProviderError> {
        let home_variable = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let home = env::var_os(home_variable)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or(ProviderError::HomeUnavailable)?;
        Ok(Self::for_home(
            &home,
            env::var_os("XDG_STATE_HOME").map(PathBuf::from),
            env::var_os("XDG_CONFIG_HOME").map(PathBuf::from),
        ))
    }

    fn for_home(
        home: &std::path::Path,
        xdg_state: Option<PathBuf>,
        xdg_config: Option<PathBuf>,
    ) -> Self {
        if cfg!(target_os = "macos") {
            let data = home.join("Library/Application Support").join(PRODUCT);
            let config = data.join("config");
            Self { data, config }
        } else {
            let absolute = |value: Option<PathBuf>| value.filter(|path| path.is_absolute());
            Self {
                data: absolute(xdg_state)
                    .unwrap_or_else(|| home.join(".local/state"))
                    .join(PRODUCT),
                config: absolute(xdg_config)
                    .unwrap_or_else(|| home.join(".config"))
                    .join(PRODUCT),
            }
        }
    }

    pub fn store(&self) -> PathBuf {
        self.data.join("store")
    }
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

    #[test]
    fn roots_are_provider_owned() {
        let paths = Paths::for_home(std::path::Path::new("/home/dev"), None, None);
        assert!(paths.data.ends_with(PRODUCT));
        assert!(paths.config.to_string_lossy().contains(PRODUCT));
        assert!(!paths.data.to_string_lossy().contains(".copilot"));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn relative_xdg_roots_are_ignored() {
        let paths = Paths::for_home(
            std::path::Path::new("/home/dev"),
            Some(PathBuf::from("relative")),
            Some(PathBuf::from("/etc/xdg")),
        );
        assert_eq!(
            paths.data,
            PathBuf::from("/home/dev/.local/state").join(PRODUCT)
        );
        assert_eq!(paths.config, PathBuf::from("/etc/xdg").join(PRODUCT));
    }
}
