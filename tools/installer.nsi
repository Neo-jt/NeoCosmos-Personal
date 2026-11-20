; NeoCosmos 10.18.9 安装脚本
; 用 NSIS 3.10 编译：makensis.exe /V3 installer.nsi
Unicode true

!define PRODUCT_NAME        "NeoCosmos"
!define PRODUCT_DESC        "NeoCosmos · 关系优先的知识网络"
!define PRODUCT_VERSION     "10.18.9.0"
!define VERSION_TAG         "10.18.9"
!define PRODUCT_PUBLISHER   "宋锦涛"
!define PRODUCT_CONTACT     "13869162267"
!ifndef PRODUCT_EXE
!define PRODUCT_EXE         "NeoCosmos.exe"
!endif
; ELECTRON_DIR 允许构建脚本用 /DELECTRON_DIR= 覆盖，指向各版本独立的 electron 树。
!ifndef ELECTRON_DIR
!define ELECTRON_DIR        "..\build\win\electron-v33.0.0"
!endif
!define ASSETS_DIR          "..\desktop\assets"
; ---------------------------------------------------------------------------
; v6.40.0 合规拆分：两个完全独立的客户端（可同时安装、互不覆盖）。
;   · 独立 EXE 名        —— 避免 taskkill 互相误杀、图标/快捷方式互不冲突
;   · 独立协议 scheme    —— 个人 neolinkp:// / 企业 neolink://，深链互不抢占
;   · 独立版权署名        —— 个人版 AGPL 开源署名 / 企业版保留商务联系方式
;   · 独立安装授权页(EULA)—— 个人版 AGPL-3.0 / 企业版专有商用许可
; 默认（无 /DEDITION）= 融合版，保持历史行为与既有测试断言不变。
; ---------------------------------------------------------------------------
!define PROTO_SCHEME        "neolink"          ; 默认/企业版沿用 neolink://
!define EULA_FILE           "..\legal\COMMERCIAL-LICENSE.md"
!define LEGAL_LINE          "Copyright © 宋锦涛 · 13869162267"
!define COMMENTS_LINE       "开发者：宋锦涛  联系电话：13869162267  本地优先 · 无网络调用"
!define BRAND_LINE          "开发者：宋锦涛  ·  联系电话：13869162267  ·  NeoCosmos 本地优先知识网络"
!define FINISH_CONTACT      "开发者：宋锦涛    联系电话：13869162267"
!define FINISH_EXTRA        "完整能力边界与版本说明见安装目录下 VERSION-NOTES.txt，主界面「关于」亦可查看。"

; v6.23.1：输出名单一真源 —— 版本标签、形态标签、扩展名分开定义，
; 避免 personal / enterprise / default 三份输出名各写一遍版本串导致漏改。
!define SETUP_TAIL          "-Setup"
!define OUT_EXT             ".exe"

