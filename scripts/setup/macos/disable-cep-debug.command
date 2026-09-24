#!/bin/bash
#
# KVFX Tools — disable Adobe CEP debug mode (macOS)
#
# Restores the default: After Effects will again refuse to load unsigned
# extensions. Run this when you are finished testing.
#
# Unsigned extensions, including this build of KVFX Tools, will stop loading
# afterwards. Signed extensions are unaffected.

set -u

echo "KVFX Tools — disabling CEP debug mode"
echo

for version in 12 11; do
  if defaults delete "com.adobe.CSXS.${version}" PlayerDebugMode 2>/dev/null; then
    echo "  disabled for CEP ${version}"
  else
    # Not an error: the value was never set, which is the state we want anyway.
    echo "  not set for CEP ${version} (nothing to do)"
  fi
done

killall cfprefsd 2>/dev/null || true

echo
echo "Done. Quit and reopen After Effects."
echo
printf "Press any key to close… "
read -r -n 1 -s
echo
