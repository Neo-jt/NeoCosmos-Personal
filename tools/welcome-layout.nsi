; ═══════════════════════════════════════════════════════════════════════════
; 欢迎页排版轻量验证脚本（**验证工具，不发布**）
;
; 完整 installer.nsi 每次 makensis 要压缩 786MB（约 10 分钟），
; 排版微调不能反复等整包。本脚本不含任何 File 指令，几秒即可编译，
; 且与正式包 include 同一份 tools/welcome-show.nsh，看到的即成品。
;
;   cd tools
;   makensis /D... welcome-layout.nsi   → build/welcome-layout-check.exe
;   python tools/shot-window.py welcome-layout-check build/welcome-shot.png
; ═══════════════════════════════════════════════════════════════════════════
Unicode true
!define PRODUCT_NAME "NeoCosmos"
!define ASSETS_DIR   "..\desktop\assets"
!define MUI_ICON     "${ASSETS_DIR}\icon.ico"
!define MUI_UNICON   "${ASSETS_DIR}\icon.ico"
!define MUI_WELCOMEPAGE_TITLE   "欢迎安装 NeoCosmos"
!define MUI_WELCOMEPAGE_TEXT    " "
!define MUI_PAGE_CUSTOMFUNCTION_SHOW WelcomeShow
!include "MUI2.nsh"

Name    "NeoCosmos 欢迎页排版验证"
OutFile "..\build\welcome-layout-check.exe"
; 与正式包一致：否则 NSIS 默认清单会要求管理员提升（WinError 740）
RequestExecutionLevel user

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_LANGUAGE "SimpChinese"
!include "welcome-show.nsh"

Section "layout-check" SEC_LAYOUT
  ; 故意不写任何文件：只用于看欢迎页
SectionEnd
