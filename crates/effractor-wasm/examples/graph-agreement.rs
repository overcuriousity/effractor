//! A test tool, not an analysis CLI: prints, one per line, the raw answers of
//! `parse`, `generate` and a stepped graph solve of the architecture at
//! `argv[1]`, beside the scenario `argv[2]` if given. The browser module is
//! driven through the same calls by `scripts/check-graph-agreement.js`, which
//! compares the lines.

use effractor_wasm::api;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("usage: graph-agreement <architecture.yaml> [scenario]");
        std::process::exit(2);
    };
    let scenario = args.next().unwrap_or_default();
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) => {
            eprintln!("{path}: {e}");
            std::process::exit(2);
        }
    };
    println!("{}", api::parse(&text));
    println!("{}", api::generate(&text, "agreement"));
    let mut session = api::Session::default();
    let begun = session.begin_graph(&text, &scenario, "agreement");
    println!("{begun}");
    let json = |answer: &str| serde_json::from_str::<serde_json::Value>(answer).expect("JSON");
    let total = json(&begun)["ok"]["progress"]["total"]
        .as_u64()
        .unwrap_or(0);
    let mut done = 0;
    while done < total {
        let step = session.step();
        println!("{step}");
        done = json(&step)["ok"]["done"].as_u64().unwrap_or(total);
    }
    println!("{}", session.finish());
}
