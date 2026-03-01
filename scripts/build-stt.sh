#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SWIFT_SRC="$PROJECT_ROOT/swift/Sources/VoltzSTT/main.swift"
OUT_DIR="$PROJECT_ROOT/swift/.build/release"
BINARY="$OUT_DIR/VoltzSTT"

# Only build on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo "⚠ Skipping Swift STT build (macOS only)"
    exit 0
fi

echo "Building Voltz STT binary..."
mkdir -p "$OUT_DIR"

# Prefer Xcode toolchain if available (avoids CLT module map issues)
if xcode-select -p 2>/dev/null | grep -q "Xcode.app"; then
    SWIFTC="xcrun swiftc"
else
    SWIFTC="swiftc"
fi

SDK_PATH="$(xcrun --show-sdk-path 2>/dev/null || echo "")"
SDK_FLAGS=()
if [[ -n "$SDK_PATH" ]]; then
    SDK_FLAGS=(-sdk "$SDK_PATH")
fi

if $SWIFTC -O -o "$BINARY" "$SWIFT_SRC" \
    "${SDK_FLAGS[@]}" \
    -swift-version 5 \
    2>&1; then
    echo "STT binary built: $BINARY"
else
    echo ""
    echo "⚠ Swift STT binary failed to compile."
    echo "  This is likely due to a known macOS Command Line Tools issue."
    echo "  Fix: Install Xcode from the App Store, then run:"
    echo "    sudo xcode-select -s /Applications/Xcode.app"
    echo "    npm run postinstall"
    echo ""
    echo "  Voice mode requires this binary. Chat mode works without it."
    exit 0
fi
