// NeoLink 桌面版 · 预加载层
// 渲染进程 -> 主进程 的唯一受控通道。渲染层拿不到任何 Node 能力，拿不到 fs，也拿不到原始 ipc。
//
// v1.1.0 增补：多知识库（vault:list/create/switch/rename/setColor/forget）、
//           跨库关联（crosskb:*）、文件监视回调（onVaultChanged）
const { ipcRenderer, contextBridge } = require('electron');

// v6.3.0：自主思维事件采用单一订阅，避免 3D 智脑视图反复挂载累积监听器。
let mindTickCb = null;
ipcRenderer.on('mind:tick', (_e, ev) => {
  try { if (mindTickCb) mindTickCb(ev); } catch (err) { console.error(err); }
});
// v6.6.0：量子认知层结果（自主循环 / 手动演化共用一条通道）
let mindQuantumCb = null;
ipcRenderer.on('mind:quantum', (_e, ev) => {
  try { if (mindQuantumCb) mindQuantumCb(ev); } catch (err) { console.error(err); }
});
// v6.8.0：类脑计算引擎结果（SNN/吸引子/序列/预测编码，自主循环 / 手动 / 八阶段共用）
let mindNeuroCb = null;
ipcRenderer.on('mind:neuro', (_e, ev) => {
  try { if (mindNeuroCb) mindNeuroCb(ev); } catch (err) { console.error(err); }
});

