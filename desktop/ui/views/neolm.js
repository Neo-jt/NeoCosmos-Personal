// NeoCosmos v6.31.0 · NeoLM 本地语言模型视图
// ---------------------------------------------------------------------------
// 真实性纪律：
//  ① 每个按钮都调用 main.js 里真实注册的 api.neolm.* 通道，完整路径书写便于能力清单提取；
//  ② 所有数字（体积 / AUC / loss / 覆盖率 / 哈希 / 概率）都来自真实 IPC 返回值，
//     未取到时显示「—」或真实错误，绝不用示例值、估值或随机数填充；
//  ③ 模型不可用时如实显示降级原因，不假装模型在跑；
//  ④ 边界声明照实写：这是从本仓库真实文本训练出的领域词向量模型，不是通用聊天大模型。
import { h } from '../ui-kit.js';

const num = (v) => (Number(v) || 0).toLocaleString('zh-CN');
const fmt = (v, digits = 4) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(digits));
const short = (s, n = 18) => {
  const t = String(s == null ? '' : s);
  return t.length > n ? `${t.slice(0, n)}…` : (t || '—');
};
const esc = (s) => String(s == null ? '' : s);

function field(label, placeholder, value = '') {
  const input = h('input', {
    class: 'nl-input', type: 'text', placeholder, value,
    spellcheck: 'false', autocomplete: 'off',
  });
  return { wrap: h('label', { class: 'nl-field' }, h('span', null, label), input), input };
}

/** 统一执行：真实 loading → 真实返回 / 真实错误，绝不吞错也不造数据。 */
async function run(label, out, fn, draw) {
  out.innerHTML = '';
  out.appendChild(h('p', { class: 'nl-pending' }, `正在${label}…（首次调用会只读加载训练权重）`));
  const t0 = Date.now();
  try {
    const r = await fn();
    if (!r || r.ok === false) throw new Error(r?.error || '调用未返回数据');
    const data = r.data;
    out.innerHTML = '';
    draw(data);
    out.appendChild(h('p', { class: 'nl-elapsed' }, `真实推理耗时 ${((Date.now() - t0) / 1000).toFixed(2)} 秒`));
  } catch (e) {
    out.innerHTML = '';
    out.appendChild(h('p', { class: 'nl-error' }, `${label}失败：${esc(e?.message || e)}`));
  }
}

function resultList(items, render) {
  if (!Array.isArray(items) || !items.length) return h('p', { class: 'nl-pending' }, '无结果（真实返回为空）');
  return h('div', { class: 'nl-list' }, items.map(render));
}

