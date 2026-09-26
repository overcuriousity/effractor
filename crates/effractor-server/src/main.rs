use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use clap::Parser;
use effractor_accounts::{documents, sessions};
use effractor_server::accounts::{Accounts, AccountsConfig};
use effractor_server::share::{FsStorage, Limits, Shares, Ttl};

/// Security architecture analysis, served locally. Models are solved in the
/// browser and never reach this process unless shared.
#[derive(Parser)]
#[command(name = "effractor", version = effractor_server::VERSION)]
struct Args {
    #[command(subcommand)]
    command: Option<Command>,

    /// Export a static site with self-contained sharing to a new directory, then exit.
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

    /// Turn accounts on: the SQLite database of users and documents.
    /// Created on first start. Without it, there are no accounts.
    #[arg(long, value_name = "FILE", global = true)]
    accounts: Option<PathBuf>,

    /// The origin people reach this server at (https://…). Needed for
    /// passkeys; makes the session cookie Secure when it is https.
    #[arg(long, value_name = "URL")]
    public_url: Option<String>,
}

#[derive(clap::Subcommand)]
enum Command {
    /// Manage the users of an accounts database.
    User {
        #[command(subcommand)]
        action: effractor_server::cli::UserCommand,
    },
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
    if let Some(Command::User { action }) = args.command {
        let Some(path) = args.accounts else {
            anyhow::bail!("effractor user … needs --accounts FILE");
        };
        return effractor_server::cli::run_user(&path, action);
    }
    if let Some(destination) = args.export_static {
        return effractor_server::export_static(&destination);
    }
    let limits = Limits {
        max_ttl: args.max_ttl,
        ..Limits::default()
    };
    let shares = Shares::new(Arc::new(FsStorage::new(args.data)), limits);
    let accounts = match &args.accounts {
        Some(db) => {
            if args.public_url.is_none() && !args.bind.ip().is_loopback() {
                tracing::warn!(
                    "accounts without --public-url on {}: logins travel unencrypted unless a TLS proxy is in front",
                    args.bind
                );
            }
            Some(Accounts::open(AccountsConfig {
                db: db.clone(),
                public_url: args.public_url.clone(),
            })?)
        }
        None => None,
    };

    // Expired shares go at startup and hourly. The API never serves one in
    // between; the sweep is what gives the disk space back.
    let sweeper = shares.clone();
    let sweep_accounts = accounts.clone();
    tokio::spawn(async move {
        let mut hourly = tokio::time::interval(Duration::from_secs(3600));
        loop {
            hourly.tick().await;
            match sweeper.sweep().await {
                Ok(0) => {}
                Ok(n) => tracing::info!("removed {n} expired shares"),
                Err(err) => tracing::error!(%err, "sweeping expired shares failed"),
            }
            // Ended sessions, and (stored-documents) what was deleted a week ago.
            if let Some(accounts) = sweep_accounts.clone() {
                let swept = tokio::task::spawn_blocking(move || {
                    let now = accounts.db().now();
                    accounts.db().write(|t| {
                        sessions::sweep(t, now)?;
                        documents::purge(t, now)
                    })
                })
                .await;
                match swept {
                    Ok(Ok(0)) | Err(_) => {}
                    Ok(Ok(n)) => tracing::info!("purged {n} deleted documents and folders"),
                    Ok(Err(err)) => tracing::error!(%err, "sweeping accounts failed"),
                }
            }
        }
    });

    let listener = tokio::net::TcpListener::bind(args.bind).await?;
    tracing::info!("listening on http://{}", listener.local_addr()?);
    let app = effractor_server::app_with(shares, accounts)
        .into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