; v7.0.0：双版本构建 —— 通过 /DEDITION=personal|enterprise 切分。
; personal：锁定个人版（星图为主图谱，企业管理等企业能力不可见）；enterprise：保留全部功能。
; 两个版本共用同一份 electron-v33.0.0（仅 resources/app/ui/edition-lock.js 的
; EDITION_LOCK 不同，由 build-editions.mjs 在编译前临时改写），故 ELECTRON_DIR 固定。
; 输出文件名用英文（避免路径编码问题），显示名用中文。
!ifdef EDITION
  !if "${EDITION}" == "personal"
    !undef PRODUCT_NAME
    !define PRODUCT_NAME "NeoCosmos 个人版"
    !define OUTFILE "..\build\dist\NeoCosmos-Personal-${VERSION_TAG}${SETUP_TAIL}${OUT_EXT}"
    !define INSTDIR_BASE "NeoCosmos 个人版"
    ; 个人版：独立 EXE / 协议；开源署名，手机号收敛为「商用授权」联系入口
    !undef PRODUCT_DESC
    !define PRODUCT_DESC "NeoCosmos 个人版 · 关系优先的知识网络"
    !undef PRODUCT_EXE
    !define PRODUCT_EXE "NeoCosmosPersonal.exe"
    !undef PROTO_SCHEME
    !define PROTO_SCHEME "neolinkp"
    !undef EULA_FILE
    !define EULA_FILE "..\legal\PERSONAL-EULA.txt"
    !undef LEGAL_LINE
    !define LEGAL_LINE "Copyright © 宋锦涛 · AGPL-3.0 开源 · 商用须授权"
    !undef COMMENTS_LINE
    !define COMMENTS_LINE "开发者：宋锦涛  商用授权联系：13869162267  AGPL-3.0 开源 · 本地优先"
    !undef BRAND_LINE
    !define BRAND_LINE "NeoCosmos 个人版 · AGPL-3.0 开源 · 商用请联系开发者授权"
    !undef FINISH_CONTACT
    !define FINISH_CONTACT "开发者：宋锦涛    商用授权联系：13869162267"
    !undef FINISH_EXTRA
    !define FINISH_EXTRA "AGPL-3.0 开源：个人/学习/内网免费；闭源商用须授权。详见 legal/COMMERCIAL-LICENSE.md。"
  !else if "${EDITION}" == "enterprise"
    !undef PRODUCT_NAME
    !define PRODUCT_NAME "NeoCosmos 企业版"
    !define OUTFILE "..\build\dist\NeoCosmos-Enterprise-${VERSION_TAG}${SETUP_TAIL}${OUT_EXT}"
    !define INSTDIR_BASE "NeoCosmos 企业版"
    ; 企业版：独立 EXE / 协议（沿用 neolink://）；专有商用，保留商务联系方式
    !undef PRODUCT_DESC
    !define PRODUCT_DESC "NeoCosmos 企业版 · 关系优先的知识网络"
    !undef PRODUCT_EXE
    !define PRODUCT_EXE "NeoCosmosEnterprise.exe"
    !undef EULA_FILE
    !define EULA_FILE "..\legal\ENTERPRISE-EULA.txt"
  !endif
!endif
!ifndef OUTFILE
  ; v6.30.0：融合版输出名回归单一真源（此前硬编码 6.29.0，升级易漏改导致覆盖旧包）。
  !define OUTFILE "..\build\dist\${PRODUCT_NAME}-${VERSION_TAG}${SETUP_TAIL}${OUT_EXT}"
!endif
!ifndef INSTDIR_BASE
  !define INSTDIR_BASE "${PRODUCT_NAME}"
!endif

VIProductVersion "${PRODUCT_VERSION}"
VIFileVersion    "${PRODUCT_VERSION}"
VIAddVersionKey "ProductName"     "${PRODUCT_DESC}"
VIAddVersionKey "ProductVersion"  "${PRODUCT_VERSION}"
VIAddVersionKey "FileDescription" "${PRODUCT_DESC} 安装程序"
VIAddVersionKey "CompanyName"     "${PRODUCT_PUBLISHER}"
VIAddVersionKey "LegalCopyright"  "${LEGAL_LINE}"
VIAddVersionKey "FileVersion"     "${PRODUCT_VERSION}"
VIAddVersionKey "Comments"        "${COMMENTS_LINE}"

!include "MUI2.nsh"
!include "LogicLib.nsh"   ; v2.2.2：安装后校验 package.json 时要用 ${If}
!include "FileFunc.nsh"   ; 安装时计算已安装大小并写 EstimatedSize（让「程序和功能」能显示大小）

Name                 "${PRODUCT_DESC} ${PRODUCT_VERSION}"
; PREVIEW_OUTFILE 仅用于排版验证时单独 makensis 编译，不覆盖正式包。
!ifdef PREVIEW_OUTFILE
  OutFile "${PREVIEW_OUTFILE}"
!else
  OutFile "${OUTFILE}"
