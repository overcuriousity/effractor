use std::net::SocketAddr;

use clap::Parser;

/// The release workflow stamps `<Cargo version>+<short sha>`, since every
/// commit to master is a release and the Cargo version alone would not tell
/// two of them apart. A local build has no stamp and says so.
const VERSION: &str = match option_env!("EFFRACTOR_VERSION") {
    Some(stamped) => stamped,
    None => concat!(env!("CARGO_PKG_VERSION"), "+dev"),
};

/// Security architecture analysis, served locally. Models are solved in the
/// browser and never reach this process unless shared.
#[derive(Parser)]
#[command(name = "effractor", version = VERSION)]
struct Args {
    /// Address to listen on.
    #[arg(long, default_value = "127.0.0.1:8080")]
    bind: SocketAddr,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "effractor=info".into()),
        )
        .init();

    let args = Args::parse();
    let listener = tokio::net::TcpListener::bind(args.bind).await?;
    tracing::info!("listening on http://{}", listener.local_addr()?);
    axum::serve(listener, effractor_server::app())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
