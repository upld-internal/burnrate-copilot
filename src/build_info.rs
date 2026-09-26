//! Identity of this build, recorded in release manifests and support output.

use burnrate_adapter_kit::operations::ReleaseTarget;
use serde::Serialize;

use crate::provider::PRODUCT;

const UNKNOWN_REVISION: &str = "0000000000000000000000000000000000000000";
/// Set by the release workflow; local builds report the all-zero revision.
const SOURCE_REVISION: &str = match option_env!("BURNRATE_SOURCE_REVISION") {
    Some(value) => value,
    None => UNKNOWN_REVISION,
};
const SHARED_REVISION: &str = match option_env!("BURNRATE_SHARED_REVISION") {
    Some(value) => value,
    None => UNKNOWN_REVISION,
};

#[derive(Debug, Serialize)]
pub struct BuildInfo {
    pub product: &'static str,
    pub version: &'static str,
    pub target: Option<ReleaseTarget>,
    pub source_revision: &'static str,
    pub shared_revision: &'static str,
}

pub fn build_info() -> BuildInfo {
    BuildInfo {
        product: PRODUCT,
        version: env!("CARGO_PKG_VERSION"),
        target: ReleaseTarget::current(),
        source_revision: SOURCE_REVISION,
        shared_revision: SHARED_REVISION,
    }
}
