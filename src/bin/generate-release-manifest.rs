//! Writes the shared-contract release manifest for one packaged binary.

use std::env;
use std::fs;
use std::io::Read;
use std::path::Path;

use burnrate_adapter_kit::operations::{
    ArtifactManifest, OPERATIONS_SCHEMA_VERSION, ReleaseTarget, archive_name,
    binary_name_for_target,
};
use sha2::{Digest, Sha256};

const PRODUCT: &str = "burnrate-copilot";

fn main() {
    if let Err(code) = run() {
        eprintln!("{code}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), &'static str> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let [version, target, source_revision, shared_revision, binary] = arguments.as_slice() else {
        return Err("invalid_arguments");
    };
    let target = ReleaseTarget::ALL
        .into_iter()
        .find(|candidate| candidate.triple() == target)
        .ok_or("invalid_target")?;
    let archive = archive_name(PRODUCT, version, target);
    let manifest = ArtifactManifest {
        operations_schema_version: OPERATIONS_SCHEMA_VERSION.into(),
        product: PRODUCT.into(),
        version: version.clone(),
        target,
        binary_name: binary_name_for_target(PRODUCT, target),
        archive_name: archive.clone(),
        binary_sha256: sha256(Path::new(binary))?,
        source_revision: source_revision.clone(),
        shared_revision: shared_revision.clone(),
        provenance_name: format!("{archive}.intoto.jsonl"),
        signature_name: format!("{archive}.sigstore.json"),
    };
    manifest.validate().map_err(|_| "invalid_manifest")?;
    serde_json::to_writer_pretty(std::io::stdout().lock(), &manifest)
        .map_err(|_| "write_failed")?;
    println!();
    Ok(())
}

fn sha256(path: &Path) -> Result<String, &'static str> {
    let mut file = fs::File::open(path).map_err(|_| "read_failed")?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|_| "read_failed")?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
