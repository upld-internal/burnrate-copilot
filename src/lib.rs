//! GitHub Copilot CLI adapter boundary.

pub mod build_info;
pub mod credentials;
pub mod hook;
pub mod langfuse;
pub mod migration;
pub mod provider;
pub mod runtime;
pub mod setup;
#[cfg(test)]
mod test_support;
pub mod turn_io;

#[cfg(test)]
mod tests {
    use burnrate_adapter_kit::AdapterRecordFactory;
    use burnrate_adapter_kit::contracts::{SessionEventType, Validate};

    use crate::provider::{HARNESS, PRODUCT};

    #[test]
    fn adapter_records_use_the_shared_factory() {
        let factory = AdapterRecordFactory::new(HARNESS, PRODUCT, "0.5.0", "fixture")
            .expect("adapter identity");
        let event = factory.session_event(
            "copilot-event",
            "2026-09-25T12:00:00Z",
            "copilot-session",
            Some(1),
            SessionEventType::SessionStarted,
        );
        assert_eq!(event.validate(), Ok(()));
    }
}
