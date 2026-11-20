// NeoCosmos v6.38.0 · 工作台收藏夹（原创增强视图）
// ---------------------------------------------------------------------------
// 真实性纪律：
//   ① 列表项全部来自 card-tools 记录的真实 id，再经 api.doc.allTree 解析标题；
//      已失效/被删的 id 如实显示「卡片已不存在」，绝不臆造标题；
//   ② 星标与近期是本机偏好（localStorage），不写知识库、不联网、不上传；
//   ③ 每个按钮都做真事：打开卡片 / 取消星标 / 清空近期。
//
//  设计说明：这是"收藏夹 + 最近打开"两项通用能力的原创合并视图，
//  视觉与交互均为本项目自有，未复制任何第三方产品实现。
// ---------------------------------------------------------------------------
import { h } from '../ui-kit.js';
import { cardTools } from '../card-tools.js';

export function mountStarred({ host, app, api, toast, route, fmtTime }) {
  host.innerHTML = '';
  const page = h('div', { class: 'page starred-view' });
  host.appendChild(page);

  let fileMap = new Map();   // id -> { id, title, path, vaultId, vaultName }
  let loaded = false;

  async function loadFiles() {
    const res = await api.doc.allTree({});
    const map = new Map();
    if (res?.ok && res.data) {
      for (const v of res.data.vaults || []) {
        const walk = (node) => {
          for (const f of node.files || []) {
            if (!map.has(f.id)) {
              map.set(f.id, { ...f, vaultId: v.id, vaultName: v.name });
            }
          }
          for (const d of node.dirs || []) walk(d);
        };
        walk(v);
      }
    }
    fileMap = map;
    loaded = true;
  }

  function row(info, opts = {}) {
    const known = fileMap.get(info.id);
    const title = known?.title || '卡片已不存在';
    const path = known?.path || '';
    const isStar = cardTools.isStarred(info.id);
    const r = h('div', {
      class: 'star-row' + (known ? '' : ' is-missing'),
      tabindex: known ? '0' : '-1',
      title: known ? (path + (info.at ? `\n访问于 ${fmtTime ? fmtTime(info.at) : new Date(info.at).toLocaleString('zh-CN')}` : '')) : '该卡片已被删除或移出索引',
    },
      h('span', { class: 'star-row-ico' }, known ? '◈' : '○'),
      h('div', { class: 'star-row-main' },
        h('div', { class: 'star-row-title' }, title),
        h('div', { class: 'star-row-sub' },
          known ? `${known.vaultName || '知识库'} · ${path || '根目录'}` : '已失效的收藏记录',
        ),
      ),
      opts.recent
        ? h('button', {
            class: 'star-row-act', title: '从近期移除', 'aria-label': '从近期移除',
            onclick: (e) => { e.stopPropagation(); removeRecent(info.id); },
          }, '✕')
        : h('button', {
            class: 'star-row-act' + (isStar ? ' is-on' : ''),
            title: isStar ? '取消收藏' : '已收藏', 'aria-label': isStar ? '取消收藏' : '收藏状态',
            onclick: (e) => { e.stopPropagation(); toggle(info.id); },
          }, isStar ? '★' : '☆'),
    );
    if (known) {
      r.addEventListener('click', () => app.openCard(info.id));
      r.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') app.openCard(info.id); });
    }
    return r;
  }

  function section(title, sub, body, action) {
    return h('section', { class: 'star-sec' },
      h('div', { class: 'star-sec-head' },
        h('div', null, h('h3', null, title), h('p', null, sub)),
        action || null,
      ),
      body,
    );
  }

  function render() {
    page.innerHTML = '';
    page.appendChild(h('div', { class: 'page-head' },
      h('h2', null, '工作台 · 收藏与近期'),
      h('p', null, '你标记的重点卡片与最近翻阅轨迹，全部只存本机。'),
    ));

    const stars = cardTools.starredIds();
    const starBody = h('div', { class: 'star-list' });
    if (!stars.length) {
      starBody.appendChild(h('div', { class: 'star-empty' },
        '还没有收藏。在卡片树或正文顶部点 ☆ 即可收藏，随时回到重点。'));
    } else {
      for (const id of stars) starBody.appendChild(row({ id }));
    }
    page.appendChild(section('我的收藏', `${stars.length} 张 · 星级标记只存本机`, starBody));

    const recents = cardTools.recentIds();
    const recBody = h('div', { class: 'star-list' });
    if (!recents.length) {
      recBody.appendChild(h('div', { class: 'star-empty' }, '最近还没有打开过卡片。'));
    } else {
      for (const id of recents) recBody.appendChild(row({ id }, { recent: true }));
    }
    const clearBtn = recents.length
      ? h('button', { class: 'btn ghost', onclick: clearRecent }, '清空近期')
      : null;
    page.appendChild(section('最近打开', `${recents.length} 条 · 不影响收藏`, recBody, clearBtn));
  }

  function toggle(id) {
    const on = cardTools.toggleStar(id);
    toast(on ? '已收藏' : '已取消收藏', 'ok');
    render();
  }

  function removeRecent(id) {
    const keep = cardTools.recentIds().filter((x) => x !== id);
    // 通过 touch 重建会改时间戳，这里直接用模块接口：清空后按序回写
    cardTools.clearRecent();
    for (const x of keep.slice().reverse()) cardTools.touch(x);
    render();
  }

  function clearRecent() {
    cardTools.clearRecent();
    toast('近期轨迹已清空', 'ok');
    render();
  }

  async function refresh() {
    const done = app.beginLoad ? app.beginLoad() : null;
    try {
      if (!loaded) await loadFiles();
      render();
    } catch (e) {
      page.innerHTML = '';
      page.appendChild(h('div', { class: 'star-empty' }, `读取失败：${String(e?.message || e)}`));
    } finally { if (done) done(); }
  }

  refresh();
  return { refresh };
}