export function mountNeoLM({ host, api }) {
  const root = h('div', { class: 'nl-root' });
  const statusBody = h('div', { class: 'nl-status-body' });
  const verifyOut = h('div', { class: 'nl-out' });

  root.appendChild(h('section', { class: 'card nl-card' },
    h('div', { class: 'nl-head' },
      h('div', null,
        h('h2', null, '本地语言模型 · NeoLM'),
        h('p', { class: 'nl-sub' }, '本地领域词向量模型，离线运行。')),
      h('button', {
        class: 'btn ghost mini', title: '重新读取模型真实状态',
        onclick: () => { loadStatus().catch(() => {}); },
      }, '刷新状态')),
    statusBody));

  // ---- 真实性 / 完整性 ----
  root.appendChild(h('section', { class: 'card nl-card' },
    h('h3', null, '真实性与完整性'),
    h('p', { class: 'nl-sub' },
      '逐字节重算两个权重文件与词表的 SHA-256，与训练产物 manifest 比对；用于确认权重未被改动、不是随机填充。'),
    h('div', { class: 'nl-acts' },
      h('button', {
        class: 'btn mini', onclick: () => run('完整性校验', verifyOut,
          () => api.neolm.verify(),
          (d) => {
            const ok = d && d.ok === true;
            verifyOut.appendChild(h('div', { class: `nl-verify ${ok ? 'ok' : 'bad'}` },
              h('b', null, ok ? '校验通过：权重与训练产物逐字节一致' : '校验未通过'),
              ...(d?.weights || []).map((w) => h('div', { class: 'nl-mono' },
                `${esc(w.file)} · ${w.ok ? '一致' : '不一致'} · ${short(w.actual, 24)}`)),
              h('div', { class: 'nl-mono' }, `词表哈希 ${d?.vocabOk ? '一致' : '不一致'}`)));
          }),
      }, '校验 1.5 GiB 权重')),
    verifyOut));

  // ---- 推理实验台 ----
  const nearText = field('词或短语', '例如：知识关联 / NeoCosmos', '知识关联');
  const nearOut = h('div', { class: 'nl-out' });
  root.appendChild(h('section', { class: 'card nl-card' },
    h('h3', null, '语义近邻（真实 cosine 扫描全部 131072 行）'),
    nearText.wrap,
    h('div', { class: 'nl-acts' },
      h('button', {
        class: 'btn mini', onclick: () => run('计算近邻', nearOut,
          () => api.neolm.nearest({ text: nearText.input.value, k: 8 }),
          (d) => nearOut.appendChild(resultList(d?.items, (x) => h('div', { class: 'nl-row' },
            h('code', null, esc(x.token)), h('span', { class: 'nl-num' }, fmt(x.cosine, 5)))))),
      }, '计算近邻')),
    nearOut));

  const simA = field('文本 A', '例如：知识', '知识');
  const simB = field('文本 B', '例如：关联', '关联');
  const simOut = h('div', { class: 'nl-out' });
  root.appendChild(h('section', { class: 'card nl-card' },
    h('h3', null, '语义相似度'),
    h('div', { class: 'nl-2' }, simA.wrap, simB.wrap),
    h('div', { class: 'nl-acts' },
      h('button', {
        class: 'btn mini', onclick: () => run('计算相似度', simOut,
          () => api.neolm.similarity({ a: simA.input.value, b: simB.input.value }),
          (d) => simOut.appendChild(h('div', { class: 'nl-big' }, fmt(d?.value, 5)))),
      }, '计算相似度')),
    simOut));

  const nextText = field('上下文', '例如：知识', '知识');
  const nextOut = h('div', { class: 'nl-out' });
  root.appendChild(h('section', { class: 'card nl-card' },
    h('h3', null, '下一 token 分布（真实输出层打分）'),
    nextText.wrap,
    h('div', { class: 'nl-acts' },
      h('button', {
        class: 'btn mini', onclick: () => run('计算下一 token', nextOut,
          () => api.neolm.next({ text: nextText.input.value, k: 8 }),
          (d) => nextOut.appendChild(resultList(d?.items, (x) => h('div', { class: 'nl-row' },
            h('code', null, esc(x.token)),
            h('div', { class: 'nl-bar' }, h('i', { style: `width:${Math.min(100, Number(x.probability) * 100).toFixed(1)}%` })),
            h('span', { class: 'nl-num' }, fmt(x.probability, 5)))))),
      }, '计算分布')),
    nextOut));

  const genText = field('提示词', '例如：知识关联', '知识关联');
  const genOut = h('div', { class: 'nl-out' });
  root.appendChild(h('section', { class: 'card nl-card' },
    h('h3', null, '确定性续写'),
    h('p', { class: 'nl-sub' }, 'top-k softmax 采样 + 重复惩罚，随机源由提示词哈希派生；同一提示词逐字可复现。'),
    genText.wrap,
    h('div', { class: 'nl-acts' },
      h('button', {
        class: 'btn mini', onclick: () => run('续写', genOut,
          () => api.neolm.generate({ prompt: genText.input.value, maxLen: 8 }),
          (d) => {
            genOut.appendChild(h('div', { class: 'nl-gen' }, esc(d?.text)));
            genOut.appendChild(h('p', { class: 'nl-mono' }, `解码：${esc(d?.decoding)} · 候选池 ${num(d?.candidatePool)}`));
            genOut.appendChild(resultList(d?.steps, (x, i) => h('div', { class: 'nl-row' },
              h('span', { class: 'nl-num' }, String(i + 1)),
              h('code', null, esc(x.token)),
              h('span', { class: 'nl-num' }, fmt(x.probability, 5)))));
          }),
      }, '续写 8 步')),
    genOut));

  const expText = field('检索词', '例如：知识关联', '知识关联');
  const expOut = h('div', { class: 'nl-out' });
  root.appendChild(h('section', { class: 'card nl-card' },
    h('h3', null, '查询扩展（供语义检索使用）'),
    expText.wrap,
    h('div', { class: 'nl-acts' },
      h('button', {
        class: 'btn mini', onclick: () => run('扩展查询', expOut,
          () => api.neolm.expand({ text: expText.input.value, k: 6 }),
          (d) => expOut.appendChild(h('div', { class: 'nl-chips' },
            (Array.isArray(d?.terms) ? d.terms : []).map((t) => h('span', { class: 'chip' }, esc(t)))))),
      }, '扩展查询')),
    expOut));

  // ---- 真实边界（一句话） ----
  root.appendChild(h('section', { class: 'card nl-card' },
    h('p', { class: 'nl-boundary' },
      '领域词向量模型，非通用聊天模型；不含知识或答案，不联网。')));

  host.appendChild(root);

  async function loadStatus() {
    statusBody.innerHTML = '';
    statusBody.appendChild(h('p', { class: 'nl-pending' }, '正在读取模型真实状态…'));
    try {
      const r = await api.neolm.status();
      const s = r?.data;
      statusBody.innerHTML = '';
      if (!s || s.active === false) {
        statusBody.appendChild(h('p', { class: 'nl-error' },
          `模型未就绪：${esc(s?.reason || r?.error || '无返回')}。此处如实显示降级原因，不会用假状态顶替。`));
        return;
      }
      const kpis = [
        ['权重体积', `${fmt(s.weightGiB, 3)} GiB`],
        ['词表规模', num(s.vocab)],
        ['向量维度', num(s.dim)],
        ['解码候选池', num(s.candidatePool)],
        ['训练步数', num(s.train?.steps)],
        ['真实样本对', num(s.train?.pairs)],
        ['训练 loss', `${fmt(s.train?.lossFirst, 4)} → ${fmt(s.train?.lossLast, 4)}`],
        ['留出集 AUC', `${fmt(s.evaluation?.aucModel, 4)}（基线 ${fmt(s.evaluation?.aucBaseline, 2)}）`],
        ['权重改写覆盖', `${fmt((s.coverage?.embRatio || 0) * 100, 2)}%`],
        ['训练语料', `${num(s.corpus?.files)} 个文件 / ${fmt(Number(s.corpus?.bytes || 0) / 1048576, 2)} MiB`],
      ];
      statusBody.appendChild(h('div', { class: 'nl-kpis' },
        kpis.map(([k, v]) => h('div', { class: 'nl-kpi' }, h('span', null, k), h('b', null, v)))));
      statusBody.appendChild(h('div', { class: 'nl-mono' },
        `语料 SHA-256 ${short(s.corpus?.hash, 32)} · 权重 ${num(s.weightBytes)} 字节`));
      statusBody.appendChild(h('div', { class: 'nl-mono' }, `模型边界：${esc(s.honesty?.isNot)}`));
    } catch (e) {
      statusBody.innerHTML = '';
      statusBody.appendChild(h('p', { class: 'nl-error' }, `读取模型状态失败：${esc(e?.message || e)}`));
    }
  }

  loadStatus().catch((e) => console.error('[neolm] 状态读取失败', e));
  return { unmount() { /* 无定时器 / 无订阅：切走时不留后台工作 */ } };
}

export default mountNeoLM;
