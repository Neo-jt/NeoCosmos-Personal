; 小工具：只重建桌面/开始菜单快捷方式（不安装任何东西）
; 用法：makensis /DTARGET_EXE="D:\path\NeoCosmos.exe" /DOUT_EXE="out.exe" tools\make-shortcut.nsi
; 然后：out.exe
!define MUI_ICON "..\desktop\assets\icon.ico"
!define TARGET_EXE "D:\重装系统\软件安装\NeoLink\NeoCosmos.exe"
!define OUT_EXE "..\build\make-shortcut.exe"

Name "NeoLink 快捷方式"
OutFile "${OUT_EXE}"
Unicode true
RequestExecutionLevel user
InstallDir "$TEMP"

Section
  Delete "$DESKTOP\NeoLink.lnk"
  CreateShortCut "$DESKTOP\NeoLink.lnk" "${TARGET_EXE}" "" "${TARGET_EXE}" 0
  ; 通知 shell 刷新图标关联（不删缓存、不重启 Explorer）
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
  DetailPrint "已重建桌面快捷方式 → ${TARGET_EXE}"
SectionEnd
