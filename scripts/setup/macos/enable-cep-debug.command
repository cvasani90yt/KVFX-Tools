#!/bin/bash
#
# KVFX Tools — enable Adobe CEP debug mode (macOS)
#
# After Effects refuses to load an UNSIGNED extension unless PlayerDebugMode is
# set. KVFX Tools is not code-signed yet (Phase 14), so this is required to run
# it.
#
# This writes one preference per CEP version for YOUR user account only. No
# administrator rights are needed, and nothing else about macOS or After Effects
# is changed. Run disable-cep-debug.command to undo it.
#
# The form below is Adobe's own, from the CEP 12 documentation.

set -u

echo "KVFX Tools — enabling CEP debug mode"
echo

# CSXS.12 covers After Effects 26.x, CSXS.11 covers 22.x–25.x. Setting the one
# you do not have installed is harmless.
for version in 12 11; do
  if defaults write "com.adobe.CSXS.${version}" PlayerDebugMode 1 2>/dev/null; then
    echo "  enabled for CEP ${version}"
  else
    echo "  could not write CEP ${version} (skipped)"
  fi
done

# macOS caches plist files, so changes do not take effect until the cache is
# refreshed. Killing cfprefsd forces that; it restarts automatically.
killall cfprefsd 2>/dev/null || true

echo
echo "Done. Quit and reopen After Effects, then look in:"
echo "  Window > Extensions > KVFX Tools"
echo
printf "Press any key to close… "
read -r -n 1 -s
echo
