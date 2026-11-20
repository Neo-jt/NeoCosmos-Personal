// 沉淀 · Agent 回写控制台
// 这里不是"写笔记的地方"，而是外部智能体的写入通道：
//   外部 AI 助手经标准接口调用 kb_write_back → 结论回写进大脑知识库。
// 三条纪律在界面上被显式表达：来源可辨（origin=agent）· 全程审计（journal）· 永不覆盖人写正文。
// v1.1.0：图标改用 SVG；"应用"按钮如实反映引擎结果。
import { h, toast, status, fmtTime, icon, copyToClipboard, emptyState, confirmDialog } from '../ui-kit.js';
import { CAPABILITY_MANIFEST } from '../capability-manifest.js';
// v6.23.1：外部平台链接状态面板（自刷新，不参与本页 render，避免轮询重置用户操作）
import { createLinksPanel } from './mcp-links-panel.js';

// v6.18.0：宿主接入配置不在界面里手写 JSON —— 全部经 tool:invoke 调
// kb_host_config，与标准接口服务 / CLI 共用 src/mcp/hosts.js 单一真源。
// v6.35.0：选项按"配置形态"命名为原创中文名；value 是本产品自己的形态代号，
// 由内核 kb_host_config 映射为真实协议键，界面与 UI 源码不含任何第三方品牌字样。
const HOST_OPTIONS = [
  { value: 'form-servers', label: '标准接口 · 服务器清单形态' },
  { value: 'form-generic', label: '标准接口 · 通用清单形态' },
  { value: 'form-desktop', label: '标准接口 · 桌面客户端形态' },
  { value: 'form-plain', label: '通用标准接口客户端' },
];

