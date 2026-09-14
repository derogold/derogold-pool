#!/bin/sh
set -eu

binary="${WALLET_API_BINARY:-/usr/local/bin/wallet-api}"
port="${WALLET_API_PORT:-1337}"
bind_ip="${WALLET_API_BIND_IP:-127.0.0.1}"
rpc_password="${WALLET_API_RPC_PASSWORD:-}"
log_file="${WALLET_API_LOG_FILE:-/logs/wallet-api.log}"
log_level="${WALLET_API_LOG_LEVEL:-2}"
scan_coinbase="${WALLET_API_SCAN_COINBASE:-true}"

if [ -z "$rpc_password" ]; then
  echo "wallet-api RPC password is required" >&2
  exit 1
fi

if [ ! -x "$binary" ]; then
  echo "Wallet API binary is not executable: $binary" >&2
  exit 1
fi

set -- "$binary" \
  -p "$port" \
  --rpc-bind-ip "$bind_ip" \
  -r "$rpc_password" \
  --log-file "$log_file" \
  --log-level "$log_level" \
  --no-console

case "$scan_coinbase" in
  1|true|TRUE|yes|YES)
    set -- "$@" --scan-coinbase-transactions
    ;;
esac

exec "$@"