!endif
; v2.2.2：TEST_INSTALL_DIR 宏 —— 仅供本地验证"安装到干净目录"时用。
; 正式构建不定义它，行为与原来完全一致。
!ifdef TEST_INSTALL_DIR
  InstallDir         "D:\NeoCosmos-Test"
!else
  InstallDir         "$LOCALAPPDATA\Programs\${PRODUCT_NAME}"
  InstallDirRegKey   HKCU "Software\${PRODUCT_NAME}" ""
!endif
RequestExecutionLevel user
; v6.31.0：从 /SOLID 改为逐文件 LZMA。
; 原因：本版随包携带 1.50 GiB 真实训练的 float32 模型权重（neolm.emb/out.nw）。
; float32 训练权重是高熵数据，LZMA 收益极小；用 solid 压缩 1.5 GiB 会让编译时间
; 与内存占用暴涨，且 solid 模式下 SetCompress off 对单个文件不生效。
; 逐文件压缩后，可对这两个权重单独 SetCompress off 原样存储：编译可控、安装包体积
; 真实（>1 GiB），权重由客户端运行时按行随机读取、逐字节 SHA-256 可校验。
SetCompressor        lzma
SetCompressorDictSize 64
; v2.2.2：覆盖策略用 **ifnewer（默认语义：源比目标新才覆盖）**。
;
; 这里反复改过三轮，每一轮都踩了坑，结论记在这里免得再犯：
;
;   ✗ on（总是覆盖）：每次覆盖安装都重写一遍 180MB 的 NeoCosmos.exe。
;     在 exe 被重写的那个时间窗里，Explorer 若正好要刷新图标，
;     会读到"不完整/被占用"的 exe → 读不到图标 → **缓存成白板**。
;     实测用户机器上桌面图标就是白板。而这个文件其实根本没变。
;
;   ✗ ifdiff（按内容比较）：NSIS 3.10 的 ifdiff 在**目标文件不存在**时
;     **根本不写入** —— 手动删掉坏文件后重装，文件直接"消失"。
;     实测安装包因此缺了 resources/app/package.json（Electron 的入口配置），
;     客户端只能以默认 Electron 应用的形态启动。
;
;   ✓ ifnewer：只在源文件确实更新时才重写。exe 没变就不动它 ——
;     桌面图标不会因为"重写窗口"而变白板；变了的小文件由下面的
;     **显式 Delete + 拷后校验**两道闸保证一定是新内容。
;
; 真正的完整性保证不靠覆盖策略，靠三道闸：
;     ① 安装前先关掉正在运行的客户端（否则文件被占用 → 写坏）；
;     ② 显式 Delete 入口相关的小文件（保证它们一定被重写）；
;     ③ 拷贝后校验 package.json 首个字符必须是 "{"，否则中止并报错。
SetOverwrite         ifnewer
CRCCheck             on
ShowInstDetails      show
BrandingText         "${BRAND_LINE}"

