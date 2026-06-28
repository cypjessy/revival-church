#!/usr/bin/env bash
set -euo pipefail

# --- Build the Android APK for Kingdom Seekers Church Nakuru ---
# This script:
#   1. Temporarily moves API routes out (they can't be static-exported)
#   2. Builds the Next.js app as a static export
#   3. Restores the API routes
#   4. Copies web assets into the Android project
#   5. Compiles the debug APK
#   6. Copies the APK to ~/Documents

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_NAME="Kingdom Seekers Church Nakuru.apk"
OUTPUT_PATH="$HOME/Documents/$OUTPUT_NAME"
JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}"

# ── API Host for bundled APK ─────────────────────────────────────────────────
# When building the APK, API routes need an external server (e.g. Vercel).
# Set NEXT_PUBLIC_API_HOST before running this script, OR set it in .env.local:
#   export NEXT_PUBLIC_API_HOST=https://your-project.vercel.app
#   bash build-apk.sh
# If empty, the app will use relative /api/* URLs (dev mode only — won't work
# from a bundled APK unless the backend is on the same host).

echo "=========================================="
echo "  Building Kingdom Seekers Church Nakuru APK"
echo "=========================================="
echo ""

# Step 0: Backup and remove API routes (incompatible with static export)
echo "[0/5] Excluding API routes from static export..."
API_DIR="$PROJECT_DIR/src/app/api"
API_BACKUP_DIR="/tmp/church-app-api-backup"
if [ -d "$API_DIR" ]; then
  rm -rf "$API_BACKUP_DIR"
  mkdir -p "$API_BACKUP_DIR"
  # Move each subdirectory under api/ to the backup
  for d in "$API_DIR"/*/; do
    if [ -d "$d" ]; then
      base=$(basename "$d")
      cp -a "$d" "$API_BACKUP_DIR/$base"
      rm -rf "$d"
    fi
  done
  echo "  ✓ API routes backed up to $API_BACKUP_DIR"
else
  echo "  No API routes found — skipping"
fi
echo ""

# Step 1: Static export
echo "[1/5] Building Next.js static export..."
cd "$PROJECT_DIR"
NEXT_EXPORT=true npm run build
echo "  ✓ Static export complete"
echo ""

# Step 2: Restore API routes
echo "[2/5] Restoring API routes..."
if [ -d "$API_BACKUP_DIR" ]; then
  for d in "$API_BACKUP_DIR"/*/; do
    if [ -d "$d" ]; then
      base=$(basename "$d")
      cp -a "$d" "$API_DIR/$base"
    fi
  done
  rm -rf "$API_BACKUP_DIR"
  echo "  ✓ API routes restored"
fi
echo ""

# Step 3: Copy to Android
echo "[3/5] Copying web assets to Android project..."
npx cap copy android
echo "  ✓ Assets copied"
echo ""

# Step 4: Build APK
echo "[4/5] Compiling Android APK (this may take a while)..."
cd "$PROJECT_DIR/android"
JAVA_HOME="$JAVA_HOME" ./gradlew assembleDebug
echo "  ✓ APK compiled"
echo ""

# Step 5: Copy APK to Documents
echo "[5/5] Copying APK to Documents..."
cp "$PROJECT_DIR/android/app/build/outputs/apk/debug/app-debug.apk" "$OUTPUT_PATH"
echo "  ✓ APK copied to: $OUTPUT_PATH"
echo ""

# Summary
APK_SIZE=$(ls -lh "$OUTPUT_PATH" | awk '{print $5}')
echo "=========================================="
echo "  Build complete!"
echo "  APK: $OUTPUT_PATH"
echo "  Size: $APK_SIZE"
echo "=========================================="
