#!/bin/bash
#
# KVFX Tools - installer for macOS
#
# What this does, for YOUR user account only (no administrator password):
#   1. Allows After Effects to load unsigned extensions (PlayerDebugMode).
#      KVFX Tools is not code-signed yet, so this is required.
#   2. Copies the com.kvfx.tools folder next to this file into
#      ~/Library/Application Support/Adobe/CEP/extensions/
# Nothing else is changed. Run "Uninstall KVFX Tools (macOS).command" to remove it.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/com.kvfx.tools"
EXT="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$EXT/com.kvfx.tools"

finish() {
  echo
  printf "Press any key to close... "
  read -r -n 1 -s
  echo
  exit "$1"
}

echo
echo " KVFX Tools - installing"
echo " ------------------------"
echo

if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo " The com.kvfx.tools folder was not found next to this installer."
  echo " Unzip the whole download first, then run this file from the unzipped folder."
  finish 1
fi

if pgrep -f "Adobe After Effects" >/dev/null 2>&1; then
  echo " After Effects is running. Quit it first, then run this installer again."
  finish 1
fi

if [ -f "$DEST/CSXS/manifest.xml" ]; then
  echo " KVFX Tools is already installed. Your settings are kept either way."
  printf " Replace it with this version? [y/N] "
  read -r answer
  case "$answer" in
    [yY]*) rm -rf "$DEST" ;;
    *) echo " Nothing was changed."; finish 0 ;;
  esac
fi

for version in 12 11; do
  defaults write "com.adobe.CSXS.${version}" PlayerDebugMode 1 2>/dev/null || true
done
# macOS caches preferences; this makes the change take effect now.
killall cfprefsd 2>/dev/null || true
echo " [1/2] Allowed unsigned extensions for your account."

mkdir -p "$EXT"
if ! ditto "$SRC" "$DEST"; then
  echo " Copying failed. Check that you can write to:"
  echo "   $EXT"
  finish 1
fi
echo " [2/2] Copied the panel to:"
echo "   $DEST"

echo
echo " Done. Open After Effects, then choose  Window > Extensions > KVFX Tools"
finish 0
