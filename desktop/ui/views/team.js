// 团队 · 部署与协作（v1.4.1）
// ---------------------------------------------------------------------------
// 形态②的"开门"没有到来之前，先把可落地、不破坏架构的团队路径做实：
//   · 部署模式：同步盘 / NAS / 共享盘三种真实可用的方案与步骤
//   · 部署体检：检测当前库是否在同步路径上，给出风险与建议
//   · 共享规范：一键向库根写入 TEAM-START.md（命名规范 / 目录结构 / 写入纪律）
//   · Agent 接入：团队成员的外部 AI 用同一份 MCP 配置读写本库
// 纪律不变：零第三方依赖、文件真相源、原子写入、全量审计。
import { h, toast, status, fmtTime, icon, modal, confirmDialog, copyToClipboard } from '../ui-kit.js';

const SYNC_HINTS = [
  { re: /onedrive/i, label: 'OneDrive' },
  { re: /dropbox/i, label: 'Dropbox' },
  { re: /坚果云|nutstore/i, label: '坚果云' },
  { re: /synology|群晖/i, label: '群晖 NAS' },
  { re: /nas|共享盘|局域网/i, label: 'NAS / 局域网共享' },
  { re: /sharepoint/i, label: 'SharePoint' },
  { re: /icloud/i, label: 'iCloud' },
  { re: /^\\\\/, label: 'UNC 网络路径' },
];