!define MUI_ICON                 "${ASSETS_DIR}\icon.ico"
!define MUI_UNICON               "${ASSETS_DIR}\icon.ico"
!define MUI_ABORTWARNING
; ─────────────────────────────────────────────────────────────────────────
; v6.16.0：欢迎页排版根因修复。
;
; MUI2 的 Welcome.nsh 把标题控件固定为 120u,10u,195u,28u（12pt 粗体），
; 正文控件固定为 120u,45u,195u,130u（约 300×195px，8pt 字体，约 16 行）。
; 旧文案近 1500 字、标题 25 字 —— 标题折行成两行，正文被 STATIC 控件
; 强行压进固定高度，表现为「文字堆叠 / 行距压扁 / 字压字」（用户截图实测）。
;
; 修复：① 标题压到一行可容纳的长度；② 彻底弃用那个固定高度 STATIC：
; 隐藏它，改由 WelcomeShow 用 5 个独立 Label 逐段绘制，y 坐标与高度显式给定，
; 段间留白 6~8u，中文行距由我们使用微软雅黑字体自行控制；
; ③ 开发者与联系电话在欢迎页、完成页、品牌栏、PE 版本资源、卸载注册表
;    五处一致呈现；④ 完整版本说明改为随包真实文件 VERSION-NOTES.txt，
;    不再塞进欢迎页（信息不丢失，但界面不再超载）；
; ⑤ 欢迎页函数抽成 welcome-show.nsh，正式包与轻量验证包共用同一份真源。
; 契约钉死：test/v615-deep-math.test.mjs 检查分段标签坐标、单一真源与五处信息。
; ─────────────────────────────────────────────────────────────────────────
!define MUI_WELCOMEPAGE_TITLE    "欢迎安装 ${PRODUCT_NAME}"
; 原生正文控件在 WelcomeShow 里被隐藏，文案改由分段标签承载（行距显式可控）。
!define MUI_WELCOMEPAGE_TEXT     " "
!define MUI_PAGE_CUSTOMFUNCTION_SHOW WelcomeShow
!define MUI_FINISHPAGE_TITLE      "${PRODUCT_NAME} 安装完成"
!define MUI_FINISHPAGE_TEXT       "感谢使用 ${PRODUCT_NAME}。$\r$\n${FINISH_CONTACT}$\r$\n${FINISH_EXTRA}"

; WelcomeShow 的函数体必须定义在 MUI_PAGE_WELCOME 宏**之后**：
; $mui.WelcomePage.Text / .Title 这两个界面变量由宏展开时才声明，
; NSIS 单遍编译，函数写在前面会被判为 unknown variable 并静默忽略。
; ================================================================
;  v2.3.0：完成页提供「**是否现在运行**」选项（用户需求）。
;
;  实现方式：MUI_FINISHPAGE_RUN_FUNCTION（运行函数）而不是
;  MUI_FINISHPAGE_RUN（固定命令）。
;
;  为什么必须用运行函数：
;   固定命令在 /S 静默模式下**照样会执行** —— 自动化安装时客户端
;   会在安装尚未收尾时被拉起来，持有 resources/app/package.json
;   的文件句柄，NSIS 对同一批文件的写入随即被截断：
;   文件长度正确、内容却是全 0（实测 371 字节全是 0x00）。
;   后果是客户端读不到入口配置，直接以**默认 Electron 应用**的形态启动
;   （窗口标题 "Electron"、默认图标、什么功能都没有）。
;
;   运行函数里可以用 IfSilent 判断，静默安装时**不启动**；
;   交互安装时按用户在完成页的勾选决定。
;
;  注意：MUI_FINISHPAGE_RUN_FUNCTION **必须**与 MUI_FINISHPAGE_RUN 同时定义 ——
;  MUI2 的 Finish.nsh 里整段逻辑被 `!ifdef MUI_FINISHPAGE_RUN` 包着
;  （`!ifndef MUI_FINISHPAGE_RUN_FUNCTION` → Exec 固定命令；
;    `!else` → Call 运行函数）。只定义 FUNCTION 而不定义 RUN，
;  编译期就会报 "install function not referenced"，运行函数根本不会被调用。
;  所以这里 RUN 与 RUN_FUNCTION 都要给，RUN 指向同一个 exe（会被运行函数取代）。
;
;  注：上一轮曾误判"MUI2 不支持 RUN_FUNCTION"而删掉了这个选项 ——
;  实测 MUI2 的 Finish.nsh 明确支持（!else Call "${MUI_FINISHPAGE_RUN_FUNCTION}"）。
; ================================================================
!define MUI_FINISHPAGE_RUN          "$INSTDIR\${PRODUCT_EXE}"
!define MUI_FINISHPAGE_RUN_FUNCTION launchNeoCosmos
!define MUI_FINISHPAGE_RUN_TEXT  "是否现在运行 NeoCosmos？"
!define MUI_FINISHPAGE_LINK      "打开程序目录"
!define MUI_FINISHPAGE_LINK_LOCATION "$INSTDIR"

