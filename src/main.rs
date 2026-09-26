use std::env;
use std::io;

use burnrate_copilot::hook::{self, HookEvent};
use burnrate_copilot::provider::{Paths, ProviderError};
use burnrate_copilot::{langfuse, runtime};

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
            let input = hook::read_hook(io::stdin().lock(), event)?;
            let paths = Paths::discover()?;
            // Local records are committed before, and independently of, the
            // optional Langfuse span.
            let local = runtime::accept_hook(&paths, event, &input);
            if event == HookEvent::AgentStop {
                langfuse::dispatch_agent_stop(&paths, &input)?;
            }
            local
        }
        ["langfuse", "send"] => langfuse::send(io::stdin().lock()),
        ["langfuse", "status"] => print_json(&langfuse::status()?),
        ["version"] => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        _ => Err(ProviderError::InvalidInput),
    }
}

fn print_json(value: &impl serde::Serialize) -> Result<(), ProviderError> {
    serde_json::to_writer_pretty(io::stdout().lock(), value).map_err(|_| ProviderError::Io)?;
    println!();
    Ok(())
}
