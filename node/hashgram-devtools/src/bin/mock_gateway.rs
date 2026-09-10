//! DEVNET ONLY: a stand-in for `hashgramd`'s REST gateway.
//!
//! The P2P chain relay forwards allow-listed reads to whatever answers at
//! `chain_api`. On a developer machine without a chain node this binary
//! answers instead, with deterministic, height-stamped JSON, so two
//! `hashgram-node` processes can be pointed at two instances and a client
//! can be shown reading a balance "verified by 2 nodes" — or, with `--lie`
//! on one instance, shown catching a node that answers differently.
//!
//! Nothing here is a chain. It never validates a transaction, holds no
//! state beyond a height counter and the transactions it was handed, and
//! refuses to run on any port below 1024 so it cannot be mistaken for a
//! real gateway by a misconfigured node.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use clap::Parser;
use sha2::{Digest, Sha256};

#[derive(Parser)]
#[command(name = "mock-gateway", about = "DEVNET ONLY mock chain REST gateway")]
struct Cli {
    /// Port on 127.0.0.1 (>= 1024).
    #[arg(long, default_value_t = 31317)]
    port: u16,
    /// Chain id reported by node_info (a node cross-checks this at start).
    #[arg(long, default_value = "hashgram-devnet-1")]
    chain_id: String,
    /// Starting block height; advances once per `--block-secs`.
    #[arg(long, default_value_t = 1000)]
    height: u64,
    /// Seconds per block.
    #[arg(long, default_value_t = 5)]
    block_secs: u64,
    /// Answer balances one uhash too high: a node that lies.
    #[arg(long)]
    lie: bool,
}

struct App {
    chain_id: String,
    height: AtomicU64,
    lie: bool,
    txs: Mutex<Vec<(String, u64)>>,
}

type S = State<Arc<App>>;

fn stamped(app: &App, status: StatusCode, body: serde_json::Value) -> Response {
    let mut r = (status, Json(body)).into_response();
    if let Ok(v) = HeaderValue::from_str(&app.height.load(Ordering::Relaxed).to_string()) {
        r.headers_mut()
            .insert("grpc-metadata-x-cosmos-block-height", v);
    }
    r
}

fn not_found(app: &App) -> Response {
    stamped(
        app,
        StatusCode::NOT_FOUND,
        serde_json::json!({ "code": 5, "message": "not found", "details": [] }),
    )
}

/// Deterministic balance per address: the mock has no ledger, so the
/// amount is a function of the address, stable across instances so two
/// honest mocks agree.
fn balance_for(address: &str, lie: bool) -> u128 {
    let h = Sha256::digest(address.as_bytes());
    let mut n = 0u128;
    for b in h.iter().take(6) {
        n = (n << 8) | u128::from(*b);
    }
    (n % 5_000_000_000_000) + 1_000_000 + u128::from(lie)
}

async fn node_info(State(app): S) -> Response {
    stamped(
        &app,
        StatusCode::OK,
        serde_json::json!({
            "default_node_info": { "network": app.chain_id, "moniker": "mock-gateway" },
            "application_version": { "name": "mock-gateway", "version": "devnet" }
        }),
    )
}

async fn latest_block(State(app): S) -> Response {
    let h = app.height.load(Ordering::Relaxed);
    stamped(
        &app,
        StatusCode::OK,
        serde_json::json!({ "block": { "header": { "height": h.to_string(), "chain_id": app.chain_id } } }),
    )
}

async fn balance_by_denom(
    State(app): S,
    Path(address): Path<String>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let denom = q.get("denom").cloned().unwrap_or_else(|| "uhash".into());
    let amount = if denom == "uhash" {
        balance_for(&address, app.lie)
    } else {
        0
    };
    stamped(
        &app,
        StatusCode::OK,
        serde_json::json!({ "balance": { "denom": denom, "amount": amount.to_string() } }),
    )
}

async fn balances(State(app): S, Path(address): Path<String>) -> Response {
    stamped(
        &app,
        StatusCode::OK,
        serde_json::json!({
            "balances": [{ "denom": "uhash", "amount": balance_for(&address, app.lie).to_string() }],
            "pagination": { "next_key": null, "total": "1" }
        }),
    )
}

async fn account(State(app): S, Path(address): Path<String>) -> Response {
    stamped(
        &app,
        StatusCode::OK,
        serde_json::json!({
            "account": {
                "@type": "/cosmos.auth.v1beta1.BaseAccount",
                "address": address,
                "pub_key": null,
                "account_number": "7",
                "sequence": "3"
            }
        }),
    )
}

async fn supply(State(app): S) -> Response {
    stamped(
        &app,
        StatusCode::OK,
        serde_json::json!({ "amount": { "denom": "uhash", "amount": "1000000000000000" } }),
    )
}

async fn founder_params(State(app): S) -> Response {
    stamped(
        &app,
        StatusCode::OK,
        serde_json::json!({ "params": { "share_bps": "100", "ceiling_bps": "100", "beneficiary": "hash1mockfounder" } }),
    )
}