!insertmacro MUI_PAGE_WELCOME
; v6.40.0 合规拆分：安装前展示授权协议（个人版 AGPL-3.0 / 企业版专有商用许可）。
; EULA_FILE 为构建期随安装程序编译的文本，用户必须接受才能继续安装。
!define MUI_PAGE_HEADER_TEXT  "授权协议"
!define MUI_PAGE_HEADER_SUBTEXT "请阅读并接受以下许可条款"
!insertmacro MUI_PAGE_LICENSE "${EULA_FILE}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

; ── 欢迎页 SHOW 回调：唯一真源在 tools/welcome-show.nsh ──
; 必须在 MUI_PAGE_WELCOME 宏之后 include（界面变量此时才声明）。
; 轻量排版验证脚本 welcome-layout.nsi 引用同一份文件，杜绝验证与成品漂移。
!include "welcome-show.nsh"

Section "NeoCosmos 主程序" SEC01
  SetOutPath "$INSTDIR"

  ; 完整版本说明与开发者联系方式随包落盘：欢迎页只留精简摘要，
  ; 信息不丢失，也不会再撑爆 MUI 固定高度的文本控件。
  File "/oname=VERSION-NOTES.txt" "..\tools\VERSION-NOTES.txt"

  ; v6.40.0 合规：逐字落盘全部许可证与声明，随包可核对。
  CreateDirectory "$INSTDIR\legal"
  File "/oname=legal\LICENSE"              "..\LICENSE"
  File "/oname=legal\LICENSES.md"          "..\LICENSES.md"
  File "/oname=legal\NOTICE"               "..\NOTICE"
  File "/oname=legal\AGPL-3.0.txt"          "..\legal\AGPL-3.0.txt"
  File "/oname=legal\COMMERCIAL-LICENSE.md" "..\legal\COMMERCIAL-LICENSE.md"
  File "/oname=legal\PERSONAL-EULA.txt"     "..\legal\PERSONAL-EULA.txt"
  File "/oname=legal\ENTERPRISE-EULA.txt"   "..\legal\ENTERPRISE-EULA.txt"
  CreateDirectory "$INSTDIR\legal\fonts"
  File "/oname=legal\fonts\OFL.txt"         "..\desktop\assets\fonts\OFL.txt"
  File "/oname=legal\fonts\FONT-LICENSES.txt" "..\desktop\assets\fonts\FONT-LICENSES.txt"

  ; ─────────────────────────────────────────────────────────────
  ; v2.2.2 第一步：**先关掉正在运行的旧版**，否则绝不开始写文件。
  ;
  ; 为什么这一步是根因修复：
  ;   Electron 运行时，Node 会一直持有 `resources/app/package.json`
  ;   的文件句柄。安装时 NSIS 先 RMDir 再 File，若此时目标文件被占用，
  ;   NSIS 会**创建一个长度正确但内容全 0 的文件**（实测用户机器上
  ;   package.json 与 BUILD.txt 371/208 字节全是 0x00）。
  ;   后果极严重：Electron 解析入口配置失败 → 直接退回**默认 Electron 应用**
  ;   （窗口标题 "Electron"、默认图标、什么都没有），客户端等于废了。
  ;
  ; 只杀**同映像名的本程序**，绝不碰 explorer.exe 等系统进程。
  ; ─────────────────────────────────────────────────────────────
  ${If} ${FileExists} "$INSTDIR\${PRODUCT_EXE}"
    nsExec::ExecToStack 'cmd /c taskkill /f /im ${PRODUCT_EXE}.exe >nul 2>nul'
    Pop $0
    Pop $1
    ${If} $0 != "error"
      DetailPrint "已关闭正在运行的 ${PRODUCT_NAME}，继续安装…"
      Sleep 1200
    ${EndIf}
  ${EndIf}

  ; 覆盖安装时清理上一版的**整个应用资源目录**（不是只清 ui/src）：
  ; 否则架构升级后旧视图文件会残留在 resources/app 里，
  ; 而且 assets/icon.ico 这类**同名但内容已变**的文件若未被覆盖，
  ; 就会出现"exe 图标是新的、桌面快捷方式图标是旧的"（用户实测遇到过）。
  ; 只删程序目录，用户知识库在别处，绝不动。
  RMDir /r "$INSTDIR\resources\app"

  ; v2.2.2：**显式删掉入口相关的关键文件**，确保接下来的 File 一定重写它们。
  ;
  ; 为什么必须显式删：RMDir 在目标文件被占用时会**静默跳过**，
  ; 于是旧的（可能已损坏的）文件留在原地。而 NSIS 的覆盖策略在
  ; "目标已存在且大小相同"时可能跳过写入 —— 损坏的文件就永远修不好。
  ; 先删掉，就不存在"跳过"的可能。
  Delete "$INSTDIR\resources\app\package.json"
  Delete "$INSTDIR\resources\app\BUILD.txt"
  Delete "$INSTDIR\resources\app\src\package.json"

  ; 拷贝 Electron 运行时 + 应用资源（排除原始 electron.exe，避免与品牌化后的 NeoCosmos.exe 重复）
  ; 同时排除冒烟/截图产物（neolink-diag.json、neolink-smoke.json、neolink-shot*.png）——
  ; 它们是开发期验证文件，不属于运行时，混进安装包只会让用户困惑。
  ; v6.31.0：*.nw 是 1.50 GiB 真实训练权重，排除出递归压缩，下面单独按原样存储。
  File /r /x "electron.exe" /x "*.zip" /x "*.nw" /x "neolink-diag.json" /x "neolink-smoke.json" /x "neolink-*.png" "${ELECTRON_DIR}\*.*"

  ; ─────────────────────────────────────────────────────────────
  ; v6.31.0：NeoLM 真实训练权重（两个 750 MiB 的 float32 矩阵）。
  ; 与 staged 产物同源（tools/stage-app.mjs 白名单复制自 desktop/assets/_model/neolm）。
  ; 这里直接从源目录取，避免 1.5 GiB 在 solid 流里重压缩；安装后与 staged 逐字节一致，
  ; 由 neolm.manifest.json 的 SHA-256 与客户端「语言模型」页的完整性校验共同把关。
  ; ─────────────────────────────────────────────────────────────
  SetCompress off
  SetOutPath "$INSTDIR\resources\app\assets\_model\neolm"
  File "..\desktop\assets\_model\neolm\neolm.emb.nw"
  File "..\desktop\assets\_model\neolm\neolm.out.nw"
  SetCompress auto
  SetOutPath "$INSTDIR"

  ; v2.2.2：**拷贝后立刻验入口文件**。
  ; package.json 是 Electron 的入口配置 —— 它坏掉，客户端就会以默认
  ; Electron 应用的形态启动（标题 "Electron"、默认图标、什么功能都没有）。
  ; 这里读它的第一个字节：必须是 '{' 才算装好了。
  ; 装坏了就明确报错，而不是留一个"看着装上了其实不能用"的烂摊子。
  FileOpen $0 "$INSTDIR\resources\app\package.json" r
  ${If} $0 != ""
    FileRead $0 $1 1
    FileClose $0
    ${If} $1 != "{"
      MessageBox MB_ICONSTOP|MB_OK "安装未能正确写入应用配置（package.json 异常）。$\r$\n请关闭正在运行的 ${PRODUCT_NAME} 后重新安装，或手动删除安装目录 $INSTDIR 再试。$\r$\n你的知识库数据不会受到任何影响。"
      Abort
    ${EndIf}
  ${Else}
    MessageBox MB_ICONSTOP|MB_OK "安装未能写入应用配置（package.json 缺失）。$\r$\n请重新安装。$\r$\n你的知识库数据不会受到任何影响。"
    Abort
  ${EndIf}

  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  ; v2.2.1：快捷方式图标改指向 **${PRODUCT_EXE} 自身**，不再指向独立的 icon.ico 文件。
  ;
  ; 为什么：exe 里已经用 resedit 内嵌了同一张图标（见 tools/rebrand-exe.mjs），
  ; 指向 exe 就只有**一个真相源**。原先指向 $INSTDIR\resources\app\assets\icon.ico，
  ; 于是 exe 与 ico 是两份可能不一致的副本 ——
  ; 实测用户机器上的桌面快捷方式就是旧图标：安装目录里的 icon.ico
  ; 停留在 10/31 的旧版本（SHA256 与源码不一致），而 exe 已是新的。
  ; 结果"任务栏图标是新的、桌面图标是旧的"，看着像没改。
  ; 指向 exe 之后，图标随 exe 走，**不可能再漂移**。
  ;
  ; v2.2.2：先删旧快捷方式、再创建 —— 让 shell 明确知道"这个 .lnk 是新的"。
  ;
  ; ⚠ 图标参数**只写纯路径**，索引交给后面的 index 参数 —— 千万别在这里
  ;   手工拼 ",0"！用户实测的"桌面图标显示白板"就是这里来的：
  ;   安装目录含中文（旧版用户机器上的实际路径含中文），
  ;   IconLocation 写成 "…\NeoCosmos.exe,0" 时，Windows 解析"路径,索引"会把索引
  ;   算进路径 → 路径无效 → **静默退化成白色空白文档图标**，且**不报任何错**。
  ;   改成纯路径（让 shell 自己取目标 exe 的默认图标）后，图标立刻正常。
  ;   验收闸门：tools/check-shortcut-icon.mjs
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  CreateShortCut  "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" \
                  "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\${PRODUCT_EXE}" 0
  CreateShortCut  "$DESKTOP\${PRODUCT_NAME}.lnk" \
                  "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\${PRODUCT_EXE}" 0
  ; 通知 shell 图标关联变化，让新图标立刻生效。
  ; SHCNE_ASSOCCHANGED(0x08000000) + SHCNF_IDLIST(0x1000)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'

  ; ─────────────────────────────────────────────────────────────
  ; v2.2.2：**这里曾经有一段"清图标缓存 + 重启 Explorer"，现已整体删除。**
  ;
  ; 原代码：
  ;   nsExec::ExecToLog 'cmd /c del /f /q "%LOCALAPPDATA%\...\iconcache_*.db"'
  ;   nsExec::ExecToLog 'cmd /c taskkill /f /im explorer.exe'
  ;   nsExec::ExecToLog 'cmd /c start "" explorer.exe'
  ;
  ; 用户实测的两个严重后果：
  ;   ① **安装时电脑黑屏** —— taskkill 强杀 explorer.exe，
  ;      explorer 就是 Windows 的桌面外壳（任务栏 + 桌面图标），
  ;      它一死，屏幕立刻变成没有外壳的黑屏；而且这属于**擅自改动用户的系统进程**。
  ;   ② **桌面图标变成白板** —— iconcache_*.db 被删后，Explorer 重启时
  ;      只重建了其中一部分（实测 iconcache_96/256/768/1280/1920/2560 等
  ;      至今是 0 字节），图标索引处于残缺状态，桌面图标就渲染成空白方块。
  ;
  ; 现在改用 Windows **官方推荐**的刷新方式：SHChangeNotify 通知 shell
  ; "图标关联变了，你自己重读"。它**不删任何文件、不杀任何进程**，
  ; 也不会让用户的桌面黑掉。
  ; ─────────────────────────────────────────────────────────────

  ; 卸载登记（控制面板 → 程序和功能）
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; 写 EstimatedSize（单位 KB）。NSIS 默认不写该值，会导致控制面板
  ; 「程序和功能」里本应用「大小」一栏为空。Windows 读取这个 DWORD 显示已安装大小。
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "EstimatedSize" "$0"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayName"     "${PRODUCT_DESC}"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayVersion"  "${PRODUCT_VERSION}"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "Publisher"       "${PRODUCT_PUBLISHER}"
  ; 个人版源码公开，卸载表不写个人手机号；商务联系方式见 legal/COMMERCIAL-LICENSE.md
  !if "${PROTO_SCHEME}" != "neolinkp"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "HelpTelephone"   "${PRODUCT_CONTACT}"
  !endif
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayIcon"     "$INSTDIR\${PRODUCT_EXE},0"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoRepair" 1
  WriteRegStr   HKCU "Software\${PRODUCT_NAME}" "" "$INSTDIR"

  ; 注册 neolink:// 自定义协议 —— 深链唤起（从浏览器/其他 Agent 点 neolink://open/... 直达卡片）。
  ; 必须在安装时注册：应用未运行过的话，Windows 不知道该把 neolink:// 交给谁，
  ; 只靠运行时 app.setAsDefaultProtocolClient 的话首次唤起会直接失败。
  ; 写在 HKCU，无需管理员权限，与 RequestExecutionLevel user 一致。
  WriteRegStr   HKCU "Software\Classes\${PROTO_SCHEME}" "" "URL:NeoCosmos Protocol"
  WriteRegStr   HKCU "Software\Classes\${PROTO_SCHEME}" "URL Protocol" ""
  WriteRegStr   HKCU "Software\Classes\${PROTO_SCHEME}\DefaultIcon" "" "$INSTDIR\${PRODUCT_EXE},0"
  WriteRegStr   HKCU "Software\Classes\${PROTO_SCHEME}\shell\open\command" "" '"$INSTDIR\${PRODUCT_EXE}" "%1"'
