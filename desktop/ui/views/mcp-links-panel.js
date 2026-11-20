// NeoCosmos v6.23.1 · MCP 外部平台链接状态面板（沉淀 · 回写通道页顶部）
// ---------------------------------------------------------------------------
// 设计要点：
//  1) 自刷新、自管理：面板只重绘自己的子树，绝不调用宿主页的 render()。
//     否则 5 秒一次的轮询会把用户正在选的「目标宿主」下拉框和生成的配置清空。
//  2) 返回的 el 由宿主页复用（appendChild 移动节点而非重建），
//     定时器只在 start() 时创建一次、stop() 时清理，随进随出不会累积。
//  3) 全部数值来自 api.mcpLinks.list() 的真实会话文件聚合；空态明确说明
//     "尚未接入"，不预置任何平台、次数或在线状态来装点界面。
//  4) 每个管理动作都落到 main.js 的真实 policy 文件，MCP Server 每次请求读取，
//     暂停 / 禁用 / 断开是真实生效的，不是只改按钮颜色的假开关。
import {
  h, toast, fmtTime, icon, copyToClipboard, modal, confirmDialog,
} from '../ui-kit.js';

const REFRESH_MS = 5000;

const STATE_TEXT = { online: '在线', offline: '已结束', blocked: '已限制' };
const SOURCE_TEXT = {
  handshake: 'MCP 握手自报',
  caller: '接入配置 --caller',
  unknown: '未上报身份',
};

function timeText(iso) { return iso ? fmtTime(iso) : '—'; }
function num(n) { return Number(n || 0).toLocaleString('zh-CN'); }

/** 平台色：按平台键稳定取色，同一平台每次进来颜色一致。 */
const TONES = ['c-blue', 'c-violet', 'c-cyan', 'c-amber', 'c-green', 'c-rose'];
function toneOf(key) {
  let n = 0;
  for (let i = 0; i < String(key).length; i++) n = (n * 31 + String(key).charCodeAt(i)) >>> 0;
  return TONES[n % TONES.length];
}

/**
 * @param {{api:object, toast:Function, status:Function}} deps
 * @returns {{el:HTMLElement, start:Function, stop:Function, refresh:Function}}
 */