export function mountTeam({ host, app, api, toast, status, route }) {
  host.innerHTML = '';
  const page = h('div', { class: 'page' });
  host.appendChild(page);
  // v2.2.0：立即给出载入占位 —— 数据回来前不留空白页
  // （此前空白是常态：任何一次中途交互都会让页面永久停在空白）
  page.appendChild(h('div', { class: 'empty-hint' }, '正在载入团队部署…'));

  let registry = null;

  // v2.2.0：代次守卫 —— 快速切页时，先发后到的旧请求不得覆盖新数据
  let gen = 0;
  async function load() {
    const my = ++gen;
    // v2.2.0：登记"正在取数"
    const done = app.beginLoad();
    let r;
    try { r = await api.vault.list(); }
    finally { done(); }   // v2.2.1：异常时也要归还计数
    if (my !== gen) return;
    if (r?.ok) registry = r.data;
    render();
  }

  function head() {
    return h('div', { class: 'page-head' },
      h('h2', null, '团队 · 部署与协作'),
      h('p', null, 'NeoCosmos 的团队形态不引入云端与账号：知识库就是磁盘上的一个文件夹，把它放进同步盘或共享目录，成员各自安装客户端指向同一目录即可。文件即真相源、原子写入、全量审计——这三条纪律保证多人环境下的可恢复与可追溯。'),
    );
  }

  // ---------------- 部署模式 ----------------
  function modeCard() {
    const box = h('div', { class: 'card' }, h('h3', null, '① 选择部署模式'));
    const modes = [
      {
        t: '同步盘（推荐起步）', d: 'OneDrive / 坚果云 / Dropbox。每人本地都有一份完整副本，离线可用；同步客户端负责分发。适合 3–15 人。',
        steps: ['把知识库文件夹移入同步盘目录（或新建于其中）', '每位成员安装 NeoCosmos，首次启动选择「打开文件夹」指向同步副本', '在同步盘控制台把库目录共享给成员（只读或可写）'],
      },
      {
        t: 'NAS / 内网共享', d: '群晖等 NAS 的 SMB 共享，或公司文件服务器。数据不出内网，适合对合规有要求的团队。',
        steps: ['在 NAS 上建共享目录并配置成员账号权限', '成员映射网络驱动器后，NeoCosmos「打开文件夹」指向该目录', '建议开启 NAS 快照，回滚多一层保险'],
      },
      {
        t: '中心节点（进阶）', d: '一台常开的机器/小服务器跑 MCP Server 对外提供检索，成员客户端各自维护本地副本；写操作走共享目录。适合需要统一检索入口的团队。',
        steps: ['中心机安装 NeoCosmos 并指向共享库', '对外暴露 MCP Server（见下方 Agent 接入）', '成员客户端定期通过同步盘同步'],
      },
    ];
    for (const m of modes) {
      box.appendChild(h('div', { class: 'deploy-mode' },
        h('div', { class: 'dm-t' }, m.t),
        h('div', { class: 'dm-d' }, m.d),
        h('ol', { class: 'dm-steps' }, m.steps.map((s) => h('li', null, s))),
      ));
    }
    return box;
  }

  // ---------------- 部署体检 ----------------
  function healthCard() {
    const v = app.vault || {};
    const p = String(v.path || '');
    let sync = null;
    for (const s of SYNC_HINTS) { if (s.re.test(p)) { sync = s; break; } }
    const box = h('div', { class: 'card' }, h('h3', null, '② 部署体检'));
    box.appendChild(h('div', { class: 'kv' }, h('span', null, '当前库'), h('b', { style: { fontSize: '11px' } }, v.name || '—')));
    box.appendChild(h('div', { class: 'kv' }, h('span', null, '路径'), h('b', { style: { fontSize: '11px' } }, p || '—')));
    box.appendChild(h('div', { class: 'kv' }, h('span', null, '规模'), h('b', null, `${v.nodes ?? 0} 卡片 / ${v.edges ?? 0} 突触`)));
    const verdict = sync
      ? h('div', { class: 'deploy-verdict ok' },
          h('b', null, `已就绪：检测到 ${sync.label}`),
          h('span', null, '该路径具备同步/共享能力，可直接邀请成员。建议开启版本历史或快照，获得回滚能力。'))
      : h('div', { class: 'deploy-verdict warn' },
          h('b', null, '未检测到同步路径'),
          h('span', null, '当前库在本机普通目录——单人使用没有问题；要多人协作，请把库迁入同步盘或 NAS 后重新「打开文件夹」。'));
    box.appendChild(verdict);
    box.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost', onclick: () => { api.vault.reveal(); toast('已在文件管理器中打开知识库目录', 'ok'); } }, '打开库目录'),
      h('button', { class: 'btn ghost', onclick: () => route('atlas') }, '管理知识库'),
    ));
    return box;
  }

  // ---------------- 共享规范（TEAM-START.md 生成器） ----------------
  function rulesCard() {
    const box = h('div', { class: 'card' }, h('h3', null, '③ 共享规范（一键生成）'));
    box.appendChild(h('div', { style: { fontSize: '11.5px', color: 'var(--muted)', lineHeight: '1.8' } },
      '向库根写入 TEAM-START.md：命名规范、目录建议、写入纪律与回滚说明。新成员打开库第一眼就看到团队约定，不需要口头交接。'));
    box.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: genRules }, '生成 TEAM-START.md'),
    ));
    return box;
  }

  async function genRules() {
    const v = app.vault || {};
    const go = await confirmDialog({
      title: '写入团队规范',
      message: '将在知识库根目录创建 TEAM-START.md（已存在时会另存为新文件，不覆盖）。继续？',
      confirmText: '写入',
      danger: false,
    });
    if (!go) return;
    const body = [
      '# 团队知识库 · 使用规范',
      '',
      `> 本库：${v.name || ''} · 由 NeoCosmos 团队部署向导生成于 ${new Date().toISOString().slice(0, 10)}`,
      '',
      '## 三条铁律',
      '',
      '1. **文件是唯一真相源**：所有卡片都是普通 .md，任何工具都可读写；卸载任何软件都不会丢知识。',
      '2. **写入纪律**：编辑保存走客户端（原子写入 + 审计）；不要在同步冲突未解决时手工改 `.neolink/` 下的索引文件。',
      '3. **关系优先**：写卡片时随手 `[[双链]]`——知识网络的价值在连接，不在单篇。',
      '',
      '## 命名规范',
      '',
      '- 卡片标题 = 文件名，使用「主题 · 限定」结构，例：`商业秘密 · 客户名单认定`。',
      '- 避免同名不同义；确需区分时在标题尾部加限定词，不要加日期。',
      '- 标签用 `#领域/子类`，新人先看左侧标签云再决定新造还是复用。',
      '',
      '## 目录建议',
      '',
      '- `_memory/semantic/` 主题卡片（默认）',
      '- `_memory/episodic/` 项目过程、会议纪要',
      '- `_inbox/` 闪念与待整理（每周末清空一次）',
      '- `_graveyard/` 归档区（不要手工删除，用客户端「归档」）',
      '',
      '## 冲突处理',
      '',
      '- 同步盘提示冲突副本时：保留内容更全的一份，把另一份的差异手工并入，然后删除冲突文件。',
      '- `.neolink/` 目录如出现冲突：删除冲突副本即可，客户端重建索引会自动修复。',
      '',
      '## 成员接入',
      '',
      '1. 安装 NeoCosmos，启动后「打开文件夹」指向本库。',
      '2. 外部 AI 助手接入：在 NeoCosmos「沉淀」页复制 MCP 配置。',
      '',
    ].join('\n');
    const res = await api.doc.create({ title: 'TEAM-START', folder: '', body, tags: ['团队规范'] });
    if (res?.ok) {
      toast('已生成 TEAM-START.md（根目录）', 'ok');
      await app.refreshVault();
      app.emit('tree');
      await load();
    } else toast(res?.error || '生成失败', 'err');
  }

  // ---------------- Agent 团队接入 ----------------
  function agentCard() {
    const box = h('div', { class: 'card' }, h('h3', null, '④ 成员的 AI 助手接入（MCP）'));
    box.appendChild(h('div', { style: { fontSize: '11.5px', color: 'var(--muted)', lineHeight: '1.8' } },
      '团队成员的外部 AI 助手用同一份配置把本库当成长期记忆后端：先 kb_search 再答，答完 kb_write_back，全程审计留痕。'));
    const cfgBox = h('div', { class: 'code-block', style: { marginTop: '8px' } }, '正在从内核生成真实接入配置…');
    const cmdBox = h('div', { class: 'code-block', style: { marginTop: '8px' } }, '—');
    box.appendChild(h('div', { class: 'mcp-label' }, '通用 MCP 客户端配置（由 kb_host_config 生成）'));
    box.appendChild(cfgBox);
    box.appendChild(h('div', { class: 'mcp-label', style: { marginTop: '8px' } }, '自检命令（取自同一份内核返回）'));
    box.appendChild(cmdBox);
    let cfg = '', cmd = '';
    box.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => cfg ? copyToClipboard(cfg, '已复制 MCP 配置') : toast('配置尚未生成', 'err') }, '复制配置'),
      h('button', { class: 'btn ghost', onclick: () => cmd ? copyToClipboard(cmd, '已复制自检命令') : toast('命令尚未生成', 'err') }, '复制命令'),
    ));
    // v6.20：旧配置含未替换的安装路径占位符，复制后根本不能直接用。
    // 改为调用已注册的 kb_host_config，路径与命令都来自与 MCP Server / CLI 同一真源。
    (async () => {
      try {
        const r = await api.tool('kb_host_config', { host: 'generic', vault: app.vault?.path || undefined });
        if (!r?.ok || !r.data?.configJson) {
          cfgBox.textContent = '配置生成失败：' + String(r?.error || r?.data?.error || '未知错误');
          return;
        }
        cfg = r.data.configJson;
        cmd = r.data.cli?.selfcheck || '—';
        cfgBox.textContent = cfg;
        cmdBox.textContent = cmd;
      } catch (e) { cfgBox.textContent = '配置生成失败：' + String(e?.message || e); }
    })();
    return box;
  }

  // ---------------- v2.2.1：数据安全现状 ----------------
  // 企业里"安全"不能是一句口号，得**看得见当前状态**。
  // 这里如实列出：数据在哪、有没有同步路径（丢了能不能找回）、
  // 链接 API 的鉴权与令牌存储方式、以及审计日志是否在记。
  function safetyCard() {
    const v = app.vault || {};
    const p = String(v.path || '');
    let sync = null;
    for (const s of SYNC_HINTS) { if (s.re.test(p)) { sync = s; break; } }
    const kv = (k, val, cls) => h('div', { class: 'kv' }, h('span', null, k), h('b', { class: cls || '', style: { fontSize: '11px' } }, val));
    const box = h('div', { class: 'card' }, h('h3', null, '⑥ 数据安全现状'));
    // v6.20：旧版把「路径字符串里含 onedrive/nas」当成「同步状态已检测 / 可恢复 /
    // 基线已具备」，并把推断包装成实时结论。现在如实区分三类信息。
    // 现在如实区分：路径特征（可观测）、设计约束（产品事实）、未验证项（需用户自查）。
    box.appendChild(h('div', { style: { fontSize: '11.5px', color: 'var(--muted)', lineHeight: '1.8' } },
      '路径特征由当前知识库路径推断；其余为产品设计约束，不是实时探测结论。备份与索引请用下方按钮自行核对。'));
    box.appendChild(kv('数据位置（运行时读取）', p || '—'));
    box.appendChild(kv('路径特征', sync ? `含 ${sync.label} 特征（未验证同步状态）` : '未检出同步路径特征'));
    box.appendChild(kv('备份状态', '未自动验证 · 请用下方「备份整个知识库」并核对导出文件', 'warn'));
    box.appendChild(kv('写入方式（设计约束）', '纯 Markdown 文件夹 · 不改写原始正文'));
    box.appendChild(kv('审计日志（设计约束）', '写操作经 journal 记录，未在此实时校验'));
    box.appendChild(kv('链接 API（设计约束）', '令牌必填 · 令牌经系统密钥环加密'));
    box.appendChild(h('div', { class: 'deploy-verdict ' + (sync ? 'ok' : 'warn') },
      h('b', null, sync ? '检出同步路径特征，仍需核对备份' : '建议：先做一次备份，并核对同步路径'),
      h('span', null, sync
        ? '路径特征不等于同步已完成；请用下方备份功能产出一份可核对的导出，并检查同步端是否确有该文件。'
        : '当前路径未检出同步盘特征 —— 硬盘故障或误删都会丢失。请先用下方「备份整个知识库」导一份，'
          + '并考虑迁入同步盘 / NAS。')));
    return box;
  }

  // ---------------- v2.2.1：备份 / 还原 / 校验（企业数据安全） ----------------
  // 企业场景里最贵的不是功能，是**数据丢了**。本机 .md 文件夹虽然安全，
  // 但硬盘会坏、误删会发生、迁移会出错 —— 没有备份就没有真正的安全。
  // 三个动作都**绝不动用户的原始文件**：
  //   备份 → 导出一份含清单与审计日志的 zip
  //   校验 → 逐张比对 sha256，缺一个都不放过
  //   还原 → **写到新目录**，且还原前必须校验通过
  function backupCard() {
    const box = h('div', { class: 'card' }, h('h3', null, '⑤ 数据安全：备份 / 校验 / 还原'));
    box.appendChild(h('div', { style: { fontSize: '11.5px', color: 'var(--muted)', lineHeight: '1.8' } },
      '备份包内含全部卡片正文、一份逐张 sha256 清单，以及完整审计日志（谁在何时改了什么）。'
      + '还原**只会写入新目录**，绝不覆盖现有库；校验不通过的包会被直接拒绝。'));
    const result = h('div', { class: 'deploy-result' });
    box.appendChild(result);
    box.appendChild(h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          const r = await api.vaultBackup?.backup?.();
          if (r?.ok) {
            result.textContent = `已备份 ${r.cards} 张卡片 → ${r.path}（${(r.bytes / 1048576).toFixed(1)} MB）`;
            toast('备份完成', 'ok', 3600);
          } else if (!r?.canceled) {
            result.textContent = '备份失败：' + String(r?.error || '未知错误');
            toast('备份失败', 'err', 5000);
          }
        },
      }, '备份整个知识库'),
      h('button', {
        class: 'btn ghost',
        title: '选择一个备份包，逐张校验其完整性与一致性',
        onclick: async () => {
          const r = await api.vaultBackup?.verify?.();
          if (r?.ok) {
            result.textContent = r.summary + (r.createdAt ? `（备份于 ${String(r.createdAt).slice(0, 19).replace('T', ' ')}）` : '');
            toast(r.usable ? '校验通过' : '校验未通过', r.usable ? 'ok' : 'err', 4200);
          } else if (!r?.canceled) {
            result.textContent = '校验失败：' + String(r?.error || '未知错误');
          }
        },
      }, '校验备份包'),
      h('button', {
        class: 'btn ghost',
        title: '从备份包还原到一个新文件夹（不覆盖现有库）',
        onclick: async () => {
          const r = await api.vaultBackup?.restore?.();
          if (r?.ok) {
            result.textContent = `已还原 ${r.cards} 张卡片 → ${r.target}（新目录，未改动任何现有数据）`;
            toast('还原完成，请在新目录中打开该库', 'ok', 6000);
          } else if (!r?.canceled) {
            result.textContent = '还原被拒绝：' + String(r?.error || '未知错误');
            toast('还原未执行，现有数据未受影响', 'err', 6000);
          }
        },
      }, '从备份包还原'),
    ));
    return box;
  }

  function render() {
    page.innerHTML = '';
    page.appendChild(head());
    page.appendChild(h('div', { class: 'grid2' },
      h('div', null, modeCard(), safetyCard()),
      h('div', null, healthCard(), rulesCard(), agentCard(), backupCard()),
    ));
  }

  // v2.2.0：退订监听器（app.on 返回退订函数）—— 覆盖视图随进随出，
  // 不退订则监听器只增不减，反复切换后一次 'vault' 会并发触发多个 load()。
  const offVault = app.on((kind) => { if (kind === 'vault') load(); });
  load();
  status('团队部署');
  return { refresh: load, unmount() { try { offVault(); } catch { /* ignore */ } } };
}
