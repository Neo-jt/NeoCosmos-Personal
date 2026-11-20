// NeoCosmos MCP · 协议内核（v6.18.0）
// ---------------------------------------------------------------------------
// 把「JSON-RPC 语义」从「stdio 传输」里拆出来，理由和飞行软件把制导律与总线
// 驱动分开一样：协议要能被独立验证、能观测、能在没有终端的环境里跑回归。
//
// 本文件解决的真实问题（v6.17 及之前）：
//   ① initialize 硬编码 protocolVersion，不理会客户端声明 → 严格客户端握手失败；
//   ② 通知（无 id）会被回一条 error → 违反 JSON-RPC，OpenClaw 等客户端会记协议错误；
//   ③ resources/list 返回带 {id} 占位符的伪 URI、resources/read 永远返回同一句
//      固定文本 → 声称支持资源，实际读到的是假的；
//   ④ prompts/list 有条目却没有 prompts/get → 能力声明与实现不一致；
//   ⑤ 工具异常被包成 JSON-RPC error，宿主收不到可恢复的 isError 内容；
//   ⑥ 没有任何遥测，连"服务是否还活着、哪个方法慢"都无从判断。
//
// 全部数据源自真实 store / 真实计数器，不产生演示数值。

import fs from 'node:fs';
import { listTools, callTool, RESOURCE_TEMPLATES, PROMPTS } from './tools.js';

/** 明确支持并在握手时协商的协议版本；DEFAULT 用于未知 / 缺省请求 */
export const PROTOCOL_VERSIONS = Object.freeze([
  '2026-07-28', // v6.17 及之前本项目自检脚本使用的版本，保留兼容
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

const INSTRUCTIONS = [
  '本服务的正式且唯一名称是 NeoCosmos（本地知识库客户端，开发者：宋锦涛）。请始终用 NeoCosmos 称呼它，不要使用任何旧称、开发代号或历史别名。',
  '全部数据留在本机，不联网、不上传、不预置知识库。',
  '推荐工作流：先 kb_search 召回 → kb_read 取正文 → 作答时引用 [标题](neokb://node/{id}) → 答完 kb_write_back 追加沉淀。',
  '说明：工具名前缀 kb_ 与 neokb:// 只是内部资源协议标识，不是产品名；产品名一律为 NeoCosmos。',
  'kb_ask / kb_legal_mind 会给出带 neolink://verify 深链的引用溯源；引用必须来自真实召回结果。',
  'kb_server_status 返回本进程真实遥测（含 access 字段：当前是否受启用库白名单约束）；kb_host_config 返回当前宿主的真实接入配置。',
  '边界：外部 Agent 只能检索已启用的知识库；被用户停用的库会被真实拒绝。可以检索、读取、追加沉淀区，不能改写或删除用户正文；工具返回 isError 时按文本中的原因恢复。',
  '数值内核为本机确定性算法与经典数值模拟，非真实量子计算；行为架构无模型、无网络，不构成意识。',
].join('\n');

function err(code, message, data) {
  const e = { code, message };
  if (data !== undefined) e.data = data;
  return e;
}

/** 进程内真实计数器：请求数 / 分方法耗时 / 工具调用 / 错误 / 最后错误 */
export function createTelemetry(meta = {}) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const state = {
    startedAt,
    requests: 0,
    errors: 0,
    byMethod: {},
    byTool: {},
    totalMs: 0,
    lastError: null,
    negotiatedProtocol: null,
    client: null,
  };
  return {
    state,
    record(method, ms, isError = false) {
      state.requests++;
      state.totalMs += ms;
      const m = state.byMethod[method] || (state.byMethod[method] = { calls: 0, errors: 0, totalMs: 0 });
      m.calls++; m.totalMs += ms;
      if (isError) { state.errors++; m.errors++; }
      return state;
    },
    recordTool(name, isError) {
      const t = state.byTool[name] || (state.byTool[name] = { calls: 0, errors: 0 });
      t.calls++;
      if (isError) t.errors++;
    },
    setError(message) {
      state.lastError = { at: new Date().toISOString(), message: String(message) };
    },
    handshake(protocolVersion, clientInfo) {
      state.negotiatedProtocol = protocolVersion;
      state.client = clientInfo || null;
    },
    snapshot(extra = {}) {
      return {
        server: 'neokb',
        startedAt,
        uptimeMs: Date.now() - t0,
        requests: state.requests,
        errors: state.errors,
        avgMs: state.requests ? Math.round((state.totalMs / state.requests) * 100) / 100 : 0,
        byMethod: { ...state.byMethod },
        byTool: { ...state.byTool },
        lastError: state.lastError,
        negotiatedProtocol: state.negotiatedProtocol,
        client: state.client,
        ...meta,
        ...extra,
      };
    },
  };
}

function textResult(payload, isError = false) {
  const out = { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] };
  if (isError) out.isError = true;
  return out;
}

