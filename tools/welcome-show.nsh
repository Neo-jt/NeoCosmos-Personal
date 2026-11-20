; ═══════════════════════════════════════════════════════════════════════════
; 欢迎页 SHOW 回调 · 唯一真源（installer.nsi 与 welcome-layout.nsi 共同 include）
;
; 为什么要放在独立 .nsh：完整安装包每次 makensis 要压缩 786MB（约 10 分钟），
; 排版微调不可能反复等整包。轻量验证脚本同样 include 本文件，
; 因此「验证看到的」与「正式包里的」永远是同一段代码，不会漂移。
;
; 依赖：调用方需先 !include "MUI2.nsh" 并 !insertmacro MUI_PAGE_WELCOME
;       （本函数引用的 $mui.WelcomePage.* 变量由该宏声明）。
; ═══════════════════════════════════════════════════════════════════════════
Function WelcomeShow
  ; ── 彻底解法：不用 MUI 那个「一整段塞进固定高度 STATIC」的正文控件 ──
  ; STATIC 用 DT_WORDBREAK 自行换行，中文字体的行距由系统决定，段与段
  ; 之间挤在一起、还会把标点单独挤到下一行（用户截图与 PrintWindow 实测）。
  ; 这里隐藏它，改用多个独立 Label，每段独占一块、y 坐标显式留白。
  ShowWindow $mui.WelcomePage.Text 0       ; SW_HIDE
  CreateFont $R0 "Microsoft YaHei UI" "9"  "400"
  CreateFont $R1 "Microsoft YaHei UI" "11" "700"
  CreateFont $R2 "Microsoft YaHei UI" "8"  "700"
  SendMessage $mui.WelcomePage.Title ${WM_SETFONT} $R1 1

  ; 五段各自的 y 与高度显式给定：每段按最大行数留足，段落之间留 6~8u 呼吸。
  ; 页面可用区到 193u，最后一控件止于 186u，不触碰底部按钮条。
  ${NSD_CreateLabel} 120u 46u 195u 22u "关系优先的本地知识网络。全部数据留在本机，不上传云端，无需联网即可完整使用。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $R0 1
  SetCtlColors $0 "1F2937" "FFFFFF"

  ${NSD_CreateLabel} 120u 74u 195u 34u "本版包含：工程级界面、能力中枢（真实内核通道逐条可核对）、认知计算与量子形式主义数值内核、可审计的自我迭代闭环。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $R0 1
  SetCtlColors $0 "1F2937" "FFFFFF"

  ${NSD_CreateLabel} 120u 114u 195u 30u "纯净客户端，不含内置知识库；知识库由你自行创建或导入。完整说明见 VERSION-NOTES.txt。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $R0 1
  SetCtlColors $0 "1F2937" "FFFFFF"

  ; 开发者 / 联系电话独立成区，与正文拉开距离，视觉上是一张信息卡
  ${NSD_CreateLabel} 120u 150u 195u 10u "开发者与技术支持"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $R2 1
  SetCtlColors $0 "2F6BDF" "FFFFFF"

  ${NSD_CreateLabel} 120u 162u 195u 24u "开发者：宋锦涛$\r$\n联系电话：13869162267"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $R0 1
  SetCtlColors $0 "1F2937" "FFFFFF"
FunctionEnd