async fn hashgram_any(State(app): S, Path(rest): Path<String>) -> Response {
    // Enough of the Hashgram modules for screens to render "empty" honestly.
    let body = match rest.as_str() {
        "username/v1/params" => serde_json::json!({ "params": { "registration_fee": { "denom": "uhash", "amount": "1000000" }, "validity_blocks": "7884000", "grace_blocks": "648000", "min_length": "3", "max_length": "32" } }),
        "serviceproof/v1/epoch/current" => serde_json::json!({ "epoch": { "number": "42", "start_height": "907200", "end_height": "928800" } }),
        "network/v1/info" => serde_json::json!({ "info": { "chain_id": app.chain_id, "network_id": "hashgram-devnet" } }),
        _ => return not_found(&app),
    };
    stamped(&app, StatusCode::OK, body)
}

async fn broadcast(State(app): S, Json(body): Json<serde_json::Value>) -> Response {
    let Some(tx) = body.get("tx_bytes").and_then(|v| v.as_str()) else {
        return stamped(
            &app,
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "code": 3, "message": "tx_bytes missing" }),
        );
    };
    let hash = hex::encode_upper(Sha256::digest(tx.as_bytes()));
    let h = app.height.load(Ordering::Relaxed) + 1;
    if let Ok(mut txs) = app.txs.lock() {
        txs.push((hash.clone(), h));
    }
    stamped(
        &app,
        StatusCode::OK,
        serde_json::json!({ "tx_response": { "txhash": hash, "code": 0, "height": "0", "raw_log": "", "gas_used": "0" } }),
    )
}

async fn simulate(State(app): S) -> Response {
    // A relay must never forward this; reaching it means the allow-list
    // failed. Answer anyway so the local API test can prove the denial
    // happened at the node, not here.
    stamped(
        &app,
        StatusCode::OK,
        serde_json::json!({ "gas_info": { "gas_wanted": "0", "gas_used": "123456" } }),
    )
}

async fn tx_by_hash(State(app): S, Path(hash): Path<String>) -> Response {
    let found = app
        .txs
        .lock()
        .ok()
        .and_then(|t| t.iter().find(|(h, _)| h.eq_ignore_ascii_case(&hash)).cloned());
    match found {
        Some((h, height)) if app.height.load(Ordering::Relaxed) >= height => stamped(
            &app,
            StatusCode::OK,
            serde_json::json!({ "tx_response": { "txhash": h, "code": 0, "height": height.to_string(), "raw_log": "", "gas_used": "91234" } }),
        ),
        _ => not_found(&app),
    }
}

async fn txs_list(State(app): S) -> Response {
    stamped(
        &app,
        StatusCode::OK,
        serde_json::json!({ "txs": [], "tx_responses": [], "pagination": { "next_key": null, "total": "0" } }),
    )
}

async fn fallback(State(app): S) -> Response {
    not_found(&app)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    let cli = Cli::parse();
    if cli.port < 1024 {
        eprintln!("mock-gateway: refusing to bind a privileged port; this is a DEVNET tool");
        std::process::exit(2);
    }
    let app = Arc::new(App {
        chain_id: cli.chain_id.clone(),
        height: AtomicU64::new(cli.height),
        lie: cli.lie,
        txs: Mutex::new(Vec::new()),
    });
    {
        let app = app.clone();
        let secs = cli.block_secs.max(1);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(secs));
            loop {
                tick.tick().await;
                app.height.fetch_add(1, Ordering::Relaxed);
            }
        });
    }
    let router = Router::new()
        .route("/cosmos/base/tendermint/v1beta1/node_info", get(node_info))
        .route("/cosmos/base/tendermint/v1beta1/blocks/latest", get(latest_block))
        .route("/cosmos/bank/v1beta1/balances/{address}/by_denom", get(balance_by_denom))
        .route("/cosmos/bank/v1beta1/balances/{address}", get(balances))
        .route("/cosmos/bank/v1beta1/supply/by_denom", get(supply))
        .route("/cosmos/auth/v1beta1/accounts/{address}", get(account))
        .route("/cosmos/tx/v1beta1/txs", get(txs_list).post(broadcast))
        .route("/cosmos/tx/v1beta1/simulate", post(simulate))
        .route("/cosmos/tx/v1beta1/txs/{hash}", get(tx_by_hash))
        .route("/hashgram/founder/v1/params", get(founder_params))
        .route("/hashgram/{*rest}", get(hashgram_any))
        .fallback(fallback)
        .with_state(app);
    let addr = format!("127.0.0.1:{}", cli.port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("mock-gateway: cannot bind {addr}: {e}");
            std::process::exit(1);
        }
    };
    tracing::info!(addr, chain_id = cli.chain_id, lie = cli.lie, "DEVNET ONLY mock gateway listening");
    if let Err(e) = axum::serve(listener, router).await {
        eprintln!("mock-gateway: {e}");
        std::process::exit(1);
    }
}
