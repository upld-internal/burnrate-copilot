use std::path::{Path, PathBuf};

use crate::provider::Paths;

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