const api = {
  init: () => ipcRenderer.invoke('app:init'),

  // v2.1.0：自检分步计时回传。百万级库上"自检超时"必须能定位到具体步骤，
  // 否则只有一个"超时"二字。这里把每一步的毫秒数实时送回主进程落盘。
  diagMark: (name, ms) => { try { ipcRenderer.send('diag:mark', { name, ms }); } catch (err) { /* ignore */ } },

  // 主进程通知（如自动睡眠结果）
  onNotice: (cb) => {
    // v6.18.0：所有订阅统一返回退订函数，避免视图重复挂载 / 热重载累积监听器
    const h = (_e, n) => { try { cb(n); } catch (err) { console.error(err); } };
    ipcRenderer.on('app:notice', h);
    return () => ipcRenderer.removeListener('app:notice', h);
  },

  win: {
    min: () => ipcRenderer.invoke('window:control', 'min'),
    max: () => ipcRenderer.invoke('window:control', 'max'),
    close: () => ipcRenderer.invoke('window:control', 'close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    // v2.3.0：主进程要求确认关闭（Alt+F4 / 任务栏关闭 / 系统注销都会走到这里）。
    // 渲染层弹确认框后，把用户的选择回传给主进程。
    onAskClose: (cb) => {
      const h = () => { try { cb(); } catch (err) { console.error(err); } };
      ipcRenderer.on('window:ask-close', h);
      return () => ipcRenderer.removeListener('window:ask-close', h);
    },
    replyClose: (ok) => ipcRenderer.send('window:close-reply', !!ok),
  },

  vault: {
    info: () => ipcRenderer.invoke('vault:info'),
    list: () => ipcRenderer.invoke('vault:list'),
    open: (p) => ipcRenderer.invoke('vault:open', p),
    pick: () => ipcRenderer.invoke('vault:pick'),
    create: (opts) => ipcRenderer.invoke('vault:create', opts),
    switch: (id) => ipcRenderer.invoke('vault:switch', id),
    rename: (opts) => ipcRenderer.invoke('vault:rename', opts),
    setColor: (opts) => ipcRenderer.invoke('vault:setColor', opts),
    forget: (id) => ipcRenderer.invoke('vault:forget', id),
    reveal: () => ipcRenderer.invoke('vault:reveal'),
    // v2.2.1：在系统文件管理器里打开库内的某个相对路径（面包屑点击用）
    revealPath: (rel) => ipcRenderer.invoke('vault:revealPath', rel),
    // v2.2.1：存储位置由用户自选（不默认 C 盘）
    storageLocations: () => ipcRenderer.invoke('vault:storageLocations'),
    chooseStorage: () => ipcRenderer.invoke('vault:chooseStorage'),
    migrate: (targetDir) => ipcRenderer.invoke('vault:migrate', { targetDir }),
    loadExample: () => ipcRenderer.invoke('vault:loadExample'),
    // v2.2.1：只读查询示例语料是否存在（不写用户的库）
    exampleInfo: () => ipcRenderer.invoke('vault:exampleInfo'),
    seed: () => ipcRenderer.invoke('vault:seed'),
  },

  // 跨库关联
  crosskb: {
    remoteList: (opts) => ipcRenderer.invoke('crosskb:remoteList', opts),
    add: (opts) => ipcRenderer.invoke('crosskb:add', opts),
    remove: (id) => ipcRenderer.invoke('crosskb:remove', id),
    open: (opts) => ipcRenderer.invoke('crosskb:open', opts),
  },

  // ---------------- v2.2.0：跨库关联图谱 + 本地链接 API + 深链 ----------------
  vaults: {
    // force=true：用户显式点了「刷新状态」，绕开缓存真正重扫磁盘
    xgraph: (opts) => ipcRenderer.invoke('vaults:xgraph', opts),
  },
  apiServer: {
    start: (opts) => ipcRenderer.invoke('api:start', opts),
    stop: () => ipcRenderer.invoke('api:stop'),
    status: () => ipcRenderer.invoke('api:status'),
    // v2.2.1：生成高强度随机令牌（主进程做，渲染层不接触随机源）
    genToken: () => ipcRenderer.invoke('api:genToken'),
    // 读取已保存的令牌（从系统密钥环解密）—— 仅用户明确点击时调用
    revealToken: () => ipcRenderer.invoke('api:revealToken'),
  },
  // v6.22.0：链接管理 —— 真实访问日志 / 黑名单 / 绑定模式 / 服务启停。
  // 每个方法都对应 main.js 里真实注册的 ipcMain.handle，能力清单由生成器自动枚举。
  connections: {
    list: () => ipcRenderer.invoke('conn:list'),
    block: (ip) => ipcRenderer.invoke('conn:block', ip),
    unblock: (ip) => ipcRenderer.invoke('conn:unblock', ip),
    disconnect: (ip) => ipcRenderer.invoke('conn:disconnect', ip),
    bind: (mode) => ipcRenderer.invoke('conn:bind', mode),
    service: (action) => ipcRenderer.invoke('conn:service', action),
    // v6.23.0：按库启停连接、选择 / 新建专用沉淀回写仓库
    scopeSet: (opts) => ipcRenderer.invoke('conn:scopeSet', opts),
    sedimentSet: (opts) => ipcRenderer.invoke('conn:sedimentSet', opts),
    sedimentCreate: (opts) => ipcRenderer.invoke('conn:sedimentCreate', opts),
  },
  // v6.23.1：外部 AI 助手经标准接口接入的真实链接状态与管理。
  // 全部对应 main.js 里真实注册的通道。
  mcpLinks: {
    list: () => ipcRenderer.invoke('mcp:links'),
    setPolicy: (patch) => ipcRenderer.invoke('mcp:link-policy', patch),
    revoke: (opts) => ipcRenderer.invoke('mcp:link-revoke', opts),
    alias: (opts) => ipcRenderer.invoke('mcp:link-alias', opts),
    clear: () => ipcRenderer.invoke('mcp:link-clear'),
    reveal: () => ipcRenderer.invoke('mcp:link-reveal'),
    // v6.35.0：移除接入（防心跳复活）/ 恢复移除
    remove: (opts) => ipcRenderer.invoke('mcp:link-remove', opts),
    restore: (opts) => ipcRenderer.invoke('mcp:link-restore', opts),
  },
  // v6.31.0：NeoLM 原创本地语言模型（真实训练权重的真实推理，全部对应 main.js 通道）
  // v6.32.0 语义回流层：真实模型向量索引 / 语义调取 / 沉淀回流候选 / 库桥
  semantic: {
    status: () => ipcRenderer.invoke('semantic:status'),
    reindex: () => ipcRenderer.invoke('semantic:reindex'),
    search: (opts) => ipcRenderer.invoke('semantic:search', opts),
    suggestions: () => ipcRenderer.invoke('semantic:suggestions'),
    applySuggestion: (item) => ipcRenderer.invoke('semantic:apply-suggestion', item),
    vaults: () => ipcRenderer.invoke('semantic:vaults'),
    bridges: (opts) => ipcRenderer.invoke('semantic:bridges', opts),
    applyBridge: (item) => ipcRenderer.invoke('semantic:apply-bridge', item),
  },
  neolm: {
    status: () => ipcRenderer.invoke('neolm:status'),
    nearest: (opts) => ipcRenderer.invoke('neolm:nearest', opts),
    similarity: (opts) => ipcRenderer.invoke('neolm:similarity', opts),
    next: (opts) => ipcRenderer.invoke('neolm:next', opts),
    generate: (opts) => ipcRenderer.invoke('neolm:generate', opts),
    expand: (opts) => ipcRenderer.invoke('neolm:expand', opts),
    verify: () => ipcRenderer.invoke('neolm:verify'),
  },
  // v2.2.1：企业级备份 / 校验 / 还原
  // 备份：把整个库导成含清单与审计日志的 zip
  // 校验：逐张比对 sha256
  // 还原：写入**新目录**，绝不覆盖现有库
  vaultBackup: {
    backup: () => ipcRenderer.invoke('vault:backup'),
    verify: (filePath) => ipcRenderer.invoke('vault:verifyBackup', filePath),
    restore: (opts) => ipcRenderer.invoke('vault:restoreBackup', opts),
  },
  // v6.1.3：企业版控制台 —— 真实能力的统一入口
  // v6.2.0：抗量子安全状态 / 完整性复检 / 逆向沉淀开关、列表与离线验签
  enterprise: {
    audit: () => ipcRenderer.invoke('vault:audit'),
    importFolder: (opts) => ipcRenderer.invoke('vault:importFolder', opts),
    securityStatus: () => ipcRenderer.invoke('ent:securityStatus'),
    recheckIntegrity: () => ipcRenderer.invoke('ent:recheckIntegrity'),
    sedimentStatus: () => ipcRenderer.invoke('ent:sedimentStatus'),
    setSediment: (opts) => ipcRenderer.invoke('ent:setSediment', opts),
    sedimentList: (n) => ipcRenderer.invoke('ent:sedimentList', n),
    verifySediment: (id) => ipcRenderer.invoke('ent:verifySediment', id),
    // v6.37.0：知识库 API 自动同步（企业版）
    syncStatus: () => ipcRenderer.invoke('ent:syncStatus'),
    syncConfigSet: (opts) => ipcRenderer.invoke('ent:syncConfigSet', opts),
    syncNow: () => ipcRenderer.invoke('ent:syncNow'),
  },
  // v2.2.0：深链命名空间叫 deepLink，**不能叫 link** ——
  // 本文件下方还有一行 `link: (args) => ... kb_link`（MCP 工具透传），
  // 同一对象里重复的键后者覆盖前者：JS 对象字面量重复键以最后一个为准。
  // 于是上面这个 link 对象被彻底遮蔽，api.link.deep 成了 undefined，
  // 深链功能在**任何**场景下都没生效过（调用即抛 TypeError，被 catch 吞成
  // "深链打开失败"）。这类"同名键互相覆盖"静态审计查不出来，只有真跑才暴露。
  deepLink: {
    deep: (payload) => ipcRenderer.invoke('link:deep', payload),
    // v2.2.0：取走"冷启动时由深链唤起"的那条深链（取走即清空，不会重复跳转）
    takeDeepLink: () => ipcRenderer.invoke('link:takeDeepLink'),
    // 外部唤起深链时，主进程把 neolink://open/<库ID>/<卡片ID> 推给渲染层
    onDeepLink: (cb) => {
      const h = (_e, dl) => { try { cb(dl); } catch (err) { console.error(err); } };
      ipcRenderer.on('neolink:deeplink', h);
      return () => ipcRenderer.removeListener('neolink:deeplink', h);
    },
  },

  // v4.1.0：引用验证溯源 —— 渲染层点击引用卡「溯源验证」时调用主进程 link:verify
  verify: {
    node: (payload) => ipcRenderer.invoke('link:verify', payload),
  },

  // 文件监视：外部改动 .md 自动重建索引后通知渲染层
  onVaultChanged: (cb) => {
    const h = (_e, info) => { try { cb(info); } catch (err) { console.error(err); } };
    ipcRenderer.on('vault:changed', h);
    return () => ipcRenderer.removeListener('vault:changed', h);
  },

  // 文档层（工作区：文档台 + 关联卡片 + 沉淀）
  doc: {
    tree: () => ipcRenderer.invoke('doc:tree'),
    // v2.2.1：跨库目录树（所有已登记库合并成一棵以库为顶层的树）
    allTree: (opts) => ipcRenderer.invoke('vaults:tree', opts),
    read: (id) => ipcRenderer.invoke('doc:read', id),
    save: (id, text) => ipcRenderer.invoke('doc:save', id, text),
    create: (opts) => ipcRenderer.invoke('doc:create', opts),
    archive: (id) => ipcRenderer.invoke('doc:archive', id),
    rename: (id, title) => ipcRenderer.invoke('doc:rename', id, title),
    export: (id) => ipcRenderer.invoke('doc:export', id),
    relations: (id, opts) => ipcRenderer.invoke('doc:relations', id, opts),
    resolve: (title) => ipcRenderer.invoke('doc:resolve', title),
  },
  sediment: (n) => ipcRenderer.invoke('sediment:list', n),
  consolidate: () => ipcRenderer.invoke('consolidate:run'),
  derive: (opts) => ipcRenderer.invoke('synapse:derive', opts),

  graph: (opts) => ipcRenderer.invoke('graph:get', opts),
  rebuild: () => ipcRenderer.invoke('index:rebuild'),
  journal: (n) => ipcRenderer.invoke('journal:tail', n),

  // 引擎工具（与 MCP Server 同源同实现）
  tool(name, args) { return ipcRenderer.invoke('tool:invoke', name, args); },

  search: (args) => ipcRenderer.invoke('tool:invoke', 'kb_search', args),
  read: (args) => ipcRenderer.invoke('tool:invoke', 'kb_read', args),
  expand: (args) => ipcRenderer.invoke('tool:invoke', 'kb_expand', args),
  ask: (args) => ipcRenderer.invoke('tool:invoke', 'kb_ask', args),

  // v6.3.0 类脑认知内核（企业 3D 智脑 / 问一问法律思维）
  mind: {
    legalAsk: (args) => ipcRenderer.invoke('tool:invoke', 'kb_legal_mind', args),
    status: () => ipcRenderer.invoke('mind:status'),
    anatomy: () => ipcRenderer.invoke('mind:anatomy'),
    autonomous: (on) => ipcRenderer.invoke('mind:autonomous', on),
    tick: () => ipcRenderer.invoke('mind:tick'),
    feedback: (args) => ipcRenderer.invoke('mind:feedback', args),
    ledger: () => ipcRenderer.invoke('mind:ledger'),
    onTick: (cb) => { mindTickCb = cb; return () => { mindTickCb = null; }; },
    // v6.6.0：量子认知层（30 脑区为基 / 183 轴突纠缠 / Born 坍缩回灌）
    quantumStatus: () => ipcRenderer.invoke('mind:quantum-status'),
    quantumStep: () => ipcRenderer.invoke('mind:quantum-step'),
    quantumBind: (on) => ipcRenderer.invoke('mind:quantum-bind', on),
    onQuantum: (cb) => { mindQuantumCb = cb; return () => { mindQuantumCb = null; }; },
    // v6.8.0：类脑计算引擎
    neuroStatus: () => ipcRenderer.invoke('mind:neuro-status'),
    neuroStep: (args) => ipcRenderer.invoke('mind:neuro-step', args),
    neuroRecall: (args) => ipcRenderer.invoke('mind:neuro-recall', args),
    neuroPredict: (args) => ipcRenderer.invoke('mind:neuro-predict', args),
    neuroLearn: (args) => ipcRenderer.invoke('mind:neuro-learn', args),
    onNeuro: (cb) => { mindNeuroCb = cb; return () => { mindNeuroCb = null; }; },
  },
  // v6.41.0：桌面精灵（sprite:*）桥接已移除；ASTRA 自主意识中枢保留。
  // v6.11：ASTRA 自主意识中枢 + 桌面自由漫游
  astra: {
    status: () => ipcRenderer.invoke('astra:status'),
    setAutonomous: (on) => ipcRenderer.invoke('astra:set-autonomous', on),
    tick: (opts) => ipcRenderer.invoke('astra:tick', opts || {}),
    evolve: () => ipcRenderer.invoke('astra:evolve'),
    rollback: (gen) => ipcRenderer.invoke('astra:rollback', gen),
    reset: () => ipcRenderer.invoke('astra:reset'),
    perceive: (kind, payload) => ipcRenderer.invoke('astra:perceive', kind, payload || {}),
    audit: (n) => ipcRenderer.invoke('astra:audit', n || 40),
    memories: (n) => ipcRenderer.invoke('astra:memories', n || 40),
    mode: (m) => ipcRenderer.invoke('astra:mode', m),
    hold: (on) => ipcRenderer.invoke('astra:hold', on),
    home: () => ipcRenderer.invoke('astra:home'),
    clickThrough: (on) => ipcRenderer.invoke('astra:click-through', on),
    refreshBounds: () => ipcRenderer.invoke('astra:refresh-bounds'),
    // v6.15：深度数学内核 + 自我迭代闭环（真实数值，可逐条审计）
    deepStatus: () => ipcRenderer.invoke('astra:deep-status'),
    deepMath: () => ipcRenderer.invoke('astra:deep-math'),
    selfIterate: (observation) => ipcRenderer.invoke('astra:self-iterate', observation),
    // v6.12：思维沉淀库（安装目录下自动建立 / 可自主更换）
    library: {
      status: () => ipcRenderer.invoke('astra:library:status'),
      query: (text, limit) => ipcRenderer.invoke('astra:library:query', text, limit),
      graph: (limit) => ipcRenderer.invoke('astra:library:graph', limit),
      relocate: (newRoot, opts) => ipcRenderer.invoke('astra:library:relocate', newRoot, opts || {}),
      open: () => ipcRenderer.invoke('astra:library:open'),
    },
    onState: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('astra:state', h);
      return () => ipcRenderer.removeListener('astra:state', h);
    },
  },
  writeBack: (args) => ipcRenderer.invoke('tool:invoke', 'kb_write_back', args),
  addNode: (args) => ipcRenderer.invoke('tool:invoke', 'kb_add_node', args),
  link: (args) => ipcRenderer.invoke('tool:invoke', 'kb_link', args),
  // v6.29.0 功能②：辅助建立知识关联（真实信号推荐，只读只建议）
  linkRecommend: (args) => ipcRenderer.invoke('tool:invoke', 'kb_link_recommend', args),
  linkAudit: () => ipcRenderer.invoke('tool:invoke', 'kb_link_audit', {}),
  stats: () => ipcRenderer.invoke('tool:invoke', 'kb_graph_stats', {}),
  reviewQueue: (args) => ipcRenderer.invoke('tool:invoke', 'kb_review_queue', args),
  applyReview: (args) => ipcRenderer.invoke('tool:invoke', 'kb_apply_review', args),
  history: (args) => ipcRenderer.invoke('tool:invoke', 'kb_history', args),

  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
};

contextBridge.exposeInMainWorld('neolink', api);
