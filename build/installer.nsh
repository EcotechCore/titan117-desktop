; Titan117's additions to the Windows installer (decisions §49).
;
; llama.cpp's prebuilt binaries need Microsoft's Visual C++ runtime 14.40 or
; newer (MSVCP140.dll, VCRUNTIME140.dll, VCRUNTIME140_1.dll). When this laptop
; has none, or an older one, the installer runs Microsoft's own signed
; redistributable, shipped unchanged in resources\vendor. It asks for admin
; rights itself; if the user says no, Titan117 still installs and its Setup
; page explains how to get the runtime later.

!macro customInstall
  StrCpy $0 ""
  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Version"
  SetRegView lastused
  ; $0 looks like v14.52.37029.00; 14.40 or newer is enough.
  StrCpy $1 $0 2 4
  ${If} $0 == ""
  ${OrIf} $1 < 40
    IfFileExists "$INSTDIR\resources\vendor\vc_redist.x64.exe" 0 +3
      DetailPrint "Installing Microsoft Visual C++ runtime..."
      ExecWait '"$INSTDIR\resources\vendor\vc_redist.x64.exe" /install /quiet /norestart' $2
  ${EndIf}
!macroend
