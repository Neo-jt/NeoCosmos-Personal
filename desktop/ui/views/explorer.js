// 左栏 · 星图导航台
// 卡片网络的目录面：按记忆层 / 目录 / 标签三种切法浏览同一批卡片。
// 它不是"文件管理器"，是"卡片索引"——每张卡片后附突触度数（连了多少关系）。
// v1.1.0：新建卡片走模态弹窗（Electron 无 window.prompt）；图标统一 SVG。
import { h, toast, status, icon } from '../ui-kit.js';
import { cardTools } from '../card-tools.js';
import { pinyinMatch } from '../pinyin-initial.js';
// v6.27.0：库色回退走共享令牌；用户设定的 v.color 仍是真实数据，永远优先。
import { SEM } from '../semantic-palette.js';

const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  graph: '<circle cx="12" cy="12" r="2.4"/><path d="M12 12 L17.4 7.2M12 12 L5.6 8.4M12 12 L15.4 18"/>',
  derive: '<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z"/>',
  collapse: '<path d="M14 5l-7 7 7 7"/>',
};
const iconBtn = (name, title, onClick) => h('button', {
  class: 'icon-btn', title, onclick: onClick, 'aria-label': title,
  html: `<svg viewBox="0 0 24 24">${ICON[name]}</svg>`,
});

const LAYER_LABEL = { semantic: '语义记忆', episodic: '情景记忆', working: '工作记忆' };
const LAYER_ORDER = ['semantic', 'episodic', 'working'];