SectionEnd

Section "Uninstall"
  ; v2.2.2：卸载前先关掉正在运行的客户端 —— 否则文件句柄占着，
  ; 下面的 RMDir 会删不干净，残留在安装目录里的就是一堆坏文件。
  ; 只杀自己这一份（同映像名），**绝不碰 explorer.exe 等系统进程**。
  nsExec::ExecToStack 'cmd /c taskkill /f /im ${PRODUCT_EXE}.exe >nul 2>nul'
  Pop $0
  Pop $1
  ${If} $0 != "error"
    Sleep 1000
  ${EndIf}

  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${PRODUCT_NAME}"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\${PRODUCT_NAME}"
  ; 注销本版协议：否则卸载后系统里仍指向已删除的 exe，点深链会报错
  DeleteRegKey HKCU "Software\Classes\${PROTO_SCHEME}"

  ; 仅删除程序目录，用户知识库在别处（默认位于「文档\NeoCosmos Vault」或用户自选位置），绝不动
  Delete "$INSTDIR\uninstall.exe"
  Delete "$INSTDIR\VERSION-NOTES.txt"
  Delete "$INSTDIR\${PRODUCT_EXE}"
  RMDir /r "$INSTDIR\resources\app"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\*.*"
  RMDir  "$INSTDIR"
SectionEnd

; ---------------------------------------------------------------------
; v2.3.0：完成页动作 —— 交互安装时按用户勾选启动客户端，**静默安装不启动**。
;
; 见上方 MUI_FINISHPAGE_RUN_FUNCTION 处的说明（为什么静默模式必须跳过）。
;
; 为什么这里还要再判一次 IfSilent：
;   MUI2 的完成页 Leave 回调在 /S 模式下**同样会被调用**（NSIS 只跳过页面
;   的显示，不跳过 custom 页的回调）—— 这正是 v2.2.2 那次"安装后 package.json
;   变成全 0"的真正触发路径。运行函数里必须自己判一次。
;
; 为什么启动前要 Sleep：
;   NSIS 在完成页之后还会做收尾（写卸载信息、刷新 shell 通知等）。
;   客户端一启动就会持有 resources/app/package.json 的句柄，
;   收尾期间对同目录的写入就可能被截断。留 1.2 秒余量，让收尾先做完。
; ---------------------------------------------------------------------
Function launchNeoCosmos
  IfSilent skipLaunch
  Sleep 1200
  Exec "$INSTDIR\${PRODUCT_EXE}"
skipLaunch:
FunctionEnd