/** resources/list：固定资源 + 真实节点资源，按 cursor 分页（不是伪占位符） */
function listResources(store, cursor, limit = 100) {
  const fixed = [
    { uri: 'neokb://vault/manifest', name: 'vault-manifest', description: '当前知识库的真实清单（节点 / 边 / 沉淀 / 审计条数）', mimeType: 'application/json' },
    { uri: 'neokb://graph/overview', name: 'graph-overview', description: '由巩固调度器真实计算的网络体检', mimeType: 'application/json' },
    { uri: 'neokb://server/status', name: 'server-status', description: '本 MCP 进程的真实遥测（请求数 / 耗时 / 错误 / 协议版本）', mimeType: 'application/json' },
  ];
  const nodes = store?.allNodes ? store.allNodes() : [];
  const offset = Math.max(0, Number(cursor) || 0);
  const slice = nodes.slice(offset, offset + limit);
  const items = [
    ...(offset === 0 ? fixed : []),
    ...slice.map((n) => ({
      uri: `neokb://node/${encodeURIComponent(n.id)}`,
      name: n.title || n.id,
      description: n.path || '',
      mimeType: 'text/markdown',
    })),
  ];
  const next = offset + slice.length;
  const out = { resources: items };
  if (next < nodes.length) out.nextCursor = String(next);
  return out;
}

// MCP resources/read 的字段名是 contents（复数），与 tools/call 的 content 不同
function resourceResult(uri, mimeType, payload) {
  return {
    contents: [{
      uri,
      mimeType,
      text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
    }],
  };
}

