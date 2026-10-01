//! The server over a real socket: what `serve` adds to the app.

use std::net::SocketAddr;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::routing::get;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const TIMEOUT: Duration = Duration::from_millis(300);

/// A server with a slow stream, as the chat's, and one that says who asks.
async fn start() -> SocketAddr {
    let app = Router::new()
        .route(
            "/slow",
            get(|| async {
                // Eight chunks over well beyond the header timeout.
                let chunks = futures_util::stream::unfold(0, |n| async move {
                    if n == 8 {
                        return None;
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    Some((Ok::<_, std::io::Error>(format!("chunk {n}\n")), n + 1))
                });
                Body::from_stream(chunks)
            }),
        )
        .route(
            "/peer",
            get(|ConnectInfo(peer): ConnectInfo<SocketAddr>| async move { peer.ip().to_string() }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let at = listener.local_addr().unwrap();
    tokio::spawn(effractor_server::serve(
        listener,
        app,
        TIMEOUT,
        std::future::pending(),
    ));
    at
}

async fn get_raw(at: SocketAddr, path: &str) -> String {
    let mut s = TcpStream::connect(at).await.unwrap();
    s.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").as_bytes())
        .await
        .unwrap();
    let mut out = String::new();
    tokio::time::timeout(Duration::from_secs(10), s.read_to_string(&mut out))
        .await
        .unwrap()
        .unwrap();
    out
}

/// A client that never finishes its headers is let go of.
#[tokio::test]
async fn a_connection_trickling_its_headers_is_closed() {
    let at = start().await;
    let mut s = TcpStream::connect(at).await.unwrap();
    s.write_all(b"GET / HTTP/1.1\r\nHost: x\r\n").await.unwrap();
    let mut buf = Vec::new();
    let closed = tokio::time::timeout(Duration::from_secs(5), s.read_to_end(&mut buf)).await;
    assert!(closed.is_ok(), "still open after five seconds");
}

/// Only the headers are timed: a response streams for as long as it takes.
#[tokio::test]
async fn a_slow_response_is_not_cut_off() {
    let at = start().await;
    let out = get_raw(at, "/slow").await;
    assert!(out.starts_with("HTTP/1.1 200"), "{out}");
    for n in 0..8 {
        assert!(out.contains(&format!("chunk {n}")), "{out}");
    }
}

/// The limits count per address: every request knows its peer's.
#[tokio::test]
async fn a_request_knows_its_peer() {
    let at = start().await;
    let out = get_raw(at, "/peer").await;
    assert!(out.ends_with("127.0.0.1"), "{out}");
}
