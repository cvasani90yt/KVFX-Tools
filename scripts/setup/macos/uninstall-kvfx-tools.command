#!/bin/bash
#
# KVFX Tools - uninstaller for macOS
# Removes the panel from ~/Library/Application Support/Adobe/CEP/extensions.
# Your KVFX settings (~/Library/Application Support/KVFXTools) and your
# projects are not touched.

set -u
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.kvfx.tools"

if [ ! -d "$DEST" ]; then
  echo " KVFX Tools is not installed for this user."
else
  printf " Remove KVFX Tools? [y/N] "
  read -r answer
  case "$answer" in
    [yY]*)
      rm -rf "$DEST"
      echo " Removed. Restart After Effects."
      echo
      echo " Unsigned extensions are still allowed. To turn that off as well:"
      echo "   defaults delete com.adobe.CSXS.12 PlayerDebugMode"
      ;;
    *) echo " Nothing was changed." ;;
  esac
fi
echo
printf "Press any key to close... "
read -r -n 1 -s
echo