export function mountSettle({ host, app, api, toast, status, route }) {
  host.innerHTML = '';
  const page = h('div', { class: 'page' });
  host.appendChild(page);
  // v6.23.1：链接面板只创建一次、复用同一个 DOM 节点；它自己 5 秒轮询并只重绘
  // 自己的子树。若放进 render() 里重建，定时器会随 render 次数累积，且每次
  // 轮询都会把「目标宿主」下拉框与已生成的接入配置清空。
  const linksPanel = createLinksPanel({ api, toast });
  // v2.2.0：立即给出载入占位 —— 数据回来前不留空白页
  // （此前空白是常态：任何一次中途交互都会让页面永久停在空白）
  page.appendChild(h('div', { class: 'empty-hint' }, '正在载入沉淀台…'));

  let data = null;
  // v6.23.0：沉淀回写仓库的可选项来自真实注册表 + 用户真实选择，不预置任何库名。
  let scopeSnap = null;

  // v2.2.0：代次守卫 —— 快速切页时，先发后到的旧请求不得覆盖新数据
  let gen = 0;
  async function load() {
    const my = ++gen;
    // v2.2.0：登记"正在取数"，外部（如审计）据此判断界面是否已安定
    const done = app.beginLoad();
    let r, s;
    try {
      [r, s] = await Promise.all([
        api.sediment(120),
        (api.connections && api.connections.list ? api.connections.list() : Promise.resolve(null)),
      ]);
    }
    finally { done(); }   // v2.2.1：异常时也要归还计数，否则"界面是否安定"的判断会失灵
    if (my !== gen) return;
    scopeSnap = (s && s.ok !== false) ? (s.data || null) : null;
    if (!r?.ok) {
      page.innerHTML = '';
      page.appendChild(emptyState('warn', '读取沉淀失败', r?.error || '未能读取沉淀数据，可在「体系」页重建索引后重试。'));
      return;
    }
    data = r.data;
    render();
  }

  function head() {
    return h('div', { class: 'page-head' },
      h('h2', null, '沉淀 · 回写通道'),
      h('p', null, '沉淀层是外部 AI Agent 经 Skill / MCP 回写进来的记忆，与人手写的正文分列。三条纪律由系统保证，不是约定：来源可辨（origin=agent）、全程审计（写操作进 journal）、永不覆盖人写正文（只能追加沉淀区或新建独立卡片）。v6.23.0 起可为回写指定一个你自己选择的专用知识库，与其它库分开存放。'),
    );
  }

  /** v6.23.0：用户选定的专用沉淀回写仓库；没选就返回空字符串（配置保持单一 --vault）。 */
  function sedimentVaultPath() {
    return (scopeSnap && scopeSnap.sedimentVault && scopeSnap.sedimentVault.path) || '';
  }

  function repositoryCard() {
    const target = scopeSnap && scopeSnap.sedimentVault ? scopeSnap.sedimentVault : null;
    const vaults = (scopeSnap && Array.isArray(scopeSnap.scopes)) ? scopeSnap.scopes : [];
    const canSet = !!(api.connections && api.connections.sedimentSet);
    const canCreate = !!(api.connections && api.connections.sedimentCreate);
    const card = h('div', { class: 'card' }, h('h3', null, '⓪ 沉淀回写仓库'));
    card.appendChild(h('p', { class: 'mcp-note' },
      'Agent 经 MCP 或逆向沉淀回写的内容，可以落进一个由你自己选择的独立知识库，'
      + '与人手写正文、与其它知识库分开。检索与引用仍来自配置里 --vault 指向的源库；'
      + '未选择专用仓库时，回写仍进入源库，界面如实标注，不假装已经隔离。'));
    card.appendChild(h('div', { class: 'conn-lan' },
      h('b', null, '当前回写目标'),
      h('span', null, target
        ? `${target.name} · ${target.path}（独立落盘）`
        : (scopeSnap ? '未设置专用仓库 · 回写进入源库' : '正在读取仓库设置…'))));
    const sel = h('select', { 'aria-label': '选择沉淀回写仓库' });
    sel.appendChild(h('option', { value: '' }, '不设专用仓库（回写到源库）'));
    for (const v of vaults) {
      sel.appendChild(h('option', { value: v.id, ...(target && target.id === v.id ? { selected: true } : {}) },
        `${v.name}${v.purpose === 'sediment' ? ' · 专用沉淀库' : ''}`));
    }
    if (target && !vaults.some((v) => v.id === target.id)) {
      sel.appendChild(h('option', { value: target.id, selected: true }, `${target.name}（已选）`));
    }
    card.appendChild(h('div', { class: 'field' }, h('label', null, '选择已登记的知识库'), sel));
    const acts = h('div', { class: 'btn-row' });
    acts.appendChild(h('button', { class: 'btn', disabled: !canSet || !scopeSnap, onclick: async () => {
      const id = sel.value || null;
      const res = await api.connections.sedimentSet({ id });
      if (res?.ok === false) toast(res.error || '保存失败', 'err');
      else { toast(id ? '已设置沉淀回写仓库' : '已取消专用沉淀回写仓库', 'ok'); await load(); }
    } }, '保存选择'));
    acts.appendChild(h('button', { class: 'btn ghost', disabled: !canCreate, onclick: async () => {
      const go = await confirmDialog({
        title: '新建专用沉淀回写仓库',
        message: '会在知识库存放位置新建一个真实的独立文件夹（不含示例卡片），并设为回写目标。'
          + '\n\n不会切换当前打开的知识库，也不会改动任何已有库里的文件。',
        confirmText: '创建并设为回写目标',
      });
      if (!go) return;
      const res = await api.connections.sedimentCreate({ name: 'NeoCosmos 沉淀库' });
      if (res?.ok === false) toast(res.error || '创建失败', 'err');
      else {
        const c = res?.data?.created;
        toast(c ? `已新建沉淀库 ${c.path}` : '已新建沉淀库', 'ok', 4200);
        await load();
      }
    } }, '新建专用沉淀库'));
    card.appendChild(acts);
    card.appendChild(h('p', { class: 'card-note' },
      '选择后，下方 MCP 接入配置会带上真实的 --sediment-vault 参数；'
      + 'HTTP 逆向沉淀（POST /api/sediment）也会写入该库，并在审计里记录源库与沉淀库。'
      + '设置变更会重新生成配置，请重新复制。'));
    return card;
  }

  function channelCard() {
    const vault = app.vault?.path || '';
    let current = null;                 // 最近一次真实生成的接入包
    const hostSel = h('select', { 'aria-label': '选择 MCP 宿主', spellcheck: 'false' },
      ...HOST_OPTIONS.map((o) => h('option', { value: o.value }, o.label)));
    const cfgBox = h('pre', { class: 'code-block' }, '正在生成真实接入配置…');
    const cliBox = h('div', { class: 'code-block', style: { marginTop: '8px' } }, '—');
    const meta = h('div', { class: 'mcp-meta' }, '配置由内核生成，路径取自本机真实安装位置。');

    async function generate() {
      const host = hostSel.value;
      try {
        // v6.23.0：配置了专用沉淀回写仓库时，把真实目录传给单一真源生成 --sediment-vault。
        const sedimentVault = sedimentVaultPath();
        const r = await api.tool('kb_host_config', {
          host, vault: vault || undefined,
          ...(sedimentVault ? { sediment_vault: sedimentVault } : {}),
        });
        if (!r?.ok || r.data?.error) {
          current = null;
          cfgBox.textContent = '配置生成失败：' + (r?.error || r.data?.error || '未知错误');
          cliBox.textContent = '—';
          meta.textContent = '请检查是否已打开知识库，或改用 --print-config 命令行生成。';
          return false;   // v6.20：让「重新生成」按真实结果提示，不再无条件报成功
        }
        current = r.data;
        cfgBox.textContent = current.configJson;
        cliBox.textContent = current.cli?.add || current.cli?.selfcheck || '—';
        meta.textContent = `${current.label} · ${current.shape} · caller=${current.caller} · ${current.configPath}`
          + (vault ? '' : ' · 未打开知识库，配置中的库路径为待替换占位符')
          + (current.sedimentVault ? ` · 沉淀回写仓库 ${current.sedimentVault}` : '');
        return true;
      } catch (e) {
        // v6.20：内核调用异常也要落到可见错误，不能变成无人接管的 Promise 拒绝
        current = null;
        cfgBox.textContent = '配置生成失败：' + String(e?.message || e);
        cliBox.textContent = '—';
        meta.textContent = '请检查是否已打开知识库，或改用 --print-config 命令行生成。';
        return false;
      }
    }

    const copyCfg = h('button', {
      class: 'btn', onclick: async () => {
        if (!current) { toast('尚未生成配置', 'err'); return; }
        await copyToClipboard(current.configJson, `已复制 ${current.label} 接入配置`);
      },
    }, '复制配置');
    const copyCli = h('button', {
      class: 'btn ghost', onclick: async () => {
        if (!current?.cli) { toast('尚未生成配置', 'err'); return; }
        await copyToClipboard(current.cli.add || current.cli.selfcheck, '已复制注册 / 自检命令');
      },
    }, '复制命令');

    hostSel.addEventListener('change', () => { generate().catch(() => {}); });

    const c = h('div', { class: 'card mcp-channel' },
      h('h3', null, '① 回写通道（MCP）'),
      h('div', { class: 'mcp-note' },
        `把 NeoCosmos 挂成标准输入输出接口服务，外部助手即可使用 kb_search / kb_read / kb_write_back 等 ${CAPABILITY_MANIFEST.totals.mcpTools} 个工具（数量由源码清单生成）。配置按所选形态真实生成。`),
      h('div', { class: 'field' }, h('label', null, '接入形态'), hostSel),
      h('div', { class: 'mcp-label' }, '配置文件内容（生成后可复制）'),
      cfgBox,
      h('div', { class: 'mcp-label', style: { marginTop: '10px' } }, '注册 / 自检命令'),
      cliBox,
      meta,
      h('div', { class: 'btn-row' },
        copyCfg,
        copyCli,
        h('button', { class: 'btn ghost', onclick: async () => {
          // v6.20：旧写法既不等待生成结果也不检查返回值，失败时照样报成功。
          // 现在按内核真实结果决定提示语气。
          const ok = await generate();
          toast(ok ? '已按当前宿主重新生成' : '配置生成失败，未更新；请查看上方错误提示', ok ? 'ok' : 'err');
        } }, '重新生成'),
        h('button', { class: 'btn ghost', onclick: () => { api.vault.reveal(); toast('已在文件管理器中打开知识库目录', 'ok'); } }, '打开知识库目录'),
      ),
      h('p', { class: 'mcp-note', style: { marginTop: '10px' } },
        '外部助手默认只有检索 / 读取 / 沉淀区追加权限，不能改写或删除用户正文；注册后请按生成的自检命令做一次真实连通验证。'),
    );
    generate().catch(() => {});
    return c;
  }

  function newCardCard() {
    const title = h('input', { placeholder: '卡片标题', spellcheck: 'false' });
    const tags = h('input', { placeholder: '标签，空格分隔，如：商业秘密 反向工程', spellcheck: 'false' });
    const body = h('textarea', { placeholder: '正文。写 [[双链]] 即建立突触；写 #标签 即入标签云。', spellcheck: 'false' });
    const c = h('div', { class: 'card' },
      h('h3', null, '② 自己写一张卡片'),
      h('div', { class: 'field' }, h('label', null, '标题'), title),
      h('div', { class: 'field' }, h('label', null, '标签'), tags),
      h('div', { class: 'field' }, h('label', null, '正文'), body),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: async () => {
          const t = title.value.trim();
          if (!t) { toast('请填写标题', 'err'); return; }
          const res = await api.doc.create({
            title: t,
            folder: '_memory/semantic',
            body: body.value,
            tags: tags.value.split(/\s+/).filter(Boolean),
          });
          if (res?.ok) {
            toast(`已创建「${res.data.title}」${res.data.inherited ? ` · 继承 ${res.data.inherited} 条突触` : ''}`, 'ok');
            title.value = ''; body.value = ''; tags.value = '';
            await app.refreshVault();
            await app.openCard(res.data.id);
            route('workspace');
          } else toast(res?.error || '创建失败', 'err');
        } }, '创建'),
      ),
    );
    return c;
  }

  function inflowCard() {
    const items = data?.qa || [];
    const box = h('div', { class: 'card' },
      h('h3', null, '回写入流', h('span', { class: 'cnt' }, `共 ${data?.totals?.qa || 0} 条`)),
    );
    if (!items.length) {
      // v6.18.0：统一接入真实空状态组件（原先只有「问一问」用了它）
      box.appendChild(emptyState('empty', '还没有 Agent 回写过内容',
        '把 NeoCosmos 挂成 MCP 后，让 Agent 先 kb_search 再 kb_write_back，沉淀就会流进这里。'));
      return box;
    }
    for (const q of items) {
      box.appendChild(h('div', { class: 'sed-item' },
        h('div', { class: 'q' }, q.question || '（无问题）'),
        h('div', { class: 'a' }, String(q.answer || '').slice(0, 400)),
        h('div', { class: 'f' },
          h('span', null, q.origin === 'agent' ? 'Agent 回写' : (q.origin || 'user')),
          q.vaultName ? h('span', null, `库：${q.vaultName}`) : null,
          h('span', null, `置信 ${q.confidence ?? '—'}`),
          q.createdAt ? h('span', null, fmtTime(q.createdAt)) : null,
          ...(q.tags || []).map((t) => h('span', { class: 'tagx' }, `#${t}`)),
          ...(q.cited || []).map((c) => h('span', {
            class: 'tagx', style: { cursor: 'pointer', color: 'var(--cyan)' },
            onclick: () => { app.openCard(c.id); route('workspace'); },
          }, `↗ ${c.title}`)),
        ),
        h('div', { class: 'ra' },
          h('button', { class: 'btn ghost', onclick: () => solidify(q) }, '固化为正式卡片'),
        ),
      ));
    }
    return box;
  }

  function reviewCard() {
    const items = data?.review || [];
    const box = h('div', { class: 'card' },
      h('h3', null, '待整理清单', h('span', { class: 'cnt' }, `共 ${data?.totals?.review || 0} 条`)),
    );
    if (!items.length) { box.appendChild(emptyState('empty', '当前没有待整理项', '执行一轮「巩固」会产出消歧、补边、孤立与矛盾的建议。')); return box; }
    for (const r of items) {
      box.appendChild(h('div', { class: 'review-item' },
        h('div', { class: 'rt' },
          h('span', { class: 'rt-ico', html: icon('file', 12) }),
          h('span', { style: { color: 'var(--text)' } }, r.title || ''),
          r.status === 'applied' ? h('span', { class: 'badge', style: { marginLeft: 'auto' } }, '已应用') : null),
        h('div', { class: 'rd' }, r.detail || ''),
        h('div', { class: 'ra' },
          r.status !== 'applied' ? h('button', { class: 'btn ghost', onclick: async (ev) => {
            // 后端可能要重新索引，先给按钮一个即时可见的处理中状态：
            // 点击本来就该有反馈，不能让用户对着没变化的按钮怀疑没点上。
            const btn = ev.currentTarget;
            const original = btn.textContent;
            btn.disabled = true;
            btn.textContent = '处理中…';
            try {
              const res = await api.applyReview({ id: r.id });
              const d = res?.data;
              if (res?.ok && d?.applied) { toast(d.note || '已应用', 'ok'); await app.refreshVault(); await load(); }
              else toast(d?.note || res?.error || '该建议需要人工处理，未自动执行', 'err', 4200);
            } finally {
              btn.disabled = false;
              btn.textContent = original;
            }
          } }, '应用') : null,
          r.payload?.node_id ? h('button', { class: 'btn ghost', onclick: () => { app.openCard(r.payload.node_id); route('workspace'); } }, '打开卡片') : null,
          (r.payload?.ids?.[0]) ? h('button', { class: 'btn ghost', onclick: () => { app.openCard(r.payload.ids[0]); route('workspace'); } }, '打开卡片') : null,
          (r.payload?.a) ? h('button', { class: 'btn ghost', onclick: () => { app.openCard(r.payload.a); route('workspace'); } }, '打开卡片') : null,
        ),
      ));
    }
    return box;
  }

  function inboxCard() {
    const items = data?.inbox || [];
    const box = h('div', { class: 'card' },
      h('h3', null, '工作记忆收件箱', h('span', { class: 'cnt' }, `共 ${items.length} 张`)),
    );
    if (!items.length) { box.appendChild(emptyState('empty', '工作记忆为空', '短期线索会被放在这里并随时间老化。')); return box; }
    for (const n of items) {
      box.appendChild(h('div', { class: 'review-item' },
        h('div', { class: 'rt', style: { cursor: 'pointer' }, onclick: () => { app.openCard(n.id); route('workspace'); } },
          h('span', { class: 'rt-ico', html: icon('file', 12) }),
          h('span', { style: { color: 'var(--text)' } }, n.title)),
        h('div', { class: 'rd' }, n.path),
      ));
    }
    return box;
  }

  async function solidify(q) {
    const title = (q.question || '沉淀卡片').replace(/[\\/:*?"<>|]/g, '').slice(0, 60);
    const cites = (q.cited || []).map((c) => `[[${c.title}]]`).join(' · ');
    const body = [
      q.answer || '',
      '',
      cites ? `引自：${cites}` : '',
      '',
      '<!-- neolink:沉淀区 begin -->',
      `问：${q.question || ''}`,
      `答：${q.answer || ''}`,
      `置信：${q.confidence ?? '—'} · 来源：${q.origin || 'agent'}`,
      '<!-- neolink:沉淀区 end -->',
    ].filter(Boolean).join('\n');
    const res = await api.doc.create({ title, folder: '_memory/semantic', body, tags: q.tags || [] });
    if (res?.ok) {
      toast(`已固化为卡片「${res.data.title}」`, 'ok');
      await app.refreshVault();
      await load();
    } else toast(res?.error || '固化失败', 'err');
  }

  function render() {
    page.innerHTML = '';
    page.appendChild(head());
    page.appendChild(linksPanel.el);   // 复用节点：appendChild 只做移动，不重建
    const grid = h('div', { class: 'grid2' },
      h('div', null, repositoryCard(), channelCard(), newCardCard()),
      h('div', null, inflowCard(), reviewCard(), inboxCard()),
    );
    page.appendChild(grid);
  }

  // v2.2.0：app.on 返回退订函数，**必须**在 unmount 时调用它。
  // 否则每进一次这个视图就多挂一个监听器，而这些视图是"随进随出"的覆盖层
  // （route() 每次都重新 mount）—— 监听器只增不减，反复切换后一次 'vault'
  // 事件会并发触发 N 个 load()，互相踩代次守卫，视图就卡在载入占位上。
  const offVault = app.on((kind) => { if (kind === 'vault') load(); });
  load();
  linksPanel.start();
  status('沉淀控制台');
  return {
    refresh: load,
    unmount() {
      linksPanel.stop();          // v6.23.1：清掉 5 秒轮询，防止随进随出堆积定时器
      try { offVault(); } catch { /* ignore */ }
    },
  };
}
