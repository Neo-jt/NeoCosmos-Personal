// 库管理 · 多知识库 / 跨库关联图谱 / 本地链接 API（v2.2.0 企业能力）
// ---------------------------------------------------------------------------
// 形态：企业版专属入口（个人版精简隐藏）。
// 三块能力，全部由本机真实数据驱动：
//   ① 跨库关联图谱 —— 库为节点，边权 = 共享标题×2 + 共享标签（主进程扫描各库磁盘得出）
//   ② 知识库登记   —— 列出本机已登记的库，可切换 / 复制深链 / 移除登记
//   ③ 链接 API     —— 可选的本地只读 HTTP 服务，仅监听 127.0.0.1，令牌鉴权
// 纪律：所有数字均来自运行时；扫描受限如实标注；不虚构任何一条边或一个计数。
import { h, toast, status, modal, confirmDialog, icon } from '../ui-kit.js';
import { createXGalaxy } from '../xgalaxy.js';
import { pinyinMatch } from '../pinyin-initial.js';
// v6.27.0：图例语义色走共享令牌，不再写死 hex。
import { SEM } from '../semantic-palette.js';

const ENDPOINTS = [
  { m: 'GET', u: '/api/health', d: '存活探测与版本' },
  { m: 'GET', u: '/api/vaults', d: '已登记库清单 + 跨库图谱' },
  { m: 'GET', u: '/api/cards?q=&limit=', d: '卡片列表（可按标题/标签过滤）' },
  { m: 'GET', u: '/api/cards/:id', d: '单张卡片全文与关系' },
  { m: 'GET', u: '/api/graph', d: '当前库的图谱载荷' },
];

