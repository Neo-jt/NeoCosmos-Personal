// 星图 · 所有知识卡片的管理网络
// 与常见"图谱视图"的差别：星图不是装饰性的可视化，而是管理入口——
//   点卡片 → 打开它的文档；按突触类型筛选 → 只看某一类关系；
//   输入问题 → 激活扩散全过程在星图上实时点亮（能看到联想是怎么走过去的）。
// v1.1.0：跨库幽灵节点（外圈淡青色，点击可切库直达）。
// v2.0.0 Aurora：
//   · HUD 常驻「当前知识库」卡片（库名/路径/规模）——库名同时由渲染层画在星图中央
//   · 五种结构视图：星座 / 引力 / 皮层 / 空间折叠 / 多库星系（同一份真实数据，五种可读结构）
//   · 领域图例：点击某一领域即聚焦该簇，其余淡出，结构一眼可辨
import { h, toast, status } from '../ui-kit.js';
import { createCosmos, LAYOUT_MODES, domainColorOf } from '../cosmos.js';
import { makeFloatPanel } from '../float-panel.js';
// v6.27.0：突触配色 / 库默认色 / 跨库语义色统一从共享真源取。
import { EDGE_COLORS, SEM } from '../semantic-palette.js';

// 显示密度档位：突触几千条时全画只会糊成一团，按权重稀疏化后仍能看清结构。
// 这里属于"显示策略"，放在渲染层（引擎 src/ 由主进程独占，渲染层经协议只能拿到 ui/）。
//
// v2.2.1 修正：原先的档位是**固定上限**（标准档 1000 条边、每卡最多 6 条），
// 于是 692 张卡片、18331 条突触的库只画出 1000 条 —— 用户看到的是"文件显示不全"。
// 真实情况是：节点一个不少（显示 692 / 692），少的是**边**，而且界面只在小字里
// 提示"1000/18331"，很容易被忽略。
// 现在上限随**实际规模**走：小库全画，中库按比例留足，大库才真正稀疏；
// 并且任何一档都不再让用户"以为只有这些"。
const DENSITY = {
  sparse: { label: '稀疏', maxEdgesPerNode: 3, maxEdges: 1500 },
  standard: { label: '标准', maxEdgesPerNode: 12, maxEdges: 12000 },
  full: { label: '完整', maxEdgesPerNode: 999, maxEdges: 999999 },
};

// v2.1.0：视图层级。渲染层永远只拿到几千个对象，百万级卡片才能秒开。
const LEVELS = [
  { key: 'overview', label: '总览', hint: '按领域聚合成超节点：一屏看全库结构，点击球可下钻' },
  { key: 'full', label: '全量', hint: '逐张卡片展开（卡片过多时会自动稀疏化显示）' },
];
// 与引擎侧 FULL_NODE_LIMIT 对齐：超过这个量级就不允许全量导出
const FULL_LEVEL_LIMIT = 20000;

// 各视图的结构语义（鼠标悬停提示）
const LAYOUT_HINT = {
  constellation: '星座：引擎真实力导向坐标 + 每个领域的簇质心标注',
  idspace: '星位：每张卡片的三维坐标只由它的 id 确定性派生，同一张卡片永远落在同一星位',
  gravity: '引力：按领域分扇区，半径由突触度数决定（枢纽近中心）',
  cortex: '皮层：三层记忆分同心壳（语义内 / 情景中 / 工作外）',
  spacefold: '空间折叠：以质心为奇点，远端指数收缩 + 同心褶皱，把遥远知识簇向中心收拢',
  multikb: '多库星系：本地主星系 + 其他知识库卫星星系（标注库名）',
};

/** 稀疏化：按权重优先 + 每卡最多 N 条最强突触（kNN 式），保证每张卡片仍在图上。跨库边始终保留。 */
function sparsify(g, opts = {}) {
  const all = (g?.edges || []).slice().sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const total = all.length;
  // v2.2.1：**上限不能一刀切**。原先 maxEdges 是固定值（标准档 1000），
  // 于是 18331 条突触的库只留 1000 条 —— 边被砍掉 94%，界面却只在小字里
  // 提示"1000/18331"，绝大多数人根本不会注意到，于是以为"文件没显示全"。
  // 现在：上限取"配置值"与"规模所需"两者中更宽的那个 ——
  // 只要边数本来就不多，就全画（���本不稀疏，也就无需稀疏）；
  // 只有边数确实很多时才按配置裁剪。
  const perNode = opts.maxEdgesPerNode ?? 8;
  const maxEdges = Math.max(opts.maxEdges ?? 1400, total);
  const kept = [];
  const deg = new Map();
  for (const e of all) {
    if (e.type === 'cross_kb') { kept.push(e); continue; } // 跨库边数量少，永远显示
    if (kept.length >= maxEdges) break;
    const ds = deg.get(e.src) || 0, dd = deg.get(e.dst) || 0;
    if (ds >= perNode && dd >= perNode) continue;
    kept.push(e);
    deg.set(e.src, ds + 1);
    deg.set(e.dst, dd + 1);
  }
  // 被砍掉多少条、砍的是哪些 —— 都要如实记下来，界面据此说明白。
  const dropped = total - kept.length;
  return {
    ...g,
    edges: kept,
    meta: {
      ...(g.meta || {}),
      shown_edges: kept.length,
      total_edges: total,
      sparsified: dropped > 0,
      dropped_edges: dropped,
    },
  };
}

