use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use clap::Parser;
use effractor_server::share::{FsStorage, Limits, Shares, Ttl};

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
    /// Export a static site to a new directory, without sharing, then exit.
    #[arg(long, value_name = "DIRECTORY")]
    export_static: Option<PathBuf>,

    /// Address to listen on.
    #[arg(long, default_value = "127.0.0.1:8080")]
    bind: SocketAddr,

    /// Where shared models are kept — as ciphertext; the key never gets here.
    /// Created when the first model is shared.
    #[arg(long, default_value = "data")]
    data: PathBuf,

    /// The longest a share may be kept: 1d, 30d, 90d, 1y, or never.
    #[arg(long, default_value = "1y")]
    max_ttl: Ttl,
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
    if let Some(destination) = args.export_static {
        return effractor_server::export_static(&destination);
    }
    let limits = Limits {
        max_ttl: args.max_ttl,
        ..Limits::default()
    };
    let shares = Shares::new(Arc::new(FsStorage::new(args.data)), limits);

    // Expired shares go at startup and hourly. The API never serves one in
    // between; the sweep is what gives the disk space back.
    let sweeper = shares.clone();
    tokio::spawn(async move {
        let mut hourly = tokio::time::interval(Duration::from_secs(3600));
        loop {
            hourly.tick().await;
            match sweeper.sweep().await {
                Ok(0) => {}
                Ok(n) => tracing::info!("removed {n} expired shares"),
                Err(err) => tracing::error!(%err, "sweeping expired shares failed"),
            }
        }
    });

    let listener = tokio::net::TcpListener::bind(args.bind).await?;
    tracing::info!("listening on http://{}", listener.local_addr()?);
    let app = effractor_server::app(shares).into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