export function createLinksPanel({ api }) {
  const body = h('div', { class: 'ml-body' });
  const el = h('section', { class: 'card mcp-links' },
    h('div', { class: 'ml-head' },
      h('div', { class: 'ml-title' },
        h('h3', null,
          h('span', { class: 'rt-ico', html: icon('link', 14) }),
          '外部平台链接状态',
          h('span', { class: 'ml-tag' }, 'MCP')),
        h('p', { class: 'mcp-note' },
          '外部 AI 助手经标准接口接入时，这里显示真实连接、握手自报的客户端身份与调用情况，'
          + '并可在本机直接管理接入权限。')),
      h('div', { class: 'ml-head-acts' },
        h('button', {
          class: 'btn ghost mini', title: '立即刷新链接状态',
          onclick: () => { refresh().catch(() => {}); },
        }, '刷新'),
        h('button', {
          class: 'btn ghost mini', title: '打开链接登记目录',
          onclick: async () => {
            const r = await api.mcpLinks.reveal();
            if (r?.ok === false) toast(r.error || '打开目录失败', 'err');
            else toast('已在文件管理器中打开链接登记目录', 'ok');
          },
        }, '登记目录'))),
    body);

  let data = null;
  let gen = 0;
  let timer = null;
  let autoOn = true;
  let busy = false;
  let expanded = new Set();

  const hasApi = !!(api && api.mcpLinks && api.mcpLinks.list);

  async function call(action, okMsg) {
    if (busy) return null;
    busy = true;
    try {
      const r = await action();
      if (r?.ok === false) { toast(r.error || '操作失败', 'err'); return null; }
      if (r?.data) data = r.data;
      if (okMsg) toast(okMsg, 'ok');
      draw();
      return r;
    } catch (e) {
      toast('操作失败：' + String(e?.message || e), 'err', 4200);
      return null;
    } finally { busy = false; }
  }

  async function refresh() {
    if (!hasApi) { draw(); return; }
    const my = ++gen;
    try {
      const r = await api.mcpLinks.list();
      if (my !== gen) return;
      if (r?.ok === false) { data = { __error: r.error || '读取链接状态失败' }; }
      else data = r?.data || null;
      draw();
    } catch (e) {
      if (my !== gen) return;
      data = { __error: String(e?.message || e) };
      draw();
    }
  }

  function togglePlatform(p) {
    const cur = data?.policy?.blockedPlatforms || [];
    const next = cur.includes(p.platformKey)
      ? cur.filter((k) => k !== p.platformKey)
      : [...cur, p.platformKey];
    return call(() => api.mcpLinks.setPolicy({ blockedPlatforms: next }),
      cur.includes(p.platformKey) ? `已允许「${p.platformLabel}」接入` : `已禁用「${p.platformLabel}」接入`);
  }

  function rename(p) {
    modal({
      title: '设置平台备注',
      message: `给「${p.platformOfficial || p.platformLabel}」设置一个你认得的名称。留空恢复官方名称。`,
      fields: [{ key: 'label', label: '显示名称', value: p.alias || '', placeholder: '例如：办公室电脑上的助手' }],
      confirmText: '保存', danger: false,
    }).then((v) => {
      if (!v) return;
      call(() => api.mcpLinks.alias({ key: p.platformKey, label: String(v.label || '').trim() }), '已更新平台备注');
    }).catch(() => {});
  }

  function sessionRow(s) {
    const tools = Object.entries(s.tools || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return h('div', { class: 'ml-session' },
      h('div', { class: 'ml-s-top' },
        h('span', { class: 'ml-dot ' + (s.state || 'offline') }),
        h('b', null, `${s.clientName || s.callerLabel || '未知客户端'}${s.clientVersion ? ' ' + s.clientVersion : ''}`),
        h('span', { class: 'ml-sid', title: s.sid }, `会话 ${String(s.sid || '').slice(0, 10)}…`),
        h('span', { class: 'ml-state ' + (s.state || 'offline') }, STATE_TEXT[s.state] || s.state),
        s.online ? h('button', {
          class: 'btn ghost mini warn-text', title: '断开该会话（stdio 通道会真实关闭）',
          onclick: async () => {
            const go = await confirmDialog({
              title: '断开该连接',
              message: `将断开 ${s.platformLabel} 的会话 ${String(s.sid).slice(0, 10)}…（PID ${s.pid}）。\n`
                + '该 MCP Server 进程会在数秒内结束，宿主需要重新建立连接才能继续接入。',
              confirmText: '断开连接',
            });
            if (go) call(() => api.mcpLinks.revoke({ sid: s.sid }), '已下发断开指令');
          },
        }, '断开') : null,
        h('button', {
          class: 'btn ghost mini danger-text', title: '移除该会话登记（防止心跳复活）',
          onclick: async () => {
            const go = await confirmDialog({
              title: '移除该会话',
              message: `将删除会话 ${String(s.sid).slice(0, 10)}… 的登记并禁止其重新写入。\n`
                + '这比"断开"更彻底：即使进程仍在心跳，也不会再出现在列表里。',
              confirmText: '移除会话',
            });
            if (go) call(() => api.mcpLinks.remove({ scope: 'session', sids: [s.sid] }), '已移除该会话登记');
          },
        }, '移除')),
      h('div', { class: 'ml-s-grid' },
        h('span', null, `PID ${s.pid || '—'}`),
        h('span', null, `协议 ${s.protocolVersion || '未协商'}`),
        h('span', null, `启动 ${timeText(s.startedAt)}`),
        h('span', null, `最近活动 ${timeText(s.lastSeenAt)}`),
        h('span', null, `调用 ${num(s.requests)} 次`),
        h('span', null, `错误 ${num(s.errors)}`),
        s.blockedCount ? h('span', { class: 'ml-warn' }, `被拦截 ${num(s.blockedCount)}`) : null,
        s.serverVersion ? h('span', null, `引擎 v${s.serverVersion}`) : null),
      s.vault ? h('div', { class: 'ml-s-vault', title: s.vault }, `知识库：${s.vault}`) : null,
      s.sedimentVault ? h('div', { class: 'ml-s-vault', title: s.sedimentVault }, `沉淀库：${s.sedimentVault}`) : null,
      tools.length ? h('div', { class: 'ml-tools' },
        ...tools.map(([name, count]) => h('span', { class: 'ml-tool' }, `${name} ×${num(count)}`))) : null,
      s.stateReason ? h('div', { class: 'ml-s-reason' }, s.stateReason) : null);
  }

  function platformCard(p) {
    const blocked = p.blocked || (data?.policy?.blockedPlatforms || []).includes(p.platformKey);
    const open = expanded.has(p.platformKey);
    const dotState = p.online > 0 ? (blocked ? 'blocked' : 'online') : 'offline';
    const card = h('div', { class: 'ml-platform' },
      h('div', { class: 'ml-p-head' },
        h('span', { class: 'ml-dot ' + dotState }),
        h('span', { class: 'ml-p-badge ' + toneOf(p.platformKey) }, String(p.platformLabel || '未知')[0] || '?'),
        h('div', { class: 'ml-p-name' },
          h('b', null, p.platformLabel || p.platformKey),
          p.alias ? h('span', { class: 'ml-alias' }, `原名 ${p.platformOfficial || p.platformKey}`) : null,
          h('div', { class: 'ml-p-sub' },
            h('span', { class: 'ml-source' }, SOURCE_TEXT[p.identitySource] || '未上报身份'),
            p.callerLabel ? h('span', null, `声明宿主 ${p.callerLabel}`) : null,
            ...(p.clients || []).slice(0, 2).map((c) => h('span', { class: 'ml-client' }, c)))),
        h('div', { class: 'ml-p-stats' },
          h('span', { class: 'ml-num' }, `${p.online}/${p.total}`), h('small', null, '在线/会话'),
          h('span', { class: 'ml-num' }, num(p.requests)), h('small', null, '调用'),
          h('span', { class: 'ml-time' }, timeText(p.lastSeenAt))),
        h('div', { class: 'ml-p-acts' },
          h('button', {
            class: 'btn ghost mini' + (blocked ? ' is-on' : ''),
            title: blocked ? '恢复该平台接入' : '禁用该平台接入（后续工具调用会被真实拒绝）',
            onclick: async () => {
              if (!blocked) {
                const go = await confirmDialog({
                  title: '禁用平台接入',
                  message: `禁用「${p.platformLabel}」后，该平台的 MCP 工具调用会被真实拒绝（握手仍可建立，便于你看到它在尝试接入）。可随时恢复。`,
                  confirmText: '禁用接入',
                });
                if (!go) return;
              }
              togglePlatform(p);
            },
          }, blocked ? '已禁用 · 恢复' : '禁用接入'),
          h('button', { class: 'btn ghost mini', title: '设置平台备注', onclick: () => rename(p) }, '备注'),
          h('button', {
            class: 'btn ghost mini', title: open ? '收起会话明细' : '展开会话明细',
            onclick: () => { if (open) expanded.delete(p.platformKey); else expanded.add(p.platformKey); draw(); },
          }, open ? '收起' : `明细 ${p.total}`),
          // v6.35.0：移除接入——真实删除该平台全部会话登记并写墓碑防止心跳复活。
          h('button', {
            class: 'btn ghost mini danger-text', title: '移除该平台的接入登记（含在线会话）',
            onclick: async () => {
              const go = await confirmDialog({
                title: '移除接入',
                message: `将移除「${p.platformLabel}」的全部 ${p.total} 条接入登记，并断开其在线会话。\n`
                  + '该平台再用 MCP 连接时不会自动出现在列表里（防止在线进程心跳把记录写回来）。\n'
                  + '如需重新接入，可在「登记目录」的策略里撤销移除，或重启宿主重新连接后手动恢复。',
                confirmText: '确认移除',
                danger: true,
              });
              if (go) call(() => api.mcpLinks.remove({ scope: 'platform', platformKey: p.platformKey }),
                `已移除「${p.platformLabel}」的接入`);
            },
          }, '移除接入'))),
      p.blockedCount ? h('div', { class: 'ml-p-warn' }, `累计拦截 ${num(p.blockedCount)} 次调用`) : null,
      // v6.35.0：每个会话的知识库单独成行（带会话头），不再把多个库的路径
      // 用 ' · ' 拼成一行——那会在视觉上变成 `库A\库B` 的"嵌套盘符"假象。
      ...p.sessions.filter((s) => s.vault).map((s) => h('div', {
        class: 'ml-s-vault', title: s.vault,
      }, `${String(s.sid || '').slice(0, 8)} · 知识库：${s.vault}`)),
      open ? h('div', { class: 'ml-sessions' }, ...p.sessions.map(sessionRow)) : null);
    return card;
  }

  function draw() {
    body.innerHTML = '';
    if (!hasApi) {
      body.appendChild(h('div', { class: 'ml-empty' },
        h('b', null, '当前客户端不支持链接状态'),
        h('p', null, '请安装 v6.23.1 或更新版本后重试。')));
      return;
    }
    if (!data) {
      body.appendChild(h('div', { class: 'ml-empty' }, '正在读取真实链接状态…'));
      return;
    }
    if (data.__error) {
      body.appendChild(h('div', { class: 'ml-empty' },
        h('b', null, '读取链接状态失败'),
        h('p', null, data.__error),
        h('button', { class: 'btn ghost mini', onclick: () => { data = null; refresh().catch(() => {}); } }, '重试')));
      return;
    }

    const sum = data.summary || {};
    const policy = data.policy || {};
    // 概览：数值全部来自真实会话文件，没有任何预置值
    body.appendChild(h('div', { class: 'ml-stats' },
      h('div', { class: 'ml-stat' }, h('b', null, String(sum.onlinePlatforms || 0)), h('span', null, '在线平台')),
      h('div', { class: 'ml-stat' }, h('b', null, String(sum.onlineSessions || 0)), h('span', null, '活跃会话')),
      h('div', { class: 'ml-stat' }, h('b', null, String(sum.totalPlatforms || 0)), h('span', null, '累计平台')),
      h('div', { class: 'ml-stat' }, h('b', null, num(sum.totalRequests)), h('span', null, '累计调用')),
      h('div', { class: 'ml-stat' + (sum.paused ? ' is-warn' : '') },
        h('b', null, sum.paused ? '已暂停' : '正常'), h('span', null, '全局接入'))));

    // 工具栏：全局管理 + 自动刷新 + 目录说明
    body.appendChild(h('div', { class: 'ml-toolbar' },
      h('button', {
        class: 'btn mini' + (sum.paused ? '' : ' ghost'),
        title: sum.paused ? '恢复全部平台的 MCP 接入' : '暂停全部平台的 MCP 工具调用',
        onclick: async () => {
          if (!sum.paused) {
            const go = await confirmDialog({
              title: '暂停全部 MCP 接入',
              message: '暂停后，所有外部平台的 MCP 工具调用会被真实拒绝；已建立的握手仍会显示在这里，便于你确认是哪些平台在尝试接入。',
              confirmText: '暂停全部',
            });
            if (!go) return;
          }
          call(() => api.mcpLinks.setPolicy({ paused: !sum.paused }), sum.paused ? '已恢复全部接入' : '已暂停全部接入');
        },
      }, sum.paused ? '恢复全部接入' : '暂停全部接入'),
      h('button', {
        class: 'btn ghost mini' + (autoOn ? ' is-on' : ''), title: '每 5 秒自动刷新链接状态',
        onclick: () => {
          autoOn = !autoOn;
          if (autoOn) startTimer(); else stopTimer();
          toast(autoOn ? '已开启自动刷新' : '已暂停自动刷新', 'ok');
          draw();
        },
      }, autoOn ? '自动刷新 · 开' : '自动刷新 · 关'),
      h('button', {
        class: 'btn ghost mini', title: '清除已结束的历史会话记录（在线会话保留）',
        onclick: async () => {
          const go = await confirmDialog({
            title: '清除历史记录',
            message: '只删除已结束 / 进程已退出的会话记录，当前在线的连接不会被清除。',
            confirmText: '清除历史',
          });
          if (go) call(() => api.mcpLinks.clear(), '已清除历史会话记录');
        },
      }, '清除历史'),
      h('button', {
        class: 'btn ghost mini', title: '复制链接登记目录路径',
        onclick: async () => { await copyToClipboard(data.dir || '', '已复制链接登记目录'); },
      }, '复制目录'),
      (policy.blockedPlatforms || []).length
        ? h('button', {
          class: 'btn ghost mini', title: '解除所有平台的禁用',
          onclick: () => call(() => api.mcpLinks.setPolicy({ blockedPlatforms: [] }), '已解除全部平台禁用'),
        }, `解除 ${policy.blockedPlatforms.length} 项禁用`) : null,
      // v10.18.8：这些记录只来自用户自己点过的「移除接入」，不是开发残留。
      // 旧文案「恢复 N 项移除」容易被误读成程序自带的历史包袱，改为明确来源的「撤销记录」。
      ((policy.removedPlatforms || []).length + (policy.removedSessions || []).length)
        ? h('button', {
          class: 'btn ghost mini', title: '撤销本机历史「移除接入」留下的记录（非程序自带数据）',
          onclick: async () => {
            const n = (policy.removedPlatforms || []).length + (policy.removedSessions || []).length;
            const go = await confirmDialog({
              title: '撤销历史移除记录',
              message: `当前有 ${n} 条移除记录，全部来自你此前在本面板点过的「移除接入」，`
                + '用于阻止被移除的宿主被在线心跳重新登记，并非开发残留。\n'
                + '撤销后，仍在线的宿主会在下一次心跳重新登记；如宿主已关闭，重新连接一次即可。',
              confirmText: '撤销记录',
            });
            if (go) call(() => api.mcpLinks.restore({}), '已撤销全部历史移除记录');
          },
        }, `撤销 ${(policy.removedPlatforms || []).length + (policy.removedSessions || []).length} 条移除记录`) : null));

    // 平台列表 / 空态
    if (!data.platforms || !data.platforms.length) {
      body.appendChild(h('div', { class: 'ml-empty' },
        h('div', { class: 'ml-empty-ico', html: icon('link', 22) }),
        h('b', null, '还没有外部平台通过 MCP 接入'),
        h('p', null, '在下方「① 回写通道」选择接入形态、生成并复制接入配置，'
          + '把它注册到你的外部 AI 助手后，让助手发起一次连接。'
          + '连接建立后，这里会显示握手自报的真实客户端身份与实时状态。'),
        h('p', { class: 'ml-hint' }, '提示：已接入过的平台重启宿主或重连一次，即会升级为可识别的新连接。')));
    } else {
      const list = h('div', { class: 'ml-platforms' });
      for (const p of data.platforms) list.appendChild(platformCard(p));
      body.appendChild(list);
    }

    body.appendChild(h('div', { class: 'ml-foot' },
      h('span', null, `数据来源：本机真实连接登记 · ${data.dir || '—'}`),
      h('span', null, `基于最近 ${data.recorded || 0} 条会话记录 · 心跳 ${Math.round((data.staleMs || 20000) / 1000)} 秒判定在线`),
      h('span', null, '管理动作写入策略文件，由 MCP Server 每次请求读取并真实执行'),
      h('span', null, '移除记录只来自你点过的「移除接入」；无记录时不显示撤销按钮。')));
  }

  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function startTimer() {
    stopTimer();
    if (!autoOn) return;
    timer = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, REFRESH_MS);
  }
  function start() { draw(); refresh().catch(() => {}); startTimer(); }
  function stop() { stopTimer(); try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch { /* ignore */ } }

  return { el, start, stop, refresh };
}

export default createLinksPanel;