export function mountExplorer({ host, app, api, toast, status, route }) {
  host.innerHTML = '';
  let tree = null;
  let files = [];
  let treeMeta = { total: 0, shown: 0, truncated: false };
  let filter = '';
  let activeTag = null;
  let collapsed = new Set();
  // v2.2.1：'local' = 只看当前库（原有行为）；'all' = 所有已登记库合并成一棵树。
  // 用户诉求：「显示当前的所有的库，就作为一个库的目录就可以」。
  // v6.37.0：新增 'enabled' = 只看"已启用"的知识库，与设置页「启用的知识库」
  // 共用同一口径（vault.linkEnabled !== false），三态共用 allTree 一份数据源。
  let scope = 'local';
  let allTree = null;        // 跨库树数据
  let allTreeLoading = false;

  // v2.1.0：DOM 节点数保护。百万级卡片不可能一次性铺进 DOM，
  // 一次最多渲染 RENDER_CAP 行，其余用过滤框精确查找。
  // v2.2.1：上限从 800 提到 1500 —— 692 张卡片的库，三个切法（记忆层/目录/标签）
  // 各列一遍，800 行不够分，一分组就被截断，看着像"文件少了"。
  // 1500 行 DOM 在现代浏览器上是毫秒级开销，而 20000 张的库仍受得住。
  const RENDER_CAP = 1500;

  // v6.1.3：搜索输入防抖 —— 连续键入不再每次重排整棵目录树，
  // 仅在停顿 120ms 后渲染一次；数千卡片的大库下输入也不再卡顿。
  let _renderTimer = 0;
  function debouncedRender() { clearTimeout(_renderTimer); _renderTimer = setTimeout(render, 120); }

  const scroll = h('div', { class: 'nav-scroll' });
  const search = h('input', { placeholder: '过滤卡片（支持拼音首字母，如 bj→北京）…', 'aria-label': '过滤卡片', oninput: (e) => { filter = e.target.value.trim().toLowerCase(); debouncedRender(); } });

  /**
   * v2.2.1：过滤条 —— 过滤态的**唯一出口**。
   *
   * 用户反馈（截图）：在左栏点了一个目录项后，整个面板变成"没有匹配的卡片"，
   * 而且**再也回不去**了 —— 那个被点的目录行随列表一起消失，
   * 用户连"再点一次取消"都做不到，成了死局。
   *
   * 病根是大小写：
   *   · 搜索框 oninput 走 `value.trim().toLowerCase()` → filter 是小写；
   *   · 目录行点击走 `filter = d`（**原样**，含大写）；
   *   · 而 visibleFiles 拿 `f.path.toLowerCase().includes(filter)` 比较 ——
   *     filter 带大写时**永远匹配不上**，列表被清空。
   * 本库里到处是 `00-NEOLINK-总控`、`01-KB-上市公司并购重组` 这类含大写的目录名，
   * 所以"点目录 → 清空"是必然发生的，不是偶发。
   *
   * 处置（两道）：
   *   ① 比较统一在**同一侧**做大小写归一（filterKey 永远是小写），根除误判；
   *   ② 过滤态做成**始终可见**的过滤条，带 ✕ 一键清除 ——
   *      哪怕将来还有别的路径把列表清空，用户也不会失去出口。
   */
  const filterBar = h('div', { class: 'nav-filterbar' });

  /** 过滤比较键：永远小写，杜绝"写入原样、比较小写"这类不对称。 */
  function filterKey(s) { return String(s || '').trim().toLowerCase(); }

  /**
   * v10.18.7 修：跨库检索（启用库 / 全部库）此前完全忽略搜索框的 filter ——
   * render() 在 scope=all/enabled 时直接 renderAllScope() 返回，从不应用过滤，
   * 于是用户在跨库视图里输入关键字"没有任何反应"，以为检索坏了。
   * 这里把本库 visibleFiles() 的判定抽成共用函数，三态检索行为一致：
   *   文本子串（大小写归一）+ 路径 + 拼音首字母 + 标签。
   */
  function matchCard(f, key) {
    if (activeTag && !(f.tags || []).includes(activeTag)) return false;
    if (!key) return true;
    return String(f.title || '').toLowerCase().includes(key) ||
      (f.path || '').toLowerCase().includes(key) ||
      pinyinMatch(key, f.title) ||
      pinyinMatch(key, f.path || '');
  }

  /** 递归过滤某库的目录树：命中文件留下的文件与目录，空目录整枝剔除。 */
  function filterTree(dirs, files, key) {
    const outFiles = (files || []).filter((f) => matchCard(f, key));
    const outDirs = [];
    for (const d of dirs || []) {
      const sub = filterTree(d.dirs || [], d.files || [], key);
      if (sub.files.length || sub.dirs.length) outDirs.push({ ...d, dirs: sub.dirs, files: sub.files });
    }
    return { dirs: outDirs, files: outFiles };
  }

  /** 当前过滤条件（规范化后的），无则返回 null。 */
  function activeFilter() {
    if (filter) return { kind: 'text', text: filter, label: filter };
    if (activeTag) return { kind: 'tag', text: activeTag, label: `#${activeTag}` };
    return null;
  }

  /** 清除全部过滤态（文本 + 标签）。 */
  function clearFilters() {
    filter = '';
    activeTag = null;
    search.value = '';
    render();
  }

  const head = h('div', { class: 'nav-head' },
    h('div', { class: 'nav-title' }, h('b', null, '卡片网络'),
      h('div', { class: 'nav-actions' },
        iconBtn('plus', '新建卡片 (Ctrl+N)', () => app.newCard()),
        iconBtn('refresh', '重建索引（重新解析双链）', onRebuild),
        iconBtn('derive', '推导突触（让没有双链的库长出关系）', onDerive),
        iconBtn('graph', '在星图中查看', () => route('graph')),
        h('button', {
          class: 'icon-btn mini-hide', title: '最小化左栏 (Ctrl+B)', 'aria-label': '最小化左栏',
          html: '<svg viewBox="0 0 24 24"><path d="M14 5l-7 7 7 7"/></svg>',
          onclick: () => app.togglePane?.('left'),
        }),
      )),
    h('div', { class: 'nav-search' }, search),
    // v2.2.1：范围切换 —— 本库 / 全部库。
    // 放在搜索框下方，因为它决定的是"下面这棵树装的是谁"。
    h('div', { class: 'nav-scope', role: 'tablist', 'aria-label': '卡片范围' },
      h('button', {
        id: 'navScopeLocal',
        class: 'nav-scope-btn' + (scope === 'local' ? ' is-on' : ''),
        role: 'tab', 'aria-selected': scope === 'local',
        title: '只看当前打开的知识库',
        onclick: () => setScope('local'),
      }, '本库'),
      h('button', {
        id: 'navScopeEnabled',
        class: 'nav-scope-btn' + (scope === 'enabled' ? ' is-on' : ''),
        role: 'tab', 'aria-selected': scope === 'enabled',
        title: '只看已启用的知识库（与设置页「启用的知识库」口径一致）',
        onclick: () => setScope('enabled'),
      }, '启用的库'),
      h('button', {
        id: 'navScopeAll',
        class: 'nav-scope-btn' + (scope === 'all' ? ' is-on' : ''),
        role: 'tab', 'aria-selected': scope === 'all',
        title: '显示所有已登记的知识库（含已停用），合并成一棵目录树',
        onclick: () => setScope('all'),
      }, '全部库'),
      h('span', { class: 'nav-scope-count', id: 'navScopeCount' },
        (scope === 'all' || scope === 'enabled') ? (allTree ? `${allTree.total} 张` : '…') : ''),
    ),
    // v2.2.1：全部库模式下的**库快捷跳转**。
    // 全部库模式是"一个库看全部"，但库多了以后，
    // 第二个库会被第一个库的几十行挤到很下面 —— 滚动找库很费劲。
    // 这里给一行胶囊，直接跳到某个库（并折叠其它库）。
    h('div', { class: 'nav-vault-jump', id: 'navVaultJump' }),
  );
  host.append(head, filterBar, scroll);

  function flatten(node, out = []) {
    for (const f of node.files || []) out.push(f);
    for (const d of node.dirs || []) flatten(d, out);
    return out;
  }

  async function load() {
    // v2.2.1：全部库模式下，切库/重建索引后要**重扫**跨库树 ——
    // 树的"当前库"标记、"当前"徽章都依赖当前库是谁。
    if (scope === 'all' || scope === 'enabled') { await loadAllTree(true); return; }
    const res = await api.doc.tree();
    if (!res?.ok) { scroll.innerHTML = ''; scroll.appendChild(h('div', { class: 'nav-empty' }, '无法读取卡片树')); return; }
    tree = res.data;
    treeMeta = { total: tree.total ?? 0, shown: tree.shown ?? 0, truncated: !!tree.truncated };
    files = flatten(tree);
    render();
  }

  /** 读取跨库目录树（所有已登记库）。 */
  async function loadAllTree(force = false) {
    if (allTreeLoading) return;
    if (allTree && !force) { renderAllScope(); return; }
    allTreeLoading = true;
    scroll.innerHTML = '';
    scroll.appendChild(h('div', { class: 'nav-empty' }, '正在扫描所有知识库…'));
    try {
      const res = await api.doc.allTree({});
      allTree = res?.ok ? res.data : null;
      if (!allTree) {
        scroll.innerHTML = '';
        scroll.appendChild(h('div', { class: 'nav-empty' }, res?.error || '无法读取跨库目录树'));
      }
    } catch (e) {
      allTree = null;
      scroll.innerHTML = '';
      scroll.appendChild(h('div', { class: 'nav-empty' }, '读取跨库目录树失败：' + String(e?.message || e)));
    } finally {
      allTreeLoading = false;
      render();
    }
  }

  /**
   * 同步范围切换按钮的高亮态。
   *
   * v2.2.1 修：原先 setScope 只改了 scope 变量，**没有重渲染按钮** ——
   * 于是切到「全部库」后，树里已经是全部库的内容，标题栏上却仍高亮着「本库」。
   * 内容与指示器不一致，用户会以为按钮没生效。
   * （截图验收时发现的：树已是跨库视图，「本库」却还是选中的样子。）
   */
  function syncScopeButtons() {
    const bLocal = document.getElementById('navScopeLocal');
    const bEnabled = document.getElementById('navScopeEnabled');
    const bAll = document.getElementById('navScopeAll');
    if (bLocal) {
      bLocal.classList.toggle('is-on', scope === 'local');
      bLocal.setAttribute('aria-selected', scope === 'local' ? 'true' : 'false');
    }
    if (bEnabled) {
      bEnabled.classList.toggle('is-on', scope === 'enabled');
      bEnabled.setAttribute('aria-selected', scope === 'enabled' ? 'true' : 'false');
    }
    if (bAll) {
      bAll.classList.toggle('is-on', scope === 'all');
      bAll.setAttribute('aria-selected', scope === 'all' ? 'true' : 'false');
    }
  }

  /** 切换范围。 */
  function setScope(next) {
    if (scope === next) return;
    scope = next;
    syncScopeButtons();
    // 切范围时清掉过滤 —— 过滤是针对某一棵树的概念，
    // 带着"本库"的目录过滤去看"全部库"会让人困惑。
    filter = '';
    activeTag = null;
    search.value = '';
    collapsed.clear();
    render();
    if (scope === 'all' || scope === 'enabled') loadAllTree();
    else load();
  }

  function visibleFiles() {
    // v10.18.7：与跨库检索共用 matchCard —— 一处判定，三态（本库/启用库/全部库）一致。
    // 比较键在 matchCard 内统一小写归一，杜绝"写入原样、比较小写"的不对称。
    // 拼音首字母（bj→北京）与原文子串都覆盖，互不打架。
    const key = filterKey(filter);
    if (!activeTag && !key) return files;
    return files.filter((f) => matchCard(f, key));
  }

  function fileRow(f) {
    const starred = cardTools.isStarred(f.id);
    const row = h('div', { class: 'tree-file' + (app.currentId === f.id ? ' is-active' : ''), title: f.path, tabindex: '0' },
      h('span', { class: `lyr lyr-${f.layer || 'semantic'}` }),
      h('span', { class: 'fname' }, f.title),
      h('span', { class: 'deg', title: '突触度数' }, String(f.degree || 0)),
      // v6.38.0：原创增强——行内星标，点它只切收藏、不打开卡片。
      h('button', {
        class: 'tree-star' + (starred ? ' is-on' : ''),
        title: starred ? '取消收藏' : '收藏这张卡片',
        'aria-label': starred ? '取消收藏' : '收藏',
        onclick: (e) => {
          e.stopPropagation();
          const on = cardTools.toggleStar(f.id);
          e.currentTarget.classList.toggle('is-on', on);
          e.currentTarget.textContent = on ? '★' : '☆';
          e.currentTarget.title = on ? '取消收藏' : '收藏这张卡片';
          toast(on ? '已加入收藏夹' : '已取消收藏', 'ok');
        },
      }, starred ? '★' : '☆'),
    );
    row.dataset.id = f.id;
    row.addEventListener('click', () => app.openCard(f.id));
    row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') app.openCard(f.id); });
    return row;
  }

  function group(title, count, body, key) {
    const isCollapsed = collapsed.has(key);
    const g = h('div', { class: 'nav-group' + (isCollapsed ? ' is-collapsed' : '') },
      h('div', { class: 'g-head', onclick: () => { isCollapsed ? collapsed.delete(key) : collapsed.add(key); render(); } },
        h('span', { class: 'caret' }), h('span', null, title), h('span', { class: 'cnt' }, String(count))),
      h('div', { class: 'g-body' }, body),
    );
    return g;
  }

  /** 渲染过滤条：有过滤态就显示，并给出「清除」出口。 */
  function renderFilterBar() {
    filterBar.innerHTML = '';
    const af = activeFilter();
    if (!af) return;
    filterBar.appendChild(h('div', { class: 'nav-filterbar-inner' },
      h('span', { class: 'nav-filterbar-label' },
        af.kind === 'tag' ? '标签过滤' : '目录过滤',
        h('b', null, af.label)),
      h('button', {
        class: 'nav-filterbar-clear',
        title: '清除过滤，回到全部卡片',
        onclick: (e) => { e.stopPropagation(); clearFilters(); },
      }, '✕ 清除'),
    ));
  }

  /**
   * v2.2.1：全部库模式的目录树渲染。
   *
   * 结构：每个已登记库是**顶层节点**（库名 + 卡片数），
   * 展开后是它自己的目录结构 —— 相当于把多个库当成"一个库"来看。
   *
   * 关键：**每个文件节点都带 vaultId**。卡片 id 是按相对路径派生的，
   * 两个库里的同名同路径文件会得到同一个 id —— 只用 id 定位必然张冠李戴，
   * 所以点开时必须靠 vaultId 决定"先切到哪个库"。
   */
  function renderAllScope() {
    const cnt = document.getElementById('navScopeCount');
    if (cnt) cnt.textContent = allTree ? `${allTree.total} 张` : '…';
    if (!allTree) {
      scroll.appendChild(h('div', { class: 'nav-empty' },
        allTreeLoading ? '正在扫描所有知识库…' : '暂无跨库数据'));
      return;
    }
    // v6.37.0：'enabled' 与 'all' 共用一份 allTree，仅按 linkEnabled 做视图过滤，
    // 口径与设置页「启用的知识库」一致（v.linkEnabled !== false）。
    const allVaults = allTree.vaults || [];
    let vaults = scope === 'enabled'
      ? allVaults.filter((v) => v.linkEnabled !== false)
      : allVaults;

    // v10.18.7 修：把搜索框的 filter 真正应用到跨库树。
    // 做法：在**每库自己的目录树**上递归过滤，命中文件留下、空目录整枝剔除；
    // 过滤态下整库节点强制展开（否则命中的卡藏在折叠层里，看着还是"没反应"）。
    const key = filterKey(filter);
    const filtering = !!(key || activeTag);
    if (filtering) {
      vaults = vaults.map((v) => {
        const t = filterTree(v.dirs || [], v.files || [], key);
        return { ...v, dirs: t.dirs, files: t.files };
      }).filter((v) => countFiles(v) > 0);
    }
    // 计数随过滤后的真实可见卡片数对齐，不用全库总数冒充。
    if (cnt) {
      const cards = filtering
        ? vaults.reduce((s, v) => s + countFiles(v), 0)
        : vaults.reduce((s, v) => s + (Number(v.cards) || 0), 0);
      cnt.textContent = `${cards} 张`;
    }
    if (!vaults.length) {
      scroll.appendChild(h('div', { class: 'nav-empty' },
        filtering
          ? h('span', null, '没有匹配的卡片', h('button', {
            class: 'btn ghost nav-empty-clear', onclick: (e) => { e.stopPropagation(); clearFilters(); },
          }, '清除过滤条件'))
          : scope === 'enabled'
            ? '当前没有已启用的知识库。到「设置 → 知识库」启用一个，或切到「全部库」查看。'
            : '还没有登记任何知识库。点标题栏的库名胶囊即可新建或打开一个。'));
      return;
    }
    if (filtering) {
      scroll.appendChild(h('div', { class: 'nav-empty nav-filter-hint', style: { padding: '4px 10px', fontSize: '10.5px' } },
        `跨库检索命中 ${vaults.reduce((s, v) => s + countFiles(v), 0)} 张卡片（${vaults.length} 个库）`));
    }
    if (allTree.truncated) {
      scroll.appendChild(h('div', { class: 'nav-empty nav-truncated' },
        `已扫描 ${allTree.shown} / ${allTree.total} 张卡片（达到上限）。用过滤框缩小范围，或到「库管理」查看全量。`));
    }
    for (const v of vaults) {
      const key = `vault:${v.id}`;
      // 过滤态强制展开：用户是带着问题来找卡的，折叠会把命中项藏起来。
      const isCollapsed = !filtering && collapsed.has(key);
      const head = h('div', {
        class: 'allvault-head' + (v.active ? ' is-cur' : '') + (isCollapsed ? ' is-collapsed' : ''),
        title: v.missing ? `文件夹已不存在：${v.path || ''}` : `${v.path}（${v.cards} 张卡片）`,
        'data-vault': v.id,
        onclick: () => { isCollapsed ? collapsed.delete(key) : collapsed.add(key); render(); },
      },
        h('span', { class: 'caret' }),
        h('span', { class: 'allvault-dot', style: { background: v.color || SEM.vault } }),
        h('span', { class: 'allvault-name' }, v.name),
        v.active ? h('span', { class: 'allvault-badge' }, '当前') : null,
        h('span', { class: 'cnt' }, v.missing ? '缺失' : String(v.cards)),
      );
      scroll.appendChild(head);
      if (isCollapsed) continue;
      if (v.missing) {
        scroll.appendChild(h('div', { class: 'nav-empty', style: { padding: '4px 10px', fontSize: '10.5px' } },
          '该库文件夹已被移动或删除。'));
        continue;
      }
      const body = h('div', { class: 'allvault-body' });
      renderDirNodes(body, v, v.dirs || [], v.files || [], 0, filtering);
      scroll.appendChild(body);
    }
  }

  /** 递归渲染某库内的目录与文件。filtering 时忽略折叠态，让命中项全部可见。 */
  function renderDirNodes(parent, vault, dirs, files, depth, filtering = false) {
    const pad = 10 + depth * 12;
    for (const f of files) {
      parent.appendChild(allFileRow(vault, f, pad));
    }
    for (const d of dirs) {
      const key = `dir:${vault.id}:${d.path}`;
      const isCollapsed = !filtering && collapsed.has(key);
      parent.appendChild(h('div', {
        class: 'tree-dir alldir' + (isCollapsed ? ' is-collapsed' : ''),
        style: { paddingLeft: `${pad}px` },
        title: `${d.path}（${countFiles(d)} 张）`,
        onclick: () => { isCollapsed ? collapsed.delete(key) : collapsed.add(key); render(); },
      },
        h('span', { class: 'caret' }),
        h('span', null, d.name),
        h('span', { class: 'cnt' }, String(countFiles(d))),
      ));
      if (isCollapsed) continue;
      const sub = h('div', { class: 'alldir-body' });
      renderDirNodes(sub, vault, d.dirs || [], d.files || [], depth + 1, filtering);
      parent.appendChild(sub);
    }
  }

  /** 目录节点下的卡片总数（含子目录）。 */
  function countFiles(d) {
    let n = (d.files || []).length;
    for (const s of d.dirs || []) n += countFiles(s);
    return n;
  }

  /** 全部库模式下的文件行。 */
  function allFileRow(vault, f, pad) {
    const isCur = vault.active;
    const row = h('div', {
      class: 'tree-file allfile' + (isCur && app.currentId === f.id ? ' is-active' : ''),
      style: { paddingLeft: `${pad}px` },
      title: `${vault.name} / ${f.path}`,
      tabindex: '0',
    },
      h('span', { class: `lyr lyr-${f.layer || 'semantic'}` }),
      h('span', { class: 'fname' }, f.title),
      h('span', { class: 'deg', title: '突触度数' }, String(f.degree || 0)),
    );
    row.dataset.id = f.id;
    row.dataset.vault = vault.id;
    const open = () => openAcrossVault(vault, f);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
    return row;
  }

  /**
   * 打开某个库里的卡片。
   *
   * 若目标不是当前库，先切库再打开 —— 否则读的是**当前库**的 store，
   * 同名同路径的卡片会张冠李戴（id 是按相对路径派生的，跨库会撞）。
   */
  async function openAcrossVault(vault, f) {
    if (!vault.active) {
      const res = await api.vault.switch(vault.id);
      if (!res?.ok) { toast(res?.error || '切换知识库失败', 'err'); return; }
      await app.refreshVault();
      app.currentId = null;
      app.history = []; app.hIndex = -1;
      toast(`已切换到「${res.vault.name}」`, 'ok', 2000);
    }
    await app.openCard(f.id);
  }

  /** 渲染库快捷跳转胶囊（仅全部库模式）。 */
  function renderVaultJump() {
    const box = document.getElementById('navVaultJump');
    if (!box) return;
    box.innerHTML = '';
    if ((scope !== 'all' && scope !== 'enabled') || !allTree) { box.style.display = 'none'; return; }
    box.style.display = '';
    const jumpVaults = scope === 'enabled'
      ? (allTree.vaults || []).filter((v) => v.linkEnabled !== false)
      : (allTree.vaults || []);
    for (const v of jumpVaults) {
      box.appendChild(h('button', {
        class: 'nav-vault-chip' + (v.active ? ' is-cur' : ''),
        title: `${v.path}（${v.cards} 张卡片）`,
        onclick: () => jumpToVault(v.id),
      },
        h('span', { class: 'allvault-dot', style: { background: v.color || SEM.vault } }),
        h('span', null, v.name),
        h('span', { class: 'cnt' }, String(v.cards)),
      ));
    }
  }

  /** 跳到某个库：折叠其它库，展开目标库。 */
  function jumpToVault(vaultId) {
    if (!allTree) return;
    for (const v of allTree.vaults || []) {
      const key = `vault:${v.id}`;
      if (v.id === vaultId) collapsed.delete(key);
      else collapsed.add(key);
    }
    render();
    // 把目标库滚到可视区
    const el = document.querySelector(`.allvault-head[data-vault="${vaultId}"]`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function render() {
    renderFilterBar();
    syncScopeButtons();
    renderVaultJump();
    scroll.innerHTML = '';
    if (scope === 'all' || scope === 'enabled') { renderAllScope(); return; }
    const list = visibleFiles();

    // v2.1.0：索引层已截断时，先把事实说清楚，别让用户以为"库里就这么几张"
    if (treeMeta.truncated) {
      scroll.appendChild(h('div', { class: 'nav-empty nav-truncated' },
        `本库共 ${treeMeta.total} 张卡片，已载入前 ${treeMeta.shown} 张。用上方过滤框精确查找，或到「星图」用总览视图按领域下钻。`));
    }
    if (!list.length) {
      // v2.2.1：过滤后为空时，**必须给出明确的出路**。
      // 用户反馈的死局就是"没有匹配的卡片"孤零零地杵着，没有任何可点的东西。
      // 这里直接给出「清除过滤」按钮 —— 任何原因导致列表为空，用户都能一键回到全量。
      const af = activeFilter();
      scroll.appendChild(h('div', { class: 'nav-empty' },
        af ? '没有匹配的卡片' : '知识库还是空的，点「＋」写第一张卡片。',
        af ? h('button', {
          class: 'btn ghost nav-empty-clear',
          onclick: () => clearFilters(),
        }, '清除过滤条件') : null));
      return;
    }
    let budget = RENDER_CAP;

    // 1) 按记忆层（A2：专家机制默认隐身，开启专家模式后可见）
    // v2.2.1 修正：原先每个记忆层**硬编码只渲染前 60 张**，且**不加任何提示**。
    // 692 张卡片的库里，语义记忆层有 691 张，却只列出 60 张 —— 用户切到这一层
    // 看到的就只有 60 行，看不出"少了 631 张"，于是以为"文件没显示全"。
    // 现在：按全局渲染预算分配，层内不再单独截断到 60；
    // 若真因预算不够被截断，**明确写出还剩多少张没渲染**，并给出过滤建议。
    for (const layer of LAYER_ORDER) {
      const sub = list.filter((f) => (f.layer || 'semantic') === layer);
      if (!sub.length) continue;
      sub.sort((a, b) => (b.degree || 0) - (a.degree || 0));
      const w = h('div', { class: 'expert-only' });
      const layerKey = `layer:${layer}`;
      // 折叠的分组不占预算（展开时才需要渲染行）—— 否则用户展开一个分组，
      // 看到的行数却因为别处先占了预算而被截断。
      const isCollapsed = collapsed.has(layerKey);
      const take = isCollapsed ? 0 : Math.max(60, Math.min(sub.length, budget));
      budget = Math.max(0, budget - take);
      const rows = sub.slice(0, take).map(fileRow);
      const hidden = sub.length - rows.length;
      w.appendChild(group(LAYER_LABEL[layer] || layer, sub.length, rows, layerKey));
      if (hidden > 0) {
        w.appendChild(h('div', { class: 'nav-empty', style: { padding: '4px 10px', fontSize: '10px' } },
          `… ${LAYER_LABEL[layer] || layer}还有 ${hidden} 张未渲染（共 ${sub.length} 张，用上方过滤框缩小范围）`));
      }
      scroll.appendChild(w);
    }

    // 2) 按目录
    const byDir = new Map();
    for (const f of list) {
      const d = (f.path || '').includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '（根目录）';
      if (!byDir.has(d)) byDir.set(d, []);
      byDir.get(d).push(f);
    }
    let omitted = 0;
    // v2.2.1：折叠的「目录」分组不占渲染预算（与记忆层同理）
    const dirCollapsed = collapsed.has('dir');
    const dirBody = [...byDir.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh')).map(([d, fs]) => {
      const take = dirCollapsed ? 0 : Math.max(0, Math.min(fs.length, budget));
      budget -= take;
      omitted += fs.length - take;
      const inner = h('div', null,
        // v2.2.0：目录行此前只是静态标签，却带着 pointer 光标与悬停样式 ——
        // 看起来能点、点了没反应。现在给它真能力：点击即按该目录过滤，
        // 再点一次取消过滤；「（根目录）」则用于清除过滤。
        h('div', {
          class: 'tree-dir' + (filterKey(filter) === filterKey(d) && filter ? ' is-on' : ''),
          title: d === '（根目录）' ? '清除目录过滤' : `只看「${d}」目录下的卡片（再点一次取消）`,
          onclick: () => {
            // v2.2.1：写入与比较都用同一个小写键。
            // 原先这里写的是**原样**目录名，而比较时路径被 toLowerCase() ——
            // 含大写的目录名（`00-NEOLINK-总控` 这类，本库到处都是）
            // 永远匹配不上，点一下就把整个面板清空，且无法再点回来。
            const k = filterKey(d);
            const isRoot = d === '（根目录）';
            const next = (isRoot || filterKey(filter) === k) ? '' : k;
            filter = next;
            // 搜索框显示原始目录名（保留大小写更好认），但比较用的 filter 是小写
            search.value = isRoot ? '' : d;
            render();
          },
        }, h('span', null, d), h('span', { class: 'cnt' }, String(fs.length))),
        ...fs.slice(0, take).map(fileRow),
        fs.length > take
          ? h('div', { class: 'nav-empty', style: { padding: '4px 10px', fontSize: '10px' } },
            `… 还有 ${fs.length - take} 张未渲染（用上方过滤框缩小范围）`)
          : null,
      );
      return inner;
    });
    scroll.appendChild(group('目录', list.length, dirBody, 'dir'));

    // 3) 标签云
    const tagCount = new Map();
    for (const f of files) for (const t of f.tags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    if (tagCount.size) {
      const cloud = h('div', { class: 'tag-cloud' });
      // v2.2.1：原先只显示前 40 个标签、共 280 个时**只字不提**，
      // 用户看到 40 个标签就以为"只有这些标签"。现在上限提到 120，
      // 并且把没显示的数量**如实写出来**。
      const TAG_CAP = 120;
      const tagSorted = [...tagCount.entries()].sort((a, b) => b[1] - a[1]);
      const tagShown = tagSorted.slice(0, TAG_CAP);
      for (const [t, c] of tagShown) {
        cloud.appendChild(h('span', {
          class: 'tag-chip' + (activeTag === t ? ' is-on' : ''), title: `${c} 张卡片`,
          onclick: () => { activeTag = activeTag === t ? null : t; render(); },
        }, `#${t} ${c}`));
      }
      if (tagSorted.length > tagShown.length) {
        cloud.appendChild(h('div', { class: 'nav-empty', style: { padding: '4px 10px', fontSize: '10px' } },
          `… 还有 ${tagSorted.length - tagShown.length} 个标签未显示（共 ${tagSorted.length} 个），用上方过滤框查找卡片`));
      }
      scroll.appendChild(group('标签', tagCount.size, cloud, 'tags'));
    }
  }

  async function onDerive() {
    status('正在推导突触…');
    const r = await api.derive({});
    if (!r?.ok) { toast(r?.error || '推导失败', 'err'); status('就绪'); return; }
    const a = r.data.added || {};
    toast(`新增 ${r.data.total} 条突触（相似 ${a.semantic_similar || 0} · 共现 ${a.co_occurrence || 0} · 时序 ${a.temporal || 0} · 层级 ${a.hierarchical || 0}）`, 'ok', 5000);
    await app.refreshVault();
    await load();
    status('突触推导完成');
  }

  async function onRebuild() {
    status('正在重建索引…');
    await api.rebuild();
    await app.refreshVault();
    await load();
    status('索引已重建');
    toast('索引已重建：双链已重新解析为突触', 'ok');
  }

  app.on((kind, payload) => {
    if (kind === 'vault' || kind === 'tree') {
      // v2.2.1：全部库模式下，切库只需**刷新跨库树**，
      // 不该把整个面板重置回"本库"视图 —— 那会让用户刚展开的树全白展开。
      // load() 本身会按 scope 分流，这里只要别把 scope 改回去即可。
      load();
    }
    // v2.2.0：文档台的面包屑与标签徽章此前发的是**没人监听**的事件 ——
    // 看起来能点，点了什么也不会发生。现补上真正的接收方：
    //   · 'tag'  → 按标签过滤卡片网络（文档头 #标签 徽章点击）
    // 注：原先还有 'dir'（面包屑点击 → 按目录过滤）。
    // v2.2.1：面包屑点击改为**在系统文件管理器里打开对应文件夹**（用户诉求），
    // 'dir' 事件因此没有了发送方 —— 在应用内按目录过滤的入口是左栏「卡片网络」
    // 的目录行（点一下即过滤），功能未丢，这里删掉无用的监听以免留下死代码。
    if (kind === 'tag') {
      activeTag = activeTag === payload ? null : String(payload || '');
      render();
      return;
    }
    if (kind === 'open') {
      for (const el of scroll.querySelectorAll('.tree-file')) el.classList.remove('is-active');
      if (!app.currentId) return;
      for (const row of scroll.querySelectorAll('.tree-file')) {
        if (row.dataset.id === app.currentId) {
          row.classList.add('is-active');
          row.scrollIntoView({ block: 'nearest' });
        }
      }
    }
  });

  load();
  return { refresh: load };
}
