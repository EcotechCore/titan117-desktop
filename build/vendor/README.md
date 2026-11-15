# Vendor files for the installer

Not committed. `node scripts/fetch-vc-redist.mjs` downloads Microsoft's Visual
C++ redistributable (`vc_redist.x64.exe`) from Microsoft's own permanent link,
checks that it is signed by Microsoft, and puts it here. The installer ships it
unchanged and runs it only when a laptop's runtime is missing or older than
14.40 (decisions §49, `build/installer.nsh`).
