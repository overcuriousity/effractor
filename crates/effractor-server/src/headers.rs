use axum::extract::Request;
use axum::http::HeaderValue;
use axum::middleware::Next;
use axum::response::Response;

/// `'self'` is the only origin this names, and that is the point: fonts, ELK
/// and the wasm module all come out of the binary. `'wasm-unsafe-eval'` is what
/// compiling a wasm module is called under CSP; it permits no JavaScript eval.
const CSP: &str = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; \
style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; \
worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/// On every response, the 404s included — a layer rather than per-handler so
/// a new route cannot forget them.
pub async fn security_headers(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert("content-security-policy", HeaderValue::from_static(CSP));
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    h.insert("x-robots-tag", HeaderValue::from_static("noindex"));
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    res
}