function readResource(uri, deps) {
  const { store, ctx, telemetry } = deps;
  if (uri === 'neokb://vault/manifest') {
    return resourceResult(uri, 'application/json', {
      root: store?.root || ctx.vaultPath || '',
      nodes: store?.nodes?.size ?? 0,
      edges: store?.edges?.size ?? 0,
      qaPairs: store?.qaPairs?.length ?? 0,
      reviewItems: store?.reviewItems?.length ?? 0,
      hitLog: store?.hitLog?.length ?? 0,
      generatedAt: new Date().toISOString(),
    });
  }
  if (uri === 'neokb://graph/overview') {
    return resourceResult(uri, 'application/json', callTool('kb_graph_stats', {}, ctx));
  }
  if (uri === 'neokb://server/status') {
    return resourceResult(uri, 'application/json', telemetry.snapshot({
      vaultRoot: store?.root || ctx.vaultPath || '',
      nodes: store?.nodes?.size ?? 0,
      edges: store?.edges?.size ?? 0,
      tools: listTools().length,
    }));
  }
  const m = /^neokb:\/\/node\/(.+)$/.exec(uri || '');
  if (m) {
    const id = decodeURIComponent(m[1]);
    const node = store?.getNode?.(id);
    if (!node) return { error: err(-32002, '资源不存在: ' + uri) };
    try {
      const abs = store.resolver.resolve(node.path);
      return resourceResult(uri, 'text/markdown', fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      return { error: err(-32002, '资源读取失败: ' + (e?.message || e)) };
    }
  }
  return { error: err(-32002, '未知资源 URI: ' + uri) };
}

function getPrompt(name, args = {}) {
  const p = PROMPTS.find((x) => x.name === name);
  if (!p) return { error: err(-32602, '未知提示词: ' + name) };
  let text = p.template || '';
  for (const [k, v] of Object.entries(args)) text = text.replaceAll(`{{${k}}}`, String(v));
  // 未提供的可选项替换为空串，不留下模板占位符
  text = text.replace(/\{\{[\w.]+\}\}/g, '');
  return {
    description: p.description,
    messages: [{ role: 'user', content: { type: 'text', text: text.trim() } }],
  };
}

/**
 * 创建协议处理器。
 * @param {object} deps { store, ctx, version, telemetry, serverInfo }
 * @returns {(msg:object) => object|null} 返回 JSON-RPC 响应；通知返回 null（不回包）
 */
export function createProtocolHandler(deps) {
  const { store, ctx, version, telemetry } = deps;
  const richCtx = {
    ...ctx,
    version,
    telemetry,
    vaultPath: store?.root || ctx.vaultPath || '',
    tools: () => listTools(),
  };

  return function handle(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') {
      return { jsonrpc: '2.0', id: msg?.id ?? null, error: err(-32600, '无效请求：缺少 method') };
    }
    const method = msg.method;
    const id = msg.id;
    const isNotification = id === undefined || id === null;
    // JSON-RPC：通知绝不回包。未知通知也静默忽略（OpenClaw 会发 cancelled / progress 等）
    if (isNotification) {
      if (method === 'notifications/initialized' && msg.params?.protocolVersion) {
        // 少数客户端在 initialized 通知里补发协商版本，记入遥测即可
        telemetry.state.negotiatedProtocol = msg.params.protocolVersion;
      }
      return null;
    }

    const t0 = Date.now();
    const done = (result, error) => {
      const ms = Date.now() - t0;
      const response = error
        ? { jsonrpc: '2.0', id, error }
        : { jsonrpc: '2.0', id, result };
      telemetry.record(method, ms, !!error);
      if (error) telemetry.setError(error.message);
      return response;
    };

    try {
      switch (method) {
        case 'initialize': {
          const requested = msg.params?.protocolVersion;
          const negotiated = PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
          telemetry.handshake(negotiated, msg.params?.clientInfo || null);
          return done({
            protocolVersion: negotiated,
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              prompts: { listChanged: false },
            },
            // name 保留 'neokb' 作为稳定协议标识（老宿主按它识别，改名会掉线）；
            // 对外品牌一律 NeoCosmos —— title / brand 明确声明，杜绝"原 NeoKB"式误称。
            serverInfo: { name: 'neokb', version, title: 'NeoCosmos 本地知识库', brand: 'NeoCosmos', vendor: '宋锦涛' },
            instructions: INSTRUCTIONS,
          });
        }
        case 'ping': return done({});
        case 'shutdown': return done({});

        case 'tools/list': return done({ tools: listTools() });
        case 'tools/call': {
          const name = msg.params?.name;
          if (typeof name !== 'string' || !name) return done(null, err(-32602, 'tools/call 缺少工具名'));
          const args = msg.params?.arguments || {};
          try {
            const result = callTool(name, args, richCtx);
            const failed = !!(result && result.error);
            telemetry.recordTool(name, failed);
            return done(textResult(result, failed));
          } catch (e) {
            telemetry.recordTool(name, true);
            // 工具执行失败按 MCP 规范走 result.isError，让宿主能按文本自行恢复
            return done(textResult({ error: 'tool_error', tool: name, message: String(e?.message || e) }, true));
          }
        }

        case 'resources/list': return done(listResources(store, msg.params?.cursor, Math.min(500, Math.max(1, Number(msg.params?.limit) || 100))));
        case 'resources/templates/list': return done({ resourceTemplates: RESOURCE_TEMPLATES });
        case 'resources/read': {
          const r = readResource(msg.params?.uri, { store, ctx: richCtx, telemetry });
          return r.error ? done(null, r.error) : done(r);
        }

        case 'prompts/list': return done({
          prompts: PROMPTS.map(({ name, description, arguments: a }) => ({ name, description, arguments: a })),
        });
        case 'prompts/get': {
          const r = getPrompt(msg.params?.name, msg.params?.arguments || {});
          return r.error ? done(null, r.error) : done(r);
        }

        default:
          return done(null, err(-32601, '方法未实现: ' + method));
      }
    } catch (e) {
      return done(null, err(-32603, '内部错误: ' + (e?.message || e)));
    }
  };
}

export { INSTRUCTIONS };