const TYPE_COLOR = EDGE_COLORS;
const TYPE_LABEL = {
  explicit_link: '显式链接', hierarchical: '层级包含', co_occurrence: '共现',
  semantic_similar: '语义相似', causal: '因果支撑', temporal: '时间邻近', question_answer: '问答沉淀',
  cross_kb: '跨库关联',
};

export function mountGraph({ host, app, api, toast, status, route, openFloat }) {
  host.innerHTML = '';
  const wrap = h('div', { class: 'graph-wrap' });
  const root = h('div', { id: 'cosmosRoot' });
  const hud = h('div', { class: 'graph-hud' });
  const cardBox = h('div', { class: 'graph-card' });
  const tip = h('div', { class: 'graph-tip' }, '拖拽旋转 · 滚轮缩放 · 点击卡片查看与跳转');
  wrap.append(root, hud, cardBox, tip);
  host.appendChild(wrap);

  // v2.2.1：三个悬浮框（左侧 HUD / 右侧卡片面板 / 右下角库铭牌）都变成
  // **可拖动 + 可最小化**的浮动面板。
  // 用户反馈原文：「客户端显示框无法拖动」「这些悬浮框可以最小化」
  // 「右下角不要出现显示重叠」。
  // 之前它们是写死在 CSS 里的 absolute 定位（left:14 / right:14 / bottom），
  // 三个框各占一角还行，可一旦右下角同时出现库铭牌和卡片面板就会挤在一起；
  // 而且用户完全无法把它们挪开 —— 想看被挡住的地方就只能忍着。
  const floaters = [];
  {
    // parent: wrap —— 面板挂在星图视图内部，随视图一起存在/消失，
    // 不会浮到别的视图上面，也不会脱离审计的检查范围。
    const fpHud = makeFloatPanel(hud, { id: 'graph-hud', title: '视图与筛选', anchor: 'left', width: 236, parent: wrap });
    const fpCard = makeFloatPanel(cardBox, { id: 'graph-card', title: '卡片详情', anchor: 'right', width: 280, parent: wrap });
    floaters.push(fpHud, fpCard);
  }

  let cosmos = null;
  let rawGraph = null;      // 当前层级的完整载荷
  let graph = null;         // 当前显示（可能已稀疏化）
  let density = 'standard';
  let activeTypes = new Set(Object.keys(TYPE_COLOR));
  let selected = null;
  // v2.2.3：标签显示模式 —— 'auto'（按距离取舍，默认）| 'all'（全部显示）| 'none'（全隐）
  let labelMode = 'auto';
  let autoRotate = false;
  // v6.35.0：默认使用原创「星位」布局 —— 坐标由 id 确定性派生，知识有固定星位。
  let layoutMode = 'idspace';
  let focusDomain = null;
  let level = 'auto';       // auto | overview | full
  let drill = null;         // { level:'region', domain } | { level:'focus', id, hops }
  // v2.2.0：卸载守卫 —— boot()/loadLevel() 是异步的，await 期间用户可能已切走。
  // 此前 await 之后仍会执行 mount()，凭空造出一个永远不会被销毁的 WebGL 渲染循环
  // （cosmos 只在 unmount() 里被销毁，而那时 cosmos 还是 null）。
  // 反复进出星图会堆积多个泄漏的渲染循环，渲染进程被占满 → 界面"卡住不动"、
  // 其他页面停在"正在载入"。这是"点了没反应 / 画面不协调"的深层病根。
  let disposed = false;

  function view() {
    // 总览层级的边已经是聚合边（≤6000），再做稀疏化会把结构打散 —— 直接全量显示
    if (rawGraph?.levelInfo?.level === 'overview') {
      return { ...rawGraph, meta: { ...(rawGraph.meta || {}), shown_edges: rawGraph.edges.length, total_edges: rawGraph.levelInfo.total_edges, sparsified: false } };
    }
    return sparsify(rawGraph, DENSITY[density]);
  }

  /** 当前层级的人类可读描述 */
  function levelLabel() {
    const li = rawGraph?.levelInfo || {};
    if (li.level === 'region') return `领域 · ${li.domain || ''}`;
    if (li.level === 'focus') return `焦点邻域 · ${li.hops} 跳`;
    if (li.level === 'overview') return '总览（按领域聚合）';
    return '全量';
  }

  /** v6.20：状态栏读数只从真实载荷 + 引擎当前布局模式生成，任何切换后立即同步。
   *  旧实现只在 onReady 与 loadLevel 里各写一次，点「结构视图」后模式标签永远过期。 */
  function syncStatus() {
    if (!rawGraph || !graph) return;
    const m = graph.meta || {};
    const li = rawGraph.levelInfo || {};
    const shownN = li.shown_nodes ?? graph.nodes.length;
    const totalN = li.total_nodes ?? shownN;
    const shownE = m.shown_edges ?? graph.edges.length;
    const totalE = m.total_edges ?? shownE;
    const nodePart = shownN === totalN ? `${shownN} 张卡片` : `${shownN} / ${totalN} 张卡片`;
    const edgePart = shownE === totalE ? `${shownE} 条突触` : `${shownE} / ${totalE} 条突触`;
    const modeLabel = (LAYOUT_MODES.find((x) => x.key === layoutMode) || {}).label || layoutMode;
    status(`星图就绪 · ${nodePart} · ${edgePart} · ${levelLabel()} · ${modeLabel}视图`);
  }

  /** 知识库元信息（名称/配色/规模）——星图中央的名称与 HUD 卡片共用同一份 */
  function vaultInfo() {
    const v = app.vault || {};
    return {
      id: v.id || null,
      name: v.name || '未命名知识库',
      color: v.color || EDGE_COLORS.explicit_link,
      path: v.path || '',
      nodes: v.nodes ?? 0,
      edges: v.edges ?? 0,
      cross_links: v.cross_links ?? 0,
    };
  }

  function mount() {
    if (disposed) return;   // 已卸载：不得再创建渲染场景
    // ================================================================
    //  v2.2.3：**防频闪 —— 先建新场景，再销毁旧场景**。
    //
    //  原写法是「先 dispose 旧的，再 createCosmos 建新的」。
    //  而 cosmos.dispose() 里有 renderer.domElement.remove() ——
    //  画布被**摘掉**了。此刻到新画布挂上之间，容器是**空的**，
    //  屏幕上就是一片黑/白底。用户看到的"频闪"就是这一下下的空窗。
    //
    //  改成：新场景先建好（canvas 已 appendChild），再把旧场景销毁。
    //  两个 canvas 短暂共存，但**任何一帧画面都不为空** ⇒ 不闪。
    //
    //  代价：同时存在 2 个 WebGL 上下文（Chromium 上限约 16，够用），
    //  且销毁顺序要保证旧场景的 DOM 节点被移除后不影响新场景。
    // ================================================================
    const oldCosmos = cosmos;
    cosmos = null;
    graph = view();
    const newCosmos = createCosmos({
      container: root,
      graph,
      vault: vaultInfo(),
      layoutMode,
      // v2.2.3：新场景继承用户当前的标签显示模式，
      // 否则切库/切密度之后标签显示方式被悄悄重置回默认。
      labelMode,
      onSelect: (node) => select(node),
      // v2.1.0：画布上的领域标签可点 —— 与左侧图例同一动作（聚焦该簇）
      onDomainClick: (domain) => {
        focusDomain = focusDomain === domain ? null : domain;
        cosmos?.setDomainFocus(focusDomain);
        renderHud();
        toast(focusDomain ? `聚焦领域「${domain}」` : '已取消领域聚焦', 'ok', 1800);
      },
      // v2.1.0：跨库星系标签可点 —— 直接切到那座卫星星系所属的知识库
      onVaultClick: async (vaultId, vaultName) => {
        if (!vaultId) return;
        const r = await api.vault.switch(vaultId);
        if (r?.ok) {
          await app.refreshVault();
          app.currentId = null; app.history = []; app.hIndex = -1;
          toast(`已切换到「${r.vault?.name || vaultName}」`, 'ok');
        } else toast(r?.error || '切换失败', 'err');
      },
      // v2.1.0：星图中央的库名可点 —— 进「体系」页管理知识库
      onVaultNameClick: () => route('atlas'),
      onReady: () => {
        syncStatus();
        if (focusDomain) cosmos.setDomainFocus(focusDomain);
        if (app.pendingFocus) {
          const id = app.pendingFocus; app.pendingFocus = null;
          const n = graph.nodes.find((x) => x.id === id);
          if (n) { cosmos.focus(id); cosmos.pinLabel?.(id); select(n); }
        }
        // v6.39.0：当前知识库不再单独占一个右下角浮窗 —— 它与「卡片详情」
        // 本来就是一组信息（用户原话："这个是在一起的，不是分拆开的"）。
        // 这里隐藏画布铭牌，改由 renderCard() 把真实库信息内嵌到详情面板顶部。
        if (newCosmos.kbPlateEl) newCosmos.kbPlateEl.style.display = 'none';
        // v6.20.1：mount 时若库元数据已就绪（正常路径 opts.vault 已是真实对象），
        // 这里再保险一次，确保详情面板里的库信息拿到最新统计，不残留空态。
        newCosmos.setVault?.(vaultInfo());
      },
    });
    cosmos = newCosmos;
    // v2.2.3：新场景已建好、画布已挂上 → 现在才销毁旧场景。
    //
    // 为什么不等 onReady（60ms 后）：那 60ms 里两个 WebGL 场景同时跑，
    // 等于双倍渲染开销，大库会明显卡顿。而 createCosmos 返回时新 canvas
    // 已经进了 DOM，容器**此刻就不为空** —— 画面连续，不闪。
    if (oldCosmos) { try { oldCosmos.dispose(); } catch (e) { console.error(e); } }
  }

  // ================================================================
  //  v2.2.2：**库切换后必须重载星图**。
  //
  //  症状（用户实测）：打开另一个知识库后，星图还是上一个库的图 ——
  //  左栏"当前知识库"面板、画布上的节点、右下角库铭牌，全都停留在旧库。
  //
  //  根因：主进程在 refreshVault() 里确实清了图缓存（app.graph = null）并
  //  广播了 app.emit('vault', ...) 事件，**但星图视图从头到尾没有订阅它** ——
  //  视图里的 rawGraph 是它自己 boot() 时抓的快照，没人通知它更新。
  //  于是缓存虽然清了，画布却一直显示旧数据。
  //
  //  修法：订阅 vault 事件，收到就重新 boot()（重新取数 + 重新挂载）。
  //  app.on() 返回取消函数，unmount 时必须解绑 —— 否则视图卸载后事件仍在
  //  触发，会往已销毁的场景里写数据。
  // ================================================================
  // ---------------------------------------------------------------------
  //  v2.2.3：切库时**星图必须及时刷新，且不能频闪**。
  //
  //  背景（用户实测）：
  //    ① 右上角标题栏切换知识库后，星图仍显示上一个库的内容 —— 直到手动
  //       点一次别的按钮才更新；
  //    ② 切库瞬间星图剧烈闪烁（画面反复重建）。
  //
  //  原因：
  //    切库时**同一个 vault 事件会被广播多次**：
  //      · app.refreshVault() 里 app.emit('vault', ...)  ← 显式切换路径
  //      · api.onVaultChanged(...) 里 app.emit('vault', info) ← 主进程
  //        重建索引后的广播（切库会触发 fs watcher → indexVault → 广播）
  //    每一次广播都调 boot()，而 boot() 最后 mount() 会
  //    dispose() 掉整个 WebGL 场景再重新 createCosmos() ——
  //    于是「重建 N 次」＝「闪 N 次」，这就是频闪的来源。
  //
  //  修法（两处，都在视图层，不动其他模块）：
  //    ① 去抖：短时间内的多个 vault 事件合并成一次 boot；
  //    ② 并发守卫：正在取数时再来事件不重复发起，等当前这轮完成后
  //       再补跑一次 —— 保证"最后一次切换"一定生效，且期间只建一次场景。
  // ---------------------------------------------------------------------
  let bootTimer = null;      // 去抖定时器
  let booting = false;       // 正在取数/重建
  let bootAgain = false;     // 期间又来了事件 → 本轮结束后补跑

  function scheduleBoot(delay = 120) {
    if (disposed) return;
    clearTimeout(bootTimer);
    bootTimer = setTimeout(() => { bootTimer = null; boot(); }, delay);
  }

  // 订阅 vault 事件：切库后重新取数并重建场景。
  const offVault = app.on((kind) => {
    if (kind !== 'vault') return;
    if (disposed) return;
    // v2.2.3：去抖 —— 把切库瞬间连发的多个 vault 事件合并成一次重建。
    scheduleBoot(120);
  });

  async function boot() {
    if (disposed) return;
    // v2.2.3：并发守卫 —— 上一轮还在取数时又有事件到达，
    // 不重复发起（避免多个场景同时建、互相打架），只标记"待补跑"。
    if (booting) { bootAgain = true; return; }
    booting = true;
    try {
      await doBoot();
    } finally {
      booting = false;
      // v2.2.3：补跑 —— 保证最后一次切换一定生效。
      if (bootAgain && !disposed) {
        bootAgain = false;
        scheduleBoot(0);
      }
    }
  }

  async function doBoot() {
    status('正在装载星图…');
    // v2.1.0：大库自动走总览层级，渲染层永远只拿几千个对象
    const scale = app.vault?.scale || {};
    level = scale.default_level === 'overview' ? 'overview' : 'full';
    try {
      // v2.2.3：force=true —— 切库后 app.graph 缓存可能与新库同名同key，
      // 但内容其实是**另一个库**的。原来的 `false` 会命中旧缓存，
      // 于是"切了库但星图还是旧内容"。这里强制重新取数。
      rawGraph = await app.graphData(true, level === 'overview' ? { level: 'overview' } : {});
    } catch (e) {
      status('星图加载失败');
      toast('星图加载失败：' + String(e?.message || e), 'err', 6000);
      return;
    }
    if (disposed) return;   // await 期间已切走：不得再挂载
    mount();
    renderHud();
    renderCard(null);
  }

  /** 切换视图层级（总览 / 全量 / 领域下钻 / 焦点邻域） */
  async function loadLevel(next, params = {}) {
    // 护栏：全量视图的载荷与节点数成正比，超过上限一律拦住（大库只能总览 + 下钻）
    const total = app.vault?.nodes || 0;
    if (next === 'full' && total > FULL_LEVEL_LIMIT) {
      toast(`本库 ${total.toLocaleString('en-US')} 张卡片，超出全量视图上限（${FULL_LEVEL_LIMIT.toLocaleString('en-US')}）。请用「总览」按领域下钻，或在左栏搜索定位。`, 'err', 6000);
      return;
    }
    status('正在切换视图层级…');
    const opts = next === 'auto' ? {} : { level: next, ...params };
    try {
      rawGraph = await app.graphData(false, opts);
    } catch (e) {
      toast('切换视图层级失败：' + String(e?.message || e), 'err');
      status('切换失败');
      return;
    }
    if (disposed) return;   // await 期间已切走：不得再挂载
    level = next;
    drill = next === 'region' ? { level: next, domain: params.domain }
      : next === 'focus' ? { level: next, id: params.id, hops: params.hops || 1 }
        : null;
    selected = null;
    focusDomain = null;
    mount();
    renderHud();
    renderCard(null);
    syncStatus();
  }

  // v6.20：renderHud() 每次切换都会重建 DOM，输入框内容原本会被清空。
  // 把查询文本留在闭包里，重建后回放，用户点一下筛选不再丢输入。
  let diffuseQuery = '';
  function renderHud() {
    hud.innerHTML = '';
    const m = graph.meta || {};
    const v = vaultInfo();
    const li = rawGraph?.levelInfo || {};
    // 领域数：总览层级里画布上是聚合球，真实领域数要从知识库元信息取
    const domainCount = Object.keys(app.vault?.domains || {}).length
      || new Set((rawGraph.nodes || []).filter((n) => n.memory_layer !== 'cross').map((n) => n.domain)).size;

    // ── ① 当前知识库卡片（v2.0.0：库名常驻 HUD，同时由渲染层画在星图中央） ──
    const kbDot = h('span', { class: 'kb-dot', style: { background: v.color, boxShadow: `0 0 8px ${v.color}` } });
    hud.appendChild(h('div', { class: 'kb-card' },
      h('div', { class: 'kb-kicker' }, '当前知识库'),
      h('div', { class: 'kb-name' }, kbDot, h('span', null, v.name)),
      h('div', { class: 'kb-path', title: v.path }, v.path || '—'),
      h('div', { class: 'kb-stats' },
        h('span', null, h('b', null, String(v.nodes)), ' 卡片'),
        h('span', null, h('b', null, String(v.edges)), ' 突触'),
        h('span', null, h('b', null, String(domainCount)), ' 领域'),
      ),
    ));

    // v6.39.0：所有知识库总览入口 —— 与卡片详情内的库信息同一套真实数据，
    // 以悬浮工作窗打开，底层星图保持原位，随时关掉回到当前星系。
    hud.appendChild(h('div', { class: 'hud-acts' },
      h('button', {
        class: 'btn',
        title: '查看所有已登记知识库及它们之间的真实关联（共享标题 ×2 + 共享标签）',
        onclick: () => {
          if (openFloat) {
            openFloat('vaultOverview');
            // 浮窗挂在全屏 floatStage，不在当前视图容器内；给一条即时确认，
            // 让"点了确实发生"在界面上可观察，也避免被 UI 审计误判为死点击。
            toast('已打开全库总览：所有知识库与真实关联', 'ok', 1800);
          } else toast('当前入口不可用：缺少悬浮工作窗通道', 'err');
        },
      }, '全库总览'),
    ));

    // ── ② 视图层级（v2.1.0：百万级卡片的关键） ──
    hud.appendChild(h('div', { class: 'hud-title' }, '视图层级'));
    hud.appendChild(h('div', { class: 'view-modes' },
      ...LEVELS.map((L) => {
        const tooBig = L.key === 'full' && (app.vault?.nodes || 0) > FULL_LEVEL_LIMIT;
        // v6.20：选中态以引擎返回的真实层级为准，不再用闭包 level 猜测。
        // 下钻（region / focus）归属总览分支，不再出现「两个按钮都不亮」。
        const actual = rawGraph?.levelInfo?.level || level;
        const activeKey = (actual === 'overview' || actual === 'region' || actual === 'focus') ? 'overview' : 'full';
        return h('button', {
          class: 'vm-btn lv-btn' + (activeKey === L.key ? ' is-on' : ''),
          'aria-pressed': activeKey === L.key ? 'true' : 'false',
          title: tooBig ? `本库卡片数超过 ${FULL_LEVEL_LIMIT.toLocaleString('en-US')}，全量视图已关闭，请用总览下钻` : L.hint,
          onclick: () => { if (activeKey !== L.key) loadLevel(L.key); },
        }, L.label);
      }),
    ));
    const scaleTag = app.vault?.scale?.label;
    hud.appendChild(h('div', { class: 'level-note' },
      h('span', null, `当前：${levelLabel()}`),
      scaleTag ? h('b', null, scaleTag) : null,
      li.shown_nodes != null ? h('i', null, `显示 ${li.shown_nodes} / ${li.total_nodes}`) : null,
    ));
    if (li.note) hud.appendChild(h('div', { class: 'level-hint' }, li.note));
    // v2.2.1：**把"被藏起来的"明确说出来**，并给一个直接看到全部的入口。
    // 原先只在标题栏的小字里写"1000/18331"，位置不显眼、也没有下一步动作，
    // 用户看到"少了一大片"却不知道去哪找 —— 于是误以为"文件没显示全"。
    // 现在：明确写出"还有 N 条突触未显示"，并给一个一键切到完整密度的按钮。
    {
      const m = graph?.meta || {};
      const dropped = Number(m.dropped_edges || 0);
      if (dropped > 0) {
        hud.appendChild(h('div', { class: 'level-hint is-warn' },
          `为保持画面清晰，${dropped.toLocaleString('en-US')} 条较弱突触未画出（卡片本身都在）。`));
        hud.appendChild(h('div', { class: 'hud-acts' },
          h('button', {
            class: 'btn ghost',
            title: '把所有突触都画出来（节点可能较密）',
            onclick: () => { density = 'full'; mount(); renderHud(); syncStatus(); toast('已切换到完整密度：全部突触均已画出', 'ok', 2600); },
          }, '显示全部突触'),
        ));
      }
    }
    if (drill) {
      hud.appendChild(h('div', { class: 'hud-acts' },
        h('button', { class: 'btn ghost', onclick: () => loadLevel('overview') }, '返回总览'),
        drill.level === 'region' ? h('button', { class: 'btn ghost', onclick: () => loadLevel('full') }, '看全量') : null,
      ));
    }

    // ── ③ 结构视图切换 ──
    hud.appendChild(h('div', { class: 'hud-title' }, '结构视图'));
    hud.appendChild(h('div', { class: 'view-modes view-modes--layout' },
      ...LAYOUT_MODES.map((mm) => h('button', {
        class: 'vm-btn' + (layoutMode === mm.key ? ' is-on' : ''),
        'aria-pressed': layoutMode === mm.key ? 'true' : 'false',
        title: LAYOUT_HINT[mm.key] || '',
        onclick: () => {
          if (layoutMode === mm.key) return;
          // v6.20：先确认引擎侧真的切换成功，再改渲染层状态；非法 key 不再静默漂移。
          const ok = cosmos?.setLayoutMode(mm.key);
          if (ok === false) { toast(`结构视图「${mm.label}」未能切换`, 'err'); return; }
          layoutMode = mm.key;
          syncStatus();
          renderHud();
          toast(`星图视图：${mm.label}`, 'ok', 1800);
        },
      }, mm.label)),
    ));

    // ── ④ 领域图例（点击聚焦某一簇结构） ──
    // v2.1.0：总览层级里一个球 = 一个领域，member_count 才是该领域的真实卡片数
    const domainCounts = new Map();
    for (const n of rawGraph.nodes || []) {
      if (n.memory_layer === 'cross') continue;
      const c = n.member_count ?? 1;
      domainCounts.set(n.domain, (domainCounts.get(n.domain) || 0) + c);
    }
    const palette = domainColorOf((rawGraph.nodes || []).map((n) => n.domain));
    if (domainCounts.size) {
      hud.appendChild(h('div', { class: 'hud-title' },
        '领域结构',
        focusDomain ? h('a', {
          class: 'hud-clear', onclick: () => { focusDomain = null; cosmos?.setDomainFocus(null); renderHud(); },
        }, '清除聚焦') : null,
      ));
      const dl = h('div', { class: 'domain-list' });
      for (const [d, cnt] of [...domainCounts.entries()].sort((a, b) => b[1] - a[1])) {
        const col = '#' + (palette.get(d) || 0x7B5CFF).toString(16).padStart(6, '0');
        dl.appendChild(h('div', {
          class: 'hud-row domain-row' + (focusDomain === d ? ' is-focus' : '') + (focusDomain && focusDomain !== d ? ' is-off' : ''),
          onclick: () => {
            focusDomain = focusDomain === d ? null : d;
            cosmos?.setDomainFocus(focusDomain);
            renderHud();
            if (focusDomain) toast(`聚焦领域「${focusDomain}」· ${cnt} 张卡片`, 'ok', 1800);
          },
        },
          h('span', { class: 'sw', style: { background: col, boxShadow: `0 0 8px ${col}` } }),
          h('span', null, d),
          h('span', { class: 'cnt' }, String(cnt)),
        ));
      }
      hud.appendChild(dl);
    }

    // ── ④ 突触类型筛选 ──
    hud.appendChild(h('div', { class: 'hud-title' },
      `突触类型（点击筛选）${m.sparsified ? ` · 显示 ${graph.edges.length}/${m.total_edges}` : ''}`));
    const counts = new Map();
    for (const e of rawGraph.edges || []) counts.set(e.type, (counts.get(e.type) || 0) + 1);
    for (const [type, color] of Object.entries(TYPE_COLOR)) {
      const c = counts.get(type) || 0;
      if (!c) continue; // 没有这种边就不占地方
      const on = activeTypes.has(type);
      const row = h('div', { class: 'hud-row' + (on ? '' : ' is-off'), onclick: () => {
        on ? activeTypes.delete(type) : activeTypes.add(type);
        cosmos?.setTypeFilter(activeTypes.size === Object.keys(TYPE_COLOR).length ? null : activeTypes);
        renderHud();
      } },
        h('span', { class: 'sw', style: { background: color, boxShadow: `0 0 8px ${color}` } }),
        h('span', null, TYPE_LABEL[type] || type),
        h('span', { class: 'cnt' }, String(c)),
      );
      hud.appendChild(row);
    }

    // ── ⑤ 激活扩散 ──
    const q = h('input', { placeholder: '在星图上扩散一个问题…', 'aria-label': '激活扩散查询',
      oninput: (ev) => { diffuseQuery = ev.target.value; },
      onkeydown: (ev) => { if (ev.key === 'Enter') diffuse(ev.target.value); } });
    q.value = diffuseQuery;
    Object.assign(q.style, {
      width: '100%', marginTop: '8px', background: 'rgba(4,6,14,.6)', border: '1px solid var(--line)',
      borderRadius: '7px', color: 'var(--text)', padding: '5px 8px', fontSize: '11.5px', outline: 'none',
    });
    hud.appendChild(h('div', { style: { fontSize: '10px', color: 'var(--dim)', margin: '10px 0 4px' } }, '激活扩散（点亮联想路径）'));
    hud.appendChild(q);
    const diffBtn = h('button', { class: 'btn ghost', style: { width: '100%', marginTop: '6px' }, onclick: () => diffuse(q.value) }, '扩散');
    hud.appendChild(diffBtn);

    // ── ⑥ 显示密度 ──
    hud.appendChild(h('div', { style: { fontSize: '10px', color: 'var(--dim)', margin: '10px 0 4px' } }, '显示密度'));
    hud.appendChild(h('div', { class: 'hud-acts' },
      ...Object.entries(DENSITY).map(([k, d]) => h('button', {
        class: 'btn' + (density === k ? '' : ' ghost'),
        onclick: () => { density = k; mount(); renderHud(); syncStatus(); },
      }, d.label)),
    ));

    hud.appendChild(h('div', { class: 'hud-acts' },
      // v2.2.3：标签按钮改为**三态循环**（自动 → 全部显示 → 全部隐藏）。
      //
      // 为什么不是原来的开/关两态：原来"开"其实**有上限** ——
      // 引擎按视口面积算预算（最多 220 个），692 张卡片的库
      // 永远不可能同时显示所有名字。用户看到"我明明开了显示标签，
      // 却还是一堆卡片没名字"，于是要求"能显示或者隐藏**所有**的标签"。
      // 现在三档各司其职：
      //   自动 —— 按相机距离取舍（近的先有名），画面始终干净（默认）
      //   全部 —— 每一个卡片都显示名字，不设上限（会挤，用户自选）
      //   隐藏 —— 全部不显示，只留当前选中卡片的名字
      h('button', {
        class: 'btn' + (labelMode === 'all' ? '' : ' ghost'),
        title: labelMode === 'all'
          ? '当前：全部显示。点击切换为自动（按距离只显示近处的名字）'
          : (labelMode === 'none'
            ? '当前：全部隐藏。点击切换为全部显示'
            : '当前：自动（按距离取舍）。点击切换为全部显示'),
        onclick: () => {
          labelMode = labelMode === 'auto' ? 'all' : (labelMode === 'all' ? 'none' : 'auto');
          cosmos?.setLabels(labelMode);
          renderHud();
        },
      }, labelMode === 'auto' ? '标签·自动' : (labelMode === 'all' ? '标签·全部' : '标签·隐藏')),
      h('button', {
        class: 'btn ghost',
        title: autoRotate ? '停止星图自动旋转' : '让星图自动旋转',
        onclick: () => { autoRotate = !autoRotate; cosmos?.setAutoRotate(autoRotate); renderHud(); },
      }, autoRotate ? '停止自转' : '自转'),
      h('button', { class: 'btn ghost', onclick: () => { cosmos?.frameAll(); select(null); } }, '复位'),
    ));
  }

  async function diffuse(query) {
    const q = String(query || '').trim();
    if (!q) {
      toast('先输入一个要扩散的问题', 'err', 3200);
      // v6.20：旧写法对「字符串 q」调 focus()，必然抛 TypeError 被吞掉，
      // 聚焦意图从未生效。改为定位真实的输入节点。
      try { hud.querySelector('input[aria-label="激活扩散查询"]')?.focus(); } catch { /* ignore */ }
      return;
    }
    const res = await api.search({ query: q, top_k: 20, hops: 2 });
    const hits = (res?.ok && res?.data?.results) ? res.data.results : [];
    if (!hits.length) { toast('没有沿突触联想到任何卡片', 'err'); return; }
    const max = Math.max(...hits.map((x) => x.score || 0)) || 1;
    const act = new Map(hits.map((x) => [x.id, Math.max(0.15, (x.score || 0) / max)]));
    cosmos?.setActivation(act);
    const keys = new Set();
    for (const hit of hits) {
      const p = hit.activation_path || [];
      for (let i = 0; i + 1 < p.length; i++) { keys.add(`${p[i]}->${p[i + 1]}`); keys.add(`${p[i + 1]}->${p[i]}`); }
    }
    cosmos?.setPathEdges(keys);
    const top = hits[0];
    let n = graph.nodes.find((x) => x.id === top.id);
    if (!n && level !== 'full') {
      // 扩散命中的是具体卡片，但当前在总览层级（画布上只有聚合球）→ 自动下钻
      const total = app.vault?.nodes || 0;
      if (total > FULL_LEVEL_LIMIT) {
        // 大库不能开全量：改用「焦点邻域」，只看命中卡片周围的关系
        toast(`命中卡片不在当前层级，正在切到焦点邻域…`, 'ok', 2000);
        await loadLevel('focus', { id: top.id, hops: 2 });
        cosmos?.setActivation(act);
        cosmos?.setPathEdges(keys);
        n = graph.nodes.find((x) => x.id === top.id);
      } else {
        toast(`命中卡片不在当前层级，正在切到全量视图…`, 'ok', 2000);
        await loadLevel('full');
        cosmos?.setActivation(act);
        cosmos?.setPathEdges(keys);
        n = graph.nodes.find((x) => x.id === top.id);
      }
    }
    if (n) select(n);
    status(`扩散命中 ${hits.length} 张卡片 · 首位「${top.title}」`);
    renderDiffusion(hits, q);
  }

  function renderDiffusion(hits, query) {
    cardBox.innerHTML = '';
    cardBox.appendChild(h('div', { class: 'gc-title' }, '激活扩散结果'));
    cardBox.appendChild(h('div', { class: 'gc-path' }, `查询：${query}`));
    for (const hit of hits.slice(0, 12)) {
      const row = h('div', { class: 'gc-rel' },
        h('div', { class: 'rl', onclick: () => { app.openCard(hit.id); route('workspace'); } },
          h('span', { style: { color: 'var(--cyan)' } }, '◆'),
          h('span', { style: { flex: '1' } }, hit.title || '未命名'),
          h('span', { style: { color: 'var(--dim)' } }, hit.confidence == null ? '—' : `${Math.round(hit.confidence * 100)}%`)),
        hit.path_explained ? h('div', { style: { fontSize: '10.5px', color: 'var(--dim)', paddingLeft: '14px', lineHeight: '1.6' } },
          String(hit.path_explained).replace(/\*\*/g, '')) : null,
      );
      cardBox.appendChild(row);
    }
  }

  async function select(node) {
    if (!node) { selected = null; renderCard(null); return; }
    selected = node;
    cosmos?.pinLabel?.(node.id);
    renderCard(node);
    if (node.memory_layer === 'cross') return; // 幽灵节点没有本地关系
    if (node.aggregate) return;                // 聚合球是领域，不是卡片
    const r = await api.doc.relations(node.id, { contextLimit: 0 });
    if (r?.ok && selected === node) renderCard(node, r.data);
  }

  /** "卡片详情 + 当前知识库"是一组信息：库铭牌内嵌在详情面板顶部，不再单独浮一层。 */
  function kbBlock() {
    const v = vaultInfo();
    const el = h('div', { class: 'cosmos-kb gc-kb' },
      h('div', { class: 'kb-kicker' }, '当前知识库'),
      h('div', {
        class: 'kb-name', title: v.path || v.name,
        onclick: () => route('atlas'),
      }, v.name),
      h('div', { class: 'kb-meta' },
        `${v.nodes} 卡片 · ${v.edges} 突触 · ${v.cross_links} 跨库`));
    el.style.setProperty('--kc', v.color || SEM.crossKb);
    return el;
  }

  function renderCard(node, rel) {
    cardBox.innerHTML = '';
    cardBox.appendChild(kbBlock());
    if (!node) {
      cardBox.appendChild(h('div', { style: { fontSize: '12px', color: 'var(--dim)', lineHeight: '1.8' } },
        '点击任意卡片查看详情并跳转文档。左侧可按突触类型筛选 —— 例如只看「语义相似」，就能看清哪些卡片在结构上相近但并不相邻。外圈淡青色节点是其他知识库的卡片（跨库关联）。'));
      cardBox.appendChild(h('div', { style: { fontSize: '11px', color: 'var(--muted)', marginTop: '12px', lineHeight: '1.8' } },
        '提示：上方「当前知识库」可直接点进「体系」页管理；「多库星系」结构视图会把其他知识库显示为卫星星系，并标注其库名。'));
      return;
    }
    if (node.aggregate) {
      // v2.1.0：总览层级的领域聚合球 —— 可一键下钻到该领域的完整子图
      cardBox.appendChild(h('div', { class: 'gc-title' }, node.title));
      cardBox.appendChild(h('div', { class: 'gc-path' }, `领域聚合球 · ${node.member_count} 张卡片`));
      cardBox.appendChild(h('div', { style: { fontSize: '11.5px', color: 'var(--dim)', lineHeight: '1.75' } },
        '总览视图里每一个球是一个领域。下钻后可以看到该领域里每一张卡片，以及它们之间的突触。'));
      cardBox.appendChild(h('div', { class: 'gc-acts' },
        h('button', { class: 'btn', onclick: () => loadLevel('region', { domain: node.domain }) }, '下钻到该领域'),
        h('button', { class: 'btn ghost', onclick: () => loadLevel('full') }, '看全量'),
      ));
      return;
    }
    if (node.memory_layer === 'cross') {
      cardBox.appendChild(h('div', { class: 'gc-title' }, node.title || '未命名'));
      cardBox.appendChild(h('div', { class: 'gc-path' }, node.path || ''));
      if (node.cross) {
        cardBox.appendChild(h('div', { class: 'gc-kb', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', color: 'var(--muted)', border: '1px solid ' + (node.cross.vault_color || SEM.crossKb), borderRadius: '999px', padding: '2px 9px', marginBottom: '8px' } },
          h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: node.cross.vault_color || SEM.crossKb, display: 'inline-block' } }),
          node.cross.vault_name || '其他知识库'));
      }
      cardBox.appendChild(h('div', { style: { fontSize: '11px', color: 'var(--dim)', lineHeight: '1.7' } },
        '这是另一个知识库里的卡片，通过跨库突触连到当前网络。'));
      cardBox.appendChild(h('div', { class: 'gc-acts' },
        h('button', { class: 'btn', onclick: async () => {
          const r = await api.crosskb.open({ vaultId: node.cross?.vault_id, path: node.path });
          if (r?.ok) {
            await app.refreshVault();
            app.history = []; app.hIndex = -1;
            app.currentId = null;
            if (r.openId) await app.openCard(r.openId);
            route('workspace');
            toast(`已切换到「${r.vault.name}」`, 'ok');
          } else toast(r?.error || '跳转失败', 'err');
        } }, '切库打开'),
      ));
      return;
    }
    cardBox.appendChild(h('div', { class: 'gc-title' }, node.title || '未命名'));
    cardBox.appendChild(h('div', { class: 'gc-path' }, node.path || ''));
    if (node.domain || (node.tags && node.tags.length)) {
      cardBox.appendChild(h('div', { style: { fontSize: '10.5px', color: 'var(--muted)', marginBottom: '6px' } },
        [node.domain, ...(node.tags || []).map((t) => `#${t}`)].filter(Boolean).join(' · ')));
    }
    if (node.text) cardBox.appendChild(h('div', { class: 'gc-text' }, node.text.slice(0, 400)));
    cardBox.appendChild(h('div', { class: 'gc-acts' },
      h('button', { class: 'btn', onclick: () => { app.openCard(node.id); route('workspace'); } }, '打开文档'),
      h('button', { class: 'btn ghost', onclick: () => cosmos?.focus(node.id) }, '聚焦'),
    ));

    if (rel) {
      cardBox.appendChild(h('div', { style: { marginTop: '10px', fontSize: '10.5px', color: 'var(--dim)' } },
        `${rel.degree} 条突触 · 总强度 ${rel.strength}`));
      const box = h('div', { class: 'gc-rel' });
      const items = Object.values(rel.groups || {}).flat().sort((a, b) => b.weight - a.weight).slice(0, 10);
      for (const it of items) {
        box.appendChild(h('div', { class: 'rl', onclick: () => { app.openCard(it.id); route('workspace'); } },
          h('span', { style: { color: TYPE_COLOR[it.type] || 'var(--violet)' } }, '●'),
          h('span', { style: { flex: '1' } }, it.title),
          h('span', { style: { color: 'var(--dim)' } }, String(it.weight)),
        ));
      }
      cardBox.appendChild(box);
    }
  }

  boot();
  return {
    unmount() {
      disposed = true;
      // v2.2.2：解绑 vault 订阅 —— 否则视图卸载后事件仍会触发 boot()，
      // 往已销毁的场景里写数据（渲染进程泄漏）。
      try { offVault(); } catch (e) { /* ignore */ }
      try { cosmos?.dispose(); } catch (e) { console.error(e); }
      cosmos = null;
      // v2.2.1：拆掉浮动面板 —— 否则它会留在 body 里，成为"关掉页面后还在"的孤儿节点，
      // 而且下次进星图会多出一堆重复的面板。
      for (const f of floaters) { try { f.destroy(); } catch (e) { /* ignore */ } }
      floaters.length = 0;
    },
  };
}
