use std::path::{Path, PathBuf};

use crate::provider::Paths;

const FIXTURE_CWD: &str = "\"/Users/dev/projects/app\"";

/// Replaces the fixtures' Unix `cwd` with `cwd`, JSON-escaped, so hook fixtures
/// validate on every host (a Windows path needs escaped backslashes).
pub fn with_cwd(fixture: &str, cwd: &Path) -> String {
    assert!(
        fixture.contains(FIXTURE_CWD),
        "fixture has no cwd placeholder"
    );
    let escaped = serde_json::to_string(&cwd.to_string_lossy()).unwrap();
    fixture.replace(FIXTURE_CWD, &escaped)
}

/// A unique temporary directory removed on drop.
pub struct TempRoot(PathBuf);

impl TempRoot {
    pub fn new(label: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "burnrate-copilot-{label}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    pub fn paths(&self) -> Paths {
        let data = self.0.join("data");
        Paths {
            config: data.join("config"),
            data,
        }
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
