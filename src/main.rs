use std::env;
use std::io;

use burnrate_copilot::hook::{self, HookEvent};
use burnrate_copilot::provider::ProviderError;

fn main() {
    if let Err(error) = run() {
        eprintln!("{}", error.code());
        std::process::exit(1);
    }
}

fn run() -> Result<(), ProviderError> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    match arguments
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["hook", event] => {
            let event = HookEvent::from_argument(event).ok_or(ProviderError::InvalidInput)?;
            hook::read_hook(io::stdin().lock(), event)?;
            // Local persistence and the Langfuse metadata span are not built yet.
            Err(ProviderError::NotImplemented)
        }
        ["version"] => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        _ => Err(ProviderError::InvalidInput),
    }
}