export function mountVaults({ host, app, api, toast, status, route }) {
  host.innerHTML = '';
  const page = h('div', { class: 'page' });
  host.appendChild(page);

  let registry = { vaults: [], activeId: null };
  let xgraph = { nodes: [], edges: [] };
  // v2.2.1：令牌不再由 status() 明文回传（只有 hasToken / tokenEncrypted 标志），
  // token 字段仅在用户刚生成或刚启动时短暂存在于本地变量里。
  // v6.20：未取数前为 null，避免取数失败时一直显示写死的「未启动 / 8787」
  let apiState = null;
  // v2.2.1：3D 多库星系
  let galaxy = null;          // createXGalaxy 实例（切页时必须销毁，否则 WebGL 上下文泄漏）
  let selVault = null;        // 当前选中的库节点
  let autoRotate = false;
  // v3.0.0：知识库登记列表支持拼音首字母检索（如「bj」匹配「北京」）
  let vaultFilter = '';

  // ---------------- 数据装载（全部来自真实主进程） ----------------
  // v2.2.0：代次守卫 —— 快速切页时，先发后到的旧请求不得覆盖新数据
  let gen = 0;
  // force=true 表示用户显式点了「刷新状态」：此时跨库图谱要真正重扫磁盘，
  // 否则用户点了刷新看到的还是缓存里的旧数据 —— 那才是真的"点了没反应"。
  // 普通进入页面走缓存（主进程 30s TTL），避免每次进页面都全盘扫描。
  async function loadAll(force = false) {
    const my = ++gen;
    // v2.2.0：登记"正在取数"（跨库图谱要扫盘，可能耗时数秒）
    const done = app.beginLoad();
    try {
      status('正在读取本机知识库登记…');
      const [r, x, s] = await Promise.all([
        api.vault.list(),
        api.vaults?.xgraph?.({ force }),
        api.apiServer?.status?.(),
      ]);
      if (r?.ok) registry = r.data || registry;
      if (x?.ok) xgraph = x.data || xgraph;
      if (s?.ok) apiState = s.data || apiState;
      if (my !== gen) return;
      render();
      status('库管理已就绪');
    } catch (e) {
      // 绝不留空白页：失败必须显式呈现，且说清原因
      console.error('[vaults] 加载失败', e);
      const msg = String(e && e.message || e);
      page.innerHTML = '';
      page.appendChild(h('div', { class: 'empty-hint' }, '库管理加载失败：' + msg));
      status('库管理加载失败');
      toast('库管理加载失败：' + msg, 'err', 6000);
    } finally {
      // v2.2.1：无论成功、失败还是被代次守卫丢弃，都要**归还**加载计数 ——
      // 否则一次异常就会让计数永久停在 1，"界面是否安定"的判断从此失灵。
      done();
    }
  }

  // ---------------- 顶部说明 ----------------
  function head() {
    return h('div', { class: 'page-head' },
      h('h2', null, '库管理 · 多知识库与链接 API'),
      h('p', null,
        '企业版能力，全部在本机完成：跨库关联图谱按「共享标题×2 + 共享标签」计算库间关联强度（数据来自对各库磁盘内容的真实扫描）；'
        + '链接 API 是可选启用的本地只读服务，默认仅监听 127.0.0.1 并要求令牌，不上传云端、知识库文件留在本机；'
        + '如需让其它电脑访问，在企业管理 →「链接管理」中显式切换绑定模式并查看真实调用记录。'),
    );
  }

  // ---------------- ① 跨库关联图谱 ----------------
  function renderXGraph() {
    const card = h('div', { class: 'card' },
      h('h3', null, '跨库关联图谱',
        h('span', { class: 'cnt' }, `${xgraph.nodes.length} 库 · ${xgraph.edges.length} 条关联`)),
      // v2.2.1：跨库图谱升级为**真 3D**（多库星系）。
      // 原先是 2D 力导向画布 —— 库一多就挤成一团，且与主星图视觉割裂。
      // 现在与主星图共用 three.js 与深空语言：球体=库、拱形管=关联、粗细=强度。
      h('div', { class: 'xv-graph xv-graph-3d', id: 'xvGalaxyRoot' }),
      h('div', { class: 'xv-toolbar' },
        h('button', { class: 'btn ghost', onclick: () => { galaxy?.setAutoRotate(!autoRotate); autoRotate = !autoRotate; toast(autoRotate ? '多库星系开始自转' : '多库星系停止自转', 'ok', 1600); } }, autoRotate ? '停止自转' : '自动旋转'),
        h('button', {
          class: 'btn ghost',
          title: '把镜头拉回当前打开的知识库',
          // v2.2.1：给一个明确的反馈。
          // 移动镜头**不产生任何 DOM 变化** —— 只看 DOM 会以为这个按钮"点了没反应"。
          // 一条提示既是给用户的确认，也是让这个行为可被自动验证。
          onclick: () => {
            const id = app.vault?.id || registry.activeId;
            const name = registry.vaults.find((v) => v.id === id)?.name || '当前库';
            galaxy?.focus(id);
            toast(`镜头已回到「${name}」`, 'ok', 1800);
          },
        }, '回到当前库')),
      h('div', { class: 'xv-legend' },
        h('span', null, h('span', { class: 'sw', style: { background: 'var(--accent)' } }), '知识库节点'),
        h('span', null, h('span', { class: 'sw', style: { background: SEM.neuro4 } }), '当前库（带轨道环）'),
        h('span', null, '球体大小 = 卡片数　管粗细 = 关联强度'),
        h('span', null, '边权 = 共享标题×2 + 共享标签'),
        h('span', null, '可拖拽旋转 · 滚轮缩放 · 点击节点查看详情'),
      ),
      xgraph.edges.length ? h('div', { class: 'xv-edges' },
        ...xgraph.edges.map((e) => {
          const a = xgraph.nodes.find((n) => n.id === e.source);
          const b = xgraph.nodes.find((n) => n.id === e.target);
          return h('div', { class: 'xv-edge-row' },
            h('span', { class: 'xe-a' }, a?.name || e.source),
            h('span', { class: 'xe-w' }, String(e.weight)),
            h('span', { class: 'xe-b' }, b?.name || e.target),
            h('span', { class: 'xe-d' }, `共享标题 ${e.sharedTitles} · 共享标签 ${e.sharedTags}`));
        }),
      ) : h('div', { class: 'empty-hint' },
        xgraph.nodes.length < 2
          ? '至少登记两个知识库，才能计算库间关联。'
          : '当前各库之间没有共享标题或标签，因此暂无关联边。'),
    );
    setTimeout(() => drawXGraph(card), 30);
    return card;
  }

  /**
   * 建立 3D 多库星系。
   * v2.2.1：原先这里是 2D 力导向画布（ctx.arc / ctx.stroke），
   * 库一多就糊成一团，而且与主星图的视觉语言割裂。
   * 现在改为 three.js 真 3D：球体=库、拱形管=关联、当前库带轨道环。
   */
  function drawXGraph(card) {
    const root = card.querySelector('#xvGalaxyRoot');
    if (!root) return;
    // 重建前先销毁旧的 —— 否则 WebGL 上下文会累积（上限约 16 个后崩渲染进程）
    if (galaxy) { try { galaxy.dispose(); } catch (e) { console.error(e); } galaxy = null; }
    if (!xgraph.nodes.length) {
      root.appendChild(h('div', { class: 'empty-hint' },
        xgraph.nodes.length < 1
          ? '尚未登记任何知识库。点击标题栏的库名胶囊即可新建或打开一个。'
          : '至少登记两个知识库，才能计算库间关联。'));
      return;
    }
    galaxy = createXGalaxy({
      container: root,
      xgraph,
      currentId: app.vault?.id || registry.activeId,
      onSelect: (n) => {
        if (!n) { selVault = null; galaxy?.setHighlight(null); renderXDetail(); return; }
        selVault = n;
        galaxy?.setHighlight(n.id);
        renderXDetail();
      },
    });
    galaxy.setAutoRotate(autoRotate);
  }

  /** 选中库/边的详情面板 —— 点球体后显示它与谁关联、关联在哪。 */
  function renderXDetail() {
    const host = document.getElementById('xvDetail');
    if (!host) return;
    host.innerHTML = '';
    if (!selVault) {
      host.appendChild(h('div', { class: 'empty-hint' }, '点击星系里的球体，查看该库与其他库的关联明细。'));
      return;
    }
    const rel = xgraph.edges.filter((e) => e.source === selVault.id || e.target === selVault.id)
      .map((e) => {
        const otherId = e.source === selVault.id ? e.target : e.source;
        const other = xgraph.nodes.find((n) => n.id === otherId);
        return { w: e.weight || 0, st: e.sharedTitles || 0, sg: e.sharedTags || 0, name: other?.name || otherId, id: otherId };
      })
      .sort((a, b) => b.w - a.w);
    host.appendChild(h('div', { class: 'xv-detail' },
      h('div', { class: 'xvd-head' },
        h('b', null, selVault.name || '(未命名)'),
        h('span', { class: 'cnt' }, `${selVault.cards ?? 0} 卡片 · ${selVault.tags ?? 0} 标签`)),
      rel.length
        ? h('div', { class: 'xvd-rel' },
            ...rel.map((r) => h('div', {
              class: 'xv-edge-row',
              onclick: () => { galaxy?.setHighlight(r.id); galaxy?.focus(r.id); },
            },
              h('span', { class: 'xe-a' }, r.name),
              h('span', { class: 'xe-w' }, String(r.w)),
              h('span', { class: 'xe-d' }, `共享标题 ${r.st} · 共享标签 ${r.sg}`))))
        : h('div', { class: 'empty-hint' }, '该库目前与其他库没有共享标题或标签，因此没有关联边。'),
    ));
  }

  // ---------------- ② 知识库登记 ----------------
  function renderRegistry() {
    const cur = app.vault?.id || registry.activeId;
    const key = vaultFilter.trim().toLowerCase().replace(/\s+/g, '');
    const vaults = key
      ? registry.vaults.filter((v) => pinyinMatch(key, v.name) || pinyinMatch(key, v.path || ''))
      : registry.vaults;
    const card = h('div', { class: 'card' },
      h('h3', null, '本机已登记的知识库',
        h('span', { class: 'cnt' }, `${registry.vaults.length} 个`)),
      h('input', {
        class: 'vault-filter', placeholder: '检索知识库（支持拼音首字母，如 bj→北京）…',
        value: vaultFilter,
        oninput: (e) => { vaultFilter = e.target.value; render(); },
      }),
      h('div', { class: 'vault-grid' },
        ...vaults.map((v) => {
          const stat = xgraph.nodes.find((n) => n.id === v.id);
          return h('div', { class: 'vault-card' + (v.id === cur ? ' is-current' : '') },
            h('div', { class: 'vc-top' },
              h('span', { class: 'vc-dot', style: { background: v.color || 'var(--accent)' } }),
              h('div', { class: 'vc-main' },
                h('div', { class: 'vc-name', title: v.name }, v.name),
                h('div', { class: 'vc-path', title: v.path }, v.path))),
            h('div', { class: 'vc-stats' },
              h('div', { class: 'vc-stat' },
                h('b', null, stat?.missing ? '—' : (stat?.truncated ? `≥${stat.cards ?? 0}` : String(stat?.cards ?? 0))),
                h('span', null, '卡片'),
                stat?.truncated
                  ? h('i', { title: `库规模较大，仅统计了前 ${stat.cards} 个文件（上限保护）；下方关联强度同样基于这部分` }, '部分扫描')
                  : null),
              h('div', { class: 'vc-stat' },
                h('b', null, String(stat?.tags ?? 0)),
                h('span', null, '标签')),
              h('div', { class: 'vc-stat' },
                h('b', null, String(stat?.missing ? '—' : (stat?.cards ? '在册' : '空'))),
                h('span', null, '状态'))),
            stat?.missing ? h('div', { class: 'vc-warn' }, '文件夹已被移动或删除') : null,
            h('div', { class: 'vc-acts' },
              v.id === cur
                ? h('span', { class: 'badge' }, '当前库')
                : h('button', { class: 'btn', onclick: () => switchVault(v.id) }, '切换到'),
              h('button', { class: 'btn ghost', onclick: () => copyVaultLink(v) }, '复制深链'),
              v.id === cur ? null : h('button', { class: 'btn ghost warn', onclick: () => removeVault(v) }, '移除登记')),
          );
        }),
      ),
      vaults.length ? null : h('div', { class: 'empty-hint' },
        key ? '没有匹配的知识库。' : '尚未登记任何知识库。点击标题栏的库名胶囊即可新建或打开一个。'),
    );
    return card;
  }

  async function switchVault(id) {
    const res = await api.vault.switch(id);
    if (!res?.ok) { toast(res?.error || '切换失败', 'err'); return; }
    await app.refreshVault();
    app.currentId = null; app.history = []; app.hIndex = -1;
    toast(`已切换到「${res.vault?.name || ''}」`, 'ok');
    await loadAll();
  }

  async function copyVaultLink(v) {
    const link = `neolink://open/${v.id}/`;
    try {
      await navigator.clipboard?.writeText(link);
      toast(`已复制库深链：${link}`, 'ok', 3600);
    } catch (e) { toast('复制失败：' + String(e?.message || e), 'err'); }
  }

  async function removeVault(v) {
    const ok = await confirmDialog({
      title: '移除登记',
      message: `将「${v.name}」从本机登记列表中移除。\n不会删除磁盘上的任何文件，但该库将从跨库图谱与库切换列表中消失。`,
      confirmText: '移除登记',
      danger: true,
    });
    if (!ok) return;
    const res = await api.vault.forget(v.id);
    if (res?.ok) { toast('已移除登记', 'ok'); await loadAll(); }
    else toast(res?.error || '移除失败', 'err');
  }

  // ---------------- ③ 链接 API 控制台 ----------------
  function renderApi() {
    const portField = h('input', { type: 'number', min: '1024', max: '65535', value: String(apiState?.port ?? 8787) });
    // v2.2.1 安全加固：令牌**必填**，且默认用主进程生成的高强度随机值。
    // 原先的占位符写着"留空表示不校验" —— 那等于把"读取全部卡片正文"的
    // 能力开放给本机任意进程与任意网页。现在没有任何"不鉴权"的选项。
    const tokenField = h('input', {
      type: 'text', value: apiState?.token || '',
      placeholder: '必填 · 至少 16 位（等同于读取全部卡片的钥匙）',
      autocomplete: 'off', spellcheck: 'false',
    });

    const statusLine = h('div', { class: 'api-status' + (apiState?.running ? ' on' : '') },
      h('span', { class: 'led' }),
      h('span', null, !apiState
        ? '状态读取中…'
        : (apiState.running
          ? `运行中 · http://${apiState.host || '127.0.0.1'}:${apiState.port} · 令牌鉴权已启用`
            + (apiState.bind === 'lan' ? ' · 局域网模式' : ' · 仅本机回环')
            + (apiState.tokenEncrypted ? ' · 令牌已加密保存' : ' · 令牌为明文保存（系统密钥环不可用）')
          : '未启动')));

    const card = h('div', { class: 'card' },
      h('h3', null, '链接 API（本地只读）', h('span', { class: 'cnt' }, apiState?.bind === 'lan' ? '局域网模式' : '127.0.0.1')),
      h('p', { class: 'card-note' },
        '默认仅监听 127.0.0.1 回环；用于让外部脚本 / Agent 以 HTTP 读取当前库与跨库图谱。'
        + '如需让同一局域网的其它电脑访问，请在企业管理 →「链接管理」中显式切换为局域网模式（仍强制令牌）。'
        + '接口可返回卡片**正文全文**，因此令牌强制必填、且由系统密钥环加密保存。'),
      h('div', { class: 'api-grid' },
        h('div', { class: 'field' }, h('label', null, '端口'), portField),
        h('div', { class: 'field' }, h('label', null, '访问令牌'), tokenField)),
      h('div', { class: 'btn-row' },
        apiState?.running
          ? h('button', { class: 'btn warn', onclick: () => stopApi() }, '停止服务')
          : h('button', { class: 'btn', onclick: () => startApi(portField.value, tokenField.value) }, '启动服务'),
        h('button', {
          class: 'btn ghost',
          title: '生成一个高强度随机令牌（32 字节，base64url）',
          onclick: async () => {
            const r = await api.apiServer?.genToken?.();
            if (r?.ok && r.data?.token) {
              tokenField.value = r.data.token;
              toast('已生成新令牌，启动服务后生效', 'ok', 3000);
            } else toast(r?.error || '生成失败', 'err');
          },
        }, '生成随机令牌'),
        h('button', { class: 'btn ghost', onclick: () => copyBase() }, '复制接口地址'),
        h('button', { class: 'btn ghost', onclick: () => loadAll(true) }, '刷新状态')),
      h('div', { class: 'api-state' }, statusLine),
      h('div', { class: 'api-list' },
        ...ENDPOINTS.map((e) => h('div', { class: 'api-endpoint' },
          h('span', { class: 'm' }, e.m),
          h('span', { class: 'u', title: e.d }, e.u),
          h('span', { class: 'd' }, e.d),
          h('button', { class: 'btn ghost', onclick: () => copyText(baseUrl() + e.u) }, '复制')))),
    );
    return card;
  }

  function baseUrl() {
    return `http://127.0.0.1:${apiState?.port || 8787}`;
  }
  async function copyText(t) {
    try { await navigator.clipboard?.writeText(t); toast('已复制：' + t, 'ok', 3000); }
    catch (e) { toast('复制失败：' + String(e?.message || e), 'err'); }
  }
  function copyBase() { copyText(baseUrl() + '/api/health'); }

  async function startApi(port, token) {
    const res = await api.apiServer?.start?.({ port: Number(port) || 8787, token: String(token || '') });
    if (!res?.ok) {
      toast(res?.error || '启动失败', 'err', 6000);
      return;
    }
    // v2.2.1：启动成功后令牌就不再留在界面上了（它已经加密进了系统密钥环）
    apiState = { ...(apiState || {}), ...res.data, running: true };
    apiState.token = '';
    toast(`链接 API 已启动：${baseUrl()}`, 'ok', 3600);
    await loadAll();
  }
  async function stopApi() {
    const res = await api.apiServer?.stop?.();
    if (!res?.ok) { toast(res?.error || '停止失败', 'err'); return; }
    apiState = { ...(apiState || {}), running: false };
    toast('链接 API 已停止', 'ok');
    await loadAll();
  }

  // ---------------- 渲染 ----------------
  function render() {
    page.innerHTML = '';
    page.appendChild(head());
    page.appendChild(renderXGraph());
    // 选中详情区：点球体后在这里看该库与谁关联
    page.appendChild(h('div', { class: 'card xv-detail-card', id: 'xvDetail' }));
    page.appendChild(renderRegistry());
    page.appendChild(renderApi());
    renderXDetail();
  }

  // 先渲染骨架（任何时候都不出现空白页），随后异步填数据
  render();
  loadAll();

  return {
    unmount() {
      // v2.2.1：**必须销毁 3D 星系**。
      // three.js 的 renderer.dispose() 不释放 WebGL 上下文，
      // 而 Chromium 同时存活的上下文有上限（约 16 个）——
      // 不销毁的话，来回进出「库管理」十几次就会把渲染进程撑爆。
      if (galaxy) { try { galaxy.dispose(); } catch (e) { console.error(e); } galaxy = null; }
    },
  };
}
