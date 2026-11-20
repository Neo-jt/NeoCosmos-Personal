// v6.22.0 · 链接管理 · CONNECTION MANAGER（企业版二级页）
// ---------------------------------------------------------------------------
// 显示真正连接过本知识库「链接 API」的客户端 IP 与调用情况。
//
// 真实性纪律（与本项目其它视图一致）：
//   · 所有 IP / 次数 / 时间 / 接口分布都来自主进程 api-access.jsonl 的真实请求记录，
//     由 conn:list 聚合后返回；界面不产生、不推算、不预置任何读数。
//   · 未取数前 snap = null，概览显示「—」而不是写死的 0；没有记录就如实显示空态。
//   · 拉黑 / 解除 / 断开 / 切换绑定 / 启停服务全部调用真实 IPC，操作后重新取数。
//   · HTTP 是短连接：「断开」只能真实 destroy() 此刻存活的 socket，
//     不会把它包装成「永久踢掉该客户端」；后续请求由黑名单真实拒绝，界面如实说明。
import { h, emptyState, confirmDialog } from '../ui-kit.js';

const num = (v) => (v == null || v === '' ? '—' : String(v));
const ts = (v, fmtTime) => (v ? (fmtTime ? fmtTime(v) : String(v)) : '—');

export function mountConnections({ host, app, api, toast, status, fmtTime }) {
  host.innerHTML = '';
  const page = h('div', { class: 'page conn-page' });
  host.appendChild(page);

  page.appendChild(h('div', { class: 'page-head' },
    h('h2', null, '链接管理 · 连接与服务'),
    h('p', null,
      '查看真正连接过本知识库链接 API 的客户端 IP 与调用情况：调用次数、最近调用、接口分布、被拒请求。'
      + '连接可按知识库分别启用或停用，并定向到指定库；数值来自本机真实访问日志（api-access.jsonl），'
      + '按当前库过滤、按稳定库 id 归属；日志只留在本机，不上传。')));

  const body = h('div', { class: 'conn-body' });
  page.appendChild(body);

  let snap = null;          // null = 尚未取到真实数据，绝不显示任何编造的读数
  let error = '';
  let loading = false;
  let alive = true;
  const offs = [];
  if (app && app.on) { try { offs.push(app.on('vault', () => load())); } catch { /* ignore */ } }

  function say(msg, kind = '', ms) {
    try { if (toast) toast(msg, kind, ms); } catch { /* ignore */ }
  }

  // 静态调用映射：逐个写出真实通道，让能力清单生成器能静态识别引用。
  // 不用 api.connections[method] 动态索引 —— 那样静态审计看不见，
  // 明明真实存在的调用会被如实但冤枉地标成「零引用」。
  const CALLS = {
    service: (v) => api.connections.service(v),
    bind: (v) => api.connections.bind(v),
    disconnect: (v) => api.connections.disconnect(v),
    block: (v) => api.connections.block(v),
    unblock: (v) => api.connections.unblock(v),
    // v6.23.0：按库启停 / 选择 / 新建专用沉淀回写仓库
    scopeSet: (v) => api.connections.scopeSet(v),
    sedimentSet: (v) => api.connections.sedimentSet(v),
    sedimentCreate: (v) => api.connections.sedimentCreate(v),
  };

  /** 统一的真实操作入口：失败如实提示，成功后重新取数刷新整页。 */
  async function call(method, arg, okMsg, after) {
    const fn = CALLS[method];
    if (!fn || !api || !api.connections) { say('当前版本不支持该操作', 'err'); return null; }
    let r;
    try { r = await fn(arg); }
    catch (e) { say('操作失败：' + String(e && e.message || e), 'err'); return null; }
    if (!r || r.ok === false) { say('操作失败：' + String((r && r.error) || '未返回结果'), 'err'); return null; }
    if (okMsg) say(okMsg, 'ok');
    if (after) after(r.data || {});
    await load();
    return r.data || {};
  }

  async function load() {
    if (!alive || loading) return;
    loading = true;
    error = '';
    try {
      const r = await (api && api.connections && api.connections.list
        ? api.connections.list() : Promise.resolve(null));
      if (!alive) return;
      if (!r || r.ok === false) { snap = null; error = String((r && r.error) || '未返回连接数据'); }
      else snap = r.data || null;
    } catch (e) {
      if (!alive) return;
      snap = null;
      error = String(e && e.message || e);
    } finally {
      loading = false;
      if (alive) render();
    }
  }

  // ── 服务状态 + 绑定模式 ──────────────────────────────────────────────────
  function statusCard() {
    const s = (snap && snap.server) || null;
    const running = !!(s && s.running);
    const bind = s ? s.bind : null;
    const led = h('div', { class: 'conn-status' + (running ? ' on' : '') },
      h('span', { class: 'led' }),
      h('span', null, !s ? '状态读取中…'
        : (running ? `运行中 · ${s.host}:${s.port}` : '服务未启动')));

    const facts = h('div', { class: 'conn-facts' });
    const fact = (label, value) => h('div', { class: 'conn-fact' },
      h('span', null, label), h('b', null, value));
    facts.append(
      fact('绑定模式', !s ? '—' : (bind === 'lan' ? '局域网（0.0.0.0）' : '仅本机（127.0.0.1）')),
      fact('访问令牌', !s ? '—' : (s.hasToken ? (s.tokenEncrypted ? '已设置 · 密钥环加密' : '已设置 · 明文保存（有风险）') : '未设置')),
      fact('当前活跃连接', num(s && s.activeConnections)),
      fact('当前知识库', (snap && snap.vault) || '未打开知识库'),
      fact('日志窗口', !s ? '—' : `最近 ${num(s.logWindow)} 条真实请求`),
      fact('已拉黑 IP', num(s && s.blocklist && s.blocklist.length)),
    );

    const card = h('div', { class: 'card conn-card' },
      h('h3', null, '服务与访问范围', h('span', { class: 'cnt' }, s ? (running ? '运行中' : '已停止') : '读取中…')),
      led, facts);

    const lan = (s && Array.isArray(s.lanIps)) ? s.lanIps : [];
    card.appendChild(h('div', { class: 'conn-lan' },
      h('b', null, '本机局域网地址'),
      h('span', null, lan.length
        ? lan.map((x) => `${x.address}（${x.name}）`).join(' · ')
        : '未检测到非回环 IPv4 地址（如实显示，不猜测）')));

    const acts = h('div', { class: 'btn-row conn-acts' });
    acts.appendChild(h('button', {
      class: running ? 'btn warn' : 'btn',
      disabled: !s,
      title: running ? '停止链接 API，记录保留' : '用已保存的令牌启动链接 API；没有令牌时主进程现场生成',
      onclick: () => call('service', running ? 'stop' : 'start', running ? '链接 API 已停止' : '链接 API 已启动'),
    }, running ? '停止服务' : '启动服务'));
    acts.appendChild(h('button', {
      class: 'btn ghost' + (bind === 'loopback' ? ' is-on' : ''),
      disabled: !s || bind === 'loopback',
      title: '默认模式：只有本机能访问，保持「数据不出本机」的既有承诺',
      onclick: () => call('bind', 'loopback', '已切回仅本机模式'),
    }, '仅本机（回环）'));
    acts.appendChild(h('button', {
      class: 'btn ghost' + (bind === 'lan' ? ' is-on' : ''),
      disabled: !s || bind === 'lan',
      title: '监听 0.0.0.0，让同一局域网内持有令牌的设备可读取本知识库',
      onclick: async () => {
        const go = await confirmDialog({
          title: '开启局域网访问',
          message: '这会把链接 API 从 127.0.0.1 改为监听 0.0.0.0：同一局域网内持有访问令牌的设备都能读取当前知识库（接口可返回卡片正文全文）。请确认网络可信、令牌未外泄。数据仍只留在本机，不上传云端；两种模式都强制 Bearer 令牌鉴权。',
          confirmText: '我已了解，开启',
        });
        if (go) await call('bind', 'lan', '已切换为局域网模式');
      },
    }, '局域网（需令牌）'));
    acts.appendChild(h('button', { class: 'btn ghost', onclick: () => load() }, '刷新记录'));
    card.appendChild(acts);
    card.appendChild(h('p', { class: 'card-note' },
      '切换绑定时，若服务正在运行会自动用原令牌重启监听；令牌只在主进程读取，不回传界面。'
      + '局域网模式不会取消 CORS 限制，也不会关闭令牌鉴权。'));
    return card;
  }

  // ── 概览（全部由真实日志聚合值填充）──────────────────────────────────────
  function statsRow() {
    const row = h('div', { class: 'conn-stats' });
    const tile = (label, value, sub) => h('div', { class: 'conn-stat' },
      h('b', null, value), h('span', null, label), h('i', null, sub));
    row.append(
      tile('连接过的客户端', num(snap && snap.clientCount), '按真实来源 IP 去重'),
      tile('窗口内调用', num(snap && snap.total), `日志窗口 ${num(snap && snap.window)} 条`),
      tile('近 24 小时', num(snap && snap.last24h), '按记录时间戳计算'),
      tile('被拒请求', num(snap && snap.denied), '401 / 403 鉴权与黑名单拒绝'),
    );
    return row;
  }

  // ── v6.23.0 连接作用域：按知识库启停 + 沉淀回写仓库 ─────────────────────
  // 读数仍是真实日志：calls / clients / lastTs 来自 conn:list 的 byVault 聚合，
  // 没有任何预置计数；停用是服务端 403，不是只把按钮变灰。
  function scopeCard() {
    const list = (snap && Array.isArray(snap.scopes)) ? snap.scopes : [];
    const sedimentId = snap && snap.sedimentVault ? snap.sedimentVault.id : null;
    const policy = snap && snap.scanPolicy ? snap.scanPolicy : null;
    const canSet = !!(api && api.connections && api.connections.scopeSet);
    const canSed = !!(api && api.connections && api.connections.sedimentSet);
    const canCreate = !!(api && api.connections && api.connections.sedimentCreate);
    const card = h('div', { class: 'card conn-card' },
      h('h3', null, '连接作用域 · 按知识库启停',
        h('span', { class: 'cnt' }, snap ? `${list.length} 个知识库` : '读取中…')));
    card.appendChild(h('p', { class: 'card-note' },
      '每个知识库用稳定 id 区分。请求可用请求头 X-NeoKB-Vault: <id> 或 ?vault=<id> 定向；'
      + '停用的库由服务端真实返回 403，也不会被按需扫描。启用时才会为该库预建一次索引，'
      + '不会每次请求把所有知识库扫一遍。'));
    if (policy) {
      card.appendChild(h('div', { class: 'conn-lan' },
        h('b', null, '扫描策略'),
        h('span', null, `按需扫描 · 已启用 ${num(policy.enabled)} / 登记 ${num(policy.registered)} 个库`)));
    }
    card.appendChild(h('div', { class: 'conn-lan' },
      h('b', null, '沉淀回写仓库'),
      h('span', null, snap && snap.sedimentVault
        ? `${snap.sedimentVault.name} · ${snap.sedimentVault.path}（Agent 回写独立落盘）`
        : '未设置：回写仍进入请求所指向的知识库（如实标注，不冒充已隔离）')));
    if (!list.length) {
      card.appendChild(h('p', { class: 'card-note' },
        snap ? '尚未返回知识库作用域信息。' : '正在读取真实作用域信息…'));
      return card;
    }
    const table = h('div', { class: 'scope-table' });
    table.appendChild(h('div', { class: 'scope-tr conn-th' },
      h('span', null, '知识库'), h('span', null, '用途'), h('span', null, '连接'),
      h('span', null, '真实调用'), h('span', null, '操作')));
    for (const s of list) {
      const ops = h('div', { class: 'scope-ops' });
      if (canSet) {
        ops.appendChild(h('button', {
          class: 'btn mini' + (s.linkEnabled ? ' warn' : ''),
          title: s.linkEnabled ? '停用后该库的请求会被服务端真实拒绝（403）' : '启用并预建一次索引',
          onclick: () => call('scopeSet', { id: s.id, enabled: !s.linkEnabled },
            s.linkEnabled ? `已停用「${s.name}」的连接` : `已启用「${s.name}」的连接`),
        }, s.linkEnabled ? '停用' : '启用'));
      }
      if (canSed && s.id !== sedimentId) {
        ops.appendChild(h('button', {
          class: 'btn mini', title: '把该库设为 Agent 回写的专用仓库',
          onclick: () => call('sedimentSet', { id: s.id }, `已把「${s.name}」设为沉淀回写仓库`),
        }, '设为沉淀库'));
      }
      table.appendChild(h('div', { class: 'scope-tr' },
        h('span', { class: 'scope-name' },
          h('b', null, s.name || s.id),
          h('i', { title: s.path }, s.path || s.id)),
        h('span', null, s.purpose === 'sediment'
          ? h('i', { class: 'scope-tag sed' }, '沉淀库')
          : h('i', { class: 'scope-tag' }, '普通库')),
        h('span', null, s.linkEnabled
          ? h('i', { class: 'scope-tag on' }, '启用')
          : h('i', { class: 'scope-tag off' }, '停用')),
        h('span', { class: 'mono', title: `最近 ${num(s.lastTs)} 有调用` }, `${num(s.calls)} 次`),
        ops));
    }
    card.appendChild(table);
    if (canCreate) {
      card.appendChild(h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: async () => {
          const go = await confirmDialog({
            title: '新建专用沉淀回写仓库',
            message: '会在知识库存放位置新建一个真实的独立文件夹（不含任何示例卡片），并设为 Agent 回写目标。'
              + '\n\n不会切换你当前打开的知识库，也不会改动任何已有库里的文件。',
            confirmText: '创建并设为回写目标',
          });
          if (!go) return;
          const r = await call('sedimentCreate', { name: 'NeoCosmos 沉淀库' }, '已新建专用沉淀回写仓库');
          say(r && r.created ? `沉淀库：${r.created.path}` : '沉淀库已就绪', 'ok', 4200);
        } }, '新建专用沉淀库'),
        canSed ? h('button', { class: 'btn ghost', onclick: () => call('sedimentSet', { id: null },
          '已取消专用沉淀库，回写将进入请求指向的库') }, '取消专用沉淀库') : null));
    }
    return card;
  }

  // ── 客户端表 ────────────────────────────────────────────────────────────
  function clientsCard() {
    const clients = (snap && Array.isArray(snap.clients)) ? snap.clients : [];
    const card = h('div', { class: 'card conn-card' },
      h('h3', null, '客户端与调用情况', h('span', { class: 'cnt' }, snap ? `${clients.length} 个来源` : '读取中…')));
    if (!clients.length) {
      card.appendChild(emptyState('link', '还没有连接记录',
        snap
          ? `当前知识库在最近 ${num(snap.window)} 条访问记录窗口内没有收到任何请求。启动链接 API 后，任何携带令牌的真实 HTTP 请求都会在这里留下记录；本机回环访问同样如实计入。`
          : '正在读取真实访问日志…',
        h('button', { class: 'btn', onclick: () => call('service', 'start', '链接 API 已启动') }, '启动链接 API')));
      return card;
    }

    const table = h('div', { class: 'conn-table' });
    table.appendChild(h('div', { class: 'conn-tr conn-th' },
      h('span', null, '客户端 IP'), h('span', null, '状态'), h('span', null, '调用'),
      h('span', null, '被拒'), h('span', null, '最近调用'), h('span', null, '主要接口'),
      h('span', null, '管理')));

    for (const c of clients) {
      const ops = h('div', { class: 'conn-ops' });
      ops.appendChild(h('button', {
        class: 'btn mini', title: '断开该 IP 此刻存活的 HTTP 连接（短连接，仅影响当前 socket）',
        onclick: () => call('disconnect', c.ip, '', (d) => {
          say(d.closed > 0
            ? `已断开 ${d.closed} 个当前连接`
            : '该 IP 当前没有活跃连接（HTTP 请求结束即断开）', d.closed > 0 ? 'ok' : '', 3200);
        }),
      }, '断开'));
      if (c.blocked) {
        ops.appendChild(h('button', {
          class: 'btn mini', onclick: () => call('unblock', c.ip, `已解除 ${c.ip}`),
        }, '解除'));
      } else {
        ops.appendChild(h('button', {
          class: 'btn mini warn', title: '写入真实黑名单：该 IP 之后的请求一律返回 403',
          onclick: async () => {
            const go = await confirmDialog({
              title: '拉黑该客户端',
              message: `之后来自 ${c.ip} 的请求会被真实拒绝（HTTP 403），已产生的历史记录保留。可随时在列表中解除。`,
              confirmText: '确认拉黑',
            });
            if (go) await call('block', c.ip, `已拉黑 ${c.ip}`);
          },
        }, '拉黑'));
      }
      table.appendChild(h('div', { class: 'conn-tr' + (c.blocked ? ' is-blocked' : '') },
        h('span', { class: 'mono' }, c.ip),
        h('span', null, h('i', { class: 'conn-tag' + (c.blocked ? ' bad' : '') }, c.blocked ? '已拉黑' : '正常')),
        h('span', { class: 'mono' }, num(c.calls)),
        h('span', { class: 'mono' }, num(c.denied)),
        h('span', null, ts(c.lastTs, fmtTime)),
        h('span', { class: 'mono conn-path', title: (c.byPath || []).map((x) => `${x.path} ×${x.calls}`).join('\n') }, c.topPath || '—'),
        ops));
    }
    card.appendChild(table);
    card.appendChild(h('p', { class: 'card-note' },
      '「断开」只关闭此刻真实存活的 TCP 连接；HTTP 无长会话，客户端仍可再次发起请求。'
      + '要阻止后续访问请用「拉黑」——它会写入配置并在服务端对每次请求真实比对。'));
    return card;
  }

  // ── 接口分布 + 最近调用明细 ─────────────────────────────────────────────
  function detailsGrid() {
    const paths = (snap && Array.isArray(snap.paths)) ? snap.paths : [];
    const recent = (snap && Array.isArray(snap.recent)) ? snap.recent : [];
    const total = Number(snap && snap.total) || 0;
    const grid = h('div', { class: 'conn-grid' });

    const pc = h('div', { class: 'card conn-card' }, h('h3', null, '接口分布'));
    if (!paths.length) pc.appendChild(h('p', { class: 'card-note' }, '窗口内没有真实请求，暂无分布可显示。'));
    else for (const p of paths.slice(0, 12)) {
      const pct = total > 0 ? Math.round(p.calls / total * 100) : 0;
      pc.appendChild(h('div', { class: 'conn-bar-row' },
        h('span', { class: 'mono' }, p.path),
        h('div', { class: 'syn-bar' }, h('i', { style: { width: `${Math.max(2, pct)}%` } })),
        h('b', null, `${num(p.calls)} · ${pct}%`)));
    }
    grid.appendChild(pc);

    const rc = h('div', { class: 'card conn-card' }, h('h3', null, '最近调用明细'));
    if (!recent.length) rc.appendChild(h('p', { class: 'card-note' }, '窗口内没有真实请求记录。'));
    else {
      const list = h('div', { class: 'conn-log' });
      list.appendChild(h('div', { class: 'conn-log-tr conn-th' },
        h('span', null, '时间'), h('span', null, '来源 IP'), h('span', null, '方法'),
        h('span', null, '路径'), h('span', null, '状态')));
      for (const r of recent) {
        const bad = Number(r.status) >= 400;
        list.appendChild(h('div', { class: 'conn-log-tr' },
          h('span', null, ts(r.ts, fmtTime)),
          h('span', { class: 'mono' }, r.ip),
          h('span', { class: 'mono' }, r.method),
          h('span', { class: 'mono conn-path' }, r.path),
          h('span', { class: 'conn-code' + (bad ? ' bad' : '') }, num(r.status))));
      }
      rc.appendChild(list);
    }
    grid.appendChild(rc);
    return grid;
  }

  function render() {
    body.innerHTML = '';
    if (error) {
      body.appendChild(emptyState('warn', '读取连接数据失败', error,
        h('button', { class: 'btn', onclick: () => load() }, '重试')));
      return;
    }
    if (!snap) {
      body.appendChild(emptyState('refresh', '正在读取真实访问日志',
        '连接列表、调用次数与接口分布全部由本机 api-access.jsonl 派生；读取完成前不显示任何数字。'));
      return;
    }
    body.append(statusCard(), statsRow(), scopeCard(), clientsCard(), detailsGrid());
    body.appendChild(h('p', { class: 'hub-note conn-foot' },
      `如实边界：统计基于本机保留的最近 ${num(snap.window)} 条真实请求，按当前知识库「${snap.vault || '未打开'}」过滤；`
      + '回环地址（127.0.0.1）代表本机进程访问，也会如实计入。日志不上传、不含查询串与令牌，'
      + '按稳定库 id 归属（旧记录回退按目录名）。'
      + '未执行任何跨机器连通性探测，也不推断未发生过的连接。'));
  }

  render();
  load();
  return {
    refresh() { load(); },
    unmount() { alive = false; for (const off of offs) { try { off(); } catch { /* ignore */ } } },
  };
}
