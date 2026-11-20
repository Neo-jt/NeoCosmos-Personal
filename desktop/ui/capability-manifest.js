// 自动生成 · 请勿手改 · 由 tools/gen-capability-manifest.mjs 从源码推导
// 同一份源码永远生成同一份字节；界面只读此清单，不手写能力列表。
export const CAPABILITY_MANIFEST = {
  "generatedBy": "tools/gen-capability-manifest.mjs",
  "coverageNote": "hub=能力中枢完整路径精确匹配；view=其它视图同名方法调用（保守口径，通用名可能高估）；none=渲染层零引用",
  "sourceHash": "82b564d9f3bc7347",
  "totals": {
    "channels": 138,
    "events": 8,
    "apis": 158,
    "hub": 68,
    "view": 88,
    "none": 2,
    "tools": 14,
    "mcpTools": 18
  },
  "groups": [
    {
      "key": "app",
      "label": "应用与窗口",
      "channels": [
        "app:init",
        "app:openExternal"
      ],
      "apis": 2
    },
    {
      "key": "api",
      "label": "本地只读 API",
      "channels": [
        "api:start",
        "api:genToken",
        "api:revealToken",
        "api:stop",
        "api:status"
      ],
      "apis": 5
    },
    {
      "key": "astra",
      "label": "星灵 · 自主引擎",
      "channels": [
        "astra:status",
        "astra:deep-status",
        "astra:deep-math",
        "astra:self-iterate",
        "astra:set-autonomous",
        "astra:tick",
        "astra:evolve",
        "astra:rollback",
        "astra:reset",
        "astra:perceive",
        "astra:audit",
        "astra:memories",
        "astra:mode",
        "astra:hold",
        "astra:home",
        "astra:click-through",
        "astra:refresh-bounds",
        "astra:hit",
        "astra:drag-start",
        "astra:drag-end",
        "astra:library:status",
        "astra:library:query",
        "astra:library:relocate",
        "astra:library:open",
        "astra:library:graph"
      ],
      "apis": 23
    },
    {
      "key": "consolidate",
      "label": "巩固",
      "channels": [
        "consolidate:run"
      ],
      "apis": 1
    },
    {
      "key": "crosskb",
      "label": "跨库管辖",
      "channels": [
        "crosskb:remoteList",
        "crosskb:add",
        "crosskb:remove",
        "crosskb:open"
      ],
      "apis": 4
    },
    {
      "key": "diag",
      "label": "诊断",
      "channels": [
        "diag:mark"
      ],
      "apis": 1
    },
    {
      "key": "doc",
      "label": "文档",
      "channels": [
        "doc:tree",
        "doc:read",
        "doc:save",
        "doc:create",
        "doc:archive",
        "doc:rename",
        "doc:export",
        "doc:relations",
        "doc:resolve"
      ],
      "apis": 9
    },
    {
      "key": "ent",
      "label": "企业安全",
      "channels": [
        "ent:securityStatus",
        "ent:recheckIntegrity",
        "ent:sedimentStatus",
        "ent:setSediment",
        "ent:sedimentList",
        "ent:verifySediment",
        "ent:syncStatus",
        "ent:syncConfigSet",
        "ent:syncNow"
      ],
      "apis": 9
    },
    {
      "key": "graph",
      "label": "关系图谱",
      "channels": [
        "graph:get"
      ],
      "apis": 1
    },
    {
      "key": "index",
      "label": "索引",
      "channels": [
        "index:rebuild"
      ],
      "apis": 1
    },
    {
      "key": "journal",
      "label": "审计日志",
      "channels": [
        "journal:tail"
      ],
      "apis": 1
    },
    {
      "key": "link",
      "label": "深链",
      "channels": [
        "link:deep",
        "link:verify",
        "link:takeDeepLink"
      ],
      "apis": 3
    },
    {
      "key": "mind",
      "label": "认知内核",
      "channels": [
        "mind:status",
        "mind:anatomy",
        "mind:autonomous",
        "mind:tick",
        "mind:feedback",
        "mind:ledger",
        "mind:quantum-status",
        "mind:quantum-step",
        "mind:quantum-bind",
        "mind:neuro-status",
        "mind:neuro-step",
        "mind:neuro-recall",
        "mind:neuro-predict",
        "mind:neuro-learn"
      ],
      "apis": 17
    },
    {
      "key": "sediment",
      "label": "沉淀",
      "channels": [
        "sediment:list"
      ],
      "apis": 1
    },
    {
      "key": "conn",
      "label": "连接管理",
      "channels": [
        "conn:list",
        "conn:block",
        "conn:unblock",
        "conn:disconnect",
        "conn:bind",
        "conn:service",
        "conn:scopeSet",
        "conn:sedimentSet",
        "conn:sedimentCreate"
      ],
      "apis": 9
    },
    {
      "key": "synapse",
      "label": "突触推导",
      "channels": [
        "synapse:derive"
      ],
      "apis": 1
    },
    {
      "key": "tool",
      "label": "知识工具",
      "channels": [
        "tool:invoke"
      ],
      "apis": 14
    },
    {
      "key": "vault",
      "label": "知识库",
      "channels": [
        "vault:list",
        "vault:create",
        "vault:switch",
        "vault:rename",
        "vault:setColor",
        "vault:forget",
        "vault:open",
        "vault:info",
        "vault:pick",
        "vault:storageLocations",
        "vault:chooseStorage",
        "vault:migrate",
        "vault:reveal",
        "vault:revealPath",
        "vault:loadExample",
        "vault:exampleInfo",
        "vault:seed",
        "vault:backup",
        "vault:verifyBackup",
        "vault:restoreBackup",
        "vault:audit",
        "vault:importFolder"
      ],
      "apis": 22
    },
    {
      "key": "vaults",
      "label": "多库视图",
      "channels": [
        "vaults:xgraph",
        "vaults:tree"
      ],
      "apis": 2
    },
    {
      "key": "window",
      "label": "窗口控制",
      "channels": [
        "window:control",
        "window:isMaximized",
        "window:close-reply"
      ],
      "apis": 5
    }
  ],
  "channels": [
    {
      "name": "api:genToken",
      "kind": "handle"
    },
    {
      "name": "api:revealToken",
      "kind": "handle"
    },
    {
      "name": "api:start",
      "kind": "handle"
    },
    {
      "name": "api:status",
      "kind": "handle"
    },
    {
      "name": "api:stop",
      "kind": "handle"
    },
    {
      "name": "app:init",
      "kind": "handle"
    },
    {
      "name": "app:openExternal",
      "kind": "handle"
    },
    {
      "name": "astra:audit",
      "kind": "handle"
    },
    {
      "name": "astra:click-through",
      "kind": "handle"
    },
    {
      "name": "astra:deep-math",
      "kind": "handle"
    },
    {
      "name": "astra:deep-status",
      "kind": "handle"
    },
    {
      "name": "astra:drag-end",
      "kind": "on"
    },
    {
      "name": "astra:drag-start",
      "kind": "on"
    },
    {
      "name": "astra:evolve",
      "kind": "handle"
    },
    {
      "name": "astra:hit",
      "kind": "on"
    },
    {
      "name": "astra:hold",
      "kind": "handle"
    },
    {
      "name": "astra:home",
      "kind": "handle"
    },
    {
      "name": "astra:library:graph",
      "kind": "handle"
    },
    {
      "name": "astra:library:open",
      "kind": "handle"
    },
    {
      "name": "astra:library:query",
      "kind": "handle"
    },
    {
      "name": "astra:library:relocate",
      "kind": "handle"
    },
    {
      "name": "astra:library:status",
      "kind": "handle"
    },
    {
      "name": "astra:memories",
      "kind": "handle"
    },
    {
      "name": "astra:mode",
      "kind": "handle"
    },
    {
      "name": "astra:perceive",
      "kind": "handle"
    },
    {
      "name": "astra:refresh-bounds",
      "kind": "handle"
    },
    {
      "name": "astra:reset",
      "kind": "handle"
    },
    {
      "name": "astra:rollback",
      "kind": "handle"
    },
    {
      "name": "astra:self-iterate",
      "kind": "handle"
    },
    {
      "name": "astra:set-autonomous",
      "kind": "handle"
    },
    {
      "name": "astra:status",
      "kind": "handle"
    },
    {
      "name": "astra:tick",
      "kind": "handle"
    },
    {
      "name": "conn:bind",
      "kind": "handle"
    },
    {
      "name": "conn:block",
      "kind": "handle"
    },
    {
      "name": "conn:disconnect",
      "kind": "handle"
    },
    {
      "name": "conn:list",
      "kind": "handle"
    },
    {
      "name": "conn:scopeSet",
      "kind": "handle"
    },
    {
      "name": "conn:sedimentCreate",
      "kind": "handle"
    },
    {
      "name": "conn:sedimentSet",
      "kind": "handle"
    },
    {
      "name": "conn:service",
      "kind": "handle"
    },
    {
      "name": "conn:unblock",
      "kind": "handle"
    },
    {
      "name": "consolidate:run",
      "kind": "handle"
    },
    {
      "name": "crosskb:add",
      "kind": "handle"
    },
    {
      "name": "crosskb:open",
      "kind": "handle"
    },
    {
      "name": "crosskb:remoteList",
      "kind": "handle"
    },
    {
      "name": "crosskb:remove",
      "kind": "handle"
    },
    {
      "name": "diag:mark",
      "kind": "on"
    },
    {
      "name": "doc:archive",
      "kind": "handle"
    },
    {
      "name": "doc:create",
      "kind": "handle"
    },
    {
      "name": "doc:export",
      "kind": "handle"
    },
    {
      "name": "doc:read",
      "kind": "handle"
    },
    {
      "name": "doc:relations",
      "kind": "handle"
    },
    {
      "name": "doc:rename",
      "kind": "handle"
    },
    {
      "name": "doc:resolve",
      "kind": "handle"
    },
    {
      "name": "doc:save",
      "kind": "handle"
    },
    {
      "name": "doc:tree",
      "kind": "handle"
    },
    {
      "name": "ent:recheckIntegrity",
      "kind": "handle"
    },
    {
      "name": "ent:securityStatus",
      "kind": "handle"
    },
    {
      "name": "ent:sedimentList",
      "kind": "handle"
    },
    {
      "name": "ent:sedimentStatus",
      "kind": "handle"
    },
    {
      "name": "ent:setSediment",
      "kind": "handle"
    },
    {
      "name": "ent:syncConfigSet",
      "kind": "handle"
    },
    {
      "name": "ent:syncNow",
      "kind": "handle"
    },
    {
      "name": "ent:syncStatus",
      "kind": "handle"
    },
    {
      "name": "ent:verifySediment",
      "kind": "handle"
    },
    {
      "name": "graph:get",
      "kind": "handle"
    },
    {
      "name": "index:rebuild",
      "kind": "handle"
    },
    {
      "name": "journal:tail",
      "kind": "handle"
    },
    {
      "name": "link:deep",
      "kind": "handle"
    },
    {
      "name": "link:takeDeepLink",
      "kind": "handle"
    },
    {
      "name": "link:verify",
      "kind": "handle"
    },
    {
      "name": "mcp:link-alias",
      "kind": "handle"
    },
    {
      "name": "mcp:link-clear",
      "kind": "handle"
    },
    {
      "name": "mcp:link-policy",
      "kind": "handle"
    },
    {
      "name": "mcp:link-remove",
      "kind": "handle"
    },
    {
      "name": "mcp:link-restore",
      "kind": "handle"
    },
    {
      "name": "mcp:link-reveal",
      "kind": "handle"
    },
    {
      "name": "mcp:link-revoke",
      "kind": "handle"
    },
    {
      "name": "mcp:links",
      "kind": "handle"
    },
    {
      "name": "mind:anatomy",
      "kind": "handle"
    },
    {
      "name": "mind:autonomous",
      "kind": "handle"
    },
    {
      "name": "mind:feedback",
      "kind": "handle"
    },
    {
      "name": "mind:ledger",
      "kind": "handle"
    },
    {
      "name": "mind:neuro-learn",
      "kind": "handle"
    },
    {
      "name": "mind:neuro-predict",
      "kind": "handle"
    },
    {
      "name": "mind:neuro-recall",
      "kind": "handle"
    },
    {
      "name": "mind:neuro-status",
      "kind": "handle"
    },
    {
      "name": "mind:neuro-step",
      "kind": "handle"
    },
    {
      "name": "mind:quantum-bind",
      "kind": "handle"
    },
    {
      "name": "mind:quantum-status",
      "kind": "handle"
    },
    {
      "name": "mind:quantum-step",
      "kind": "handle"
    },
    {
      "name": "mind:status",
      "kind": "handle"
    },
    {
      "name": "mind:tick",
      "kind": "handle"
    },
    {
      "name": "neolm:expand",
      "kind": "handle"
    },
    {
      "name": "neolm:generate",
      "kind": "handle"
    },
    {
      "name": "neolm:nearest",
      "kind": "handle"
    },
    {
      "name": "neolm:next",
      "kind": "handle"
    },
    {
      "name": "neolm:similarity",
      "kind": "handle"
    },
    {
      "name": "neolm:status",
      "kind": "handle"
    },
    {
      "name": "neolm:verify",
      "kind": "handle"
    },
    {
      "name": "sediment:list",
      "kind": "handle"
    },
    {
      "name": "semantic:apply-bridge",
      "kind": "handle"
    },
    {
      "name": "semantic:apply-suggestion",
      "kind": "handle"
    },
    {
      "name": "semantic:bridges",
      "kind": "handle"
    },
    {
      "name": "semantic:reindex",
      "kind": "handle"
    },
    {
      "name": "semantic:search",
      "kind": "handle"
    },
    {
      "name": "semantic:status",
      "kind": "handle"
    },
    {
      "name": "semantic:suggestions",
      "kind": "handle"
    },
    {
      "name": "semantic:vaults",
      "kind": "handle"
    },
    {
      "name": "synapse:derive",
      "kind": "handle"
    },
    {
      "name": "tool:invoke",
      "kind": "handle"
    },
    {
      "name": "vault:audit",
      "kind": "handle"
    },
    {
      "name": "vault:backup",
      "kind": "handle"
    },
    {
      "name": "vault:chooseStorage",
      "kind": "handle"
    },
    {
      "name": "vault:create",
      "kind": "handle"
    },
    {
      "name": "vault:exampleInfo",
      "kind": "handle"
    },
    {
      "name": "vault:forget",
      "kind": "handle"
    },
    {
      "name": "vault:importFolder",
      "kind": "handle"
    },
    {
      "name": "vault:info",
      "kind": "handle"
    },
    {
      "name": "vault:list",
      "kind": "handle"
    },
    {
      "name": "vault:loadExample",
      "kind": "handle"
    },
    {
      "name": "vault:migrate",
      "kind": "handle"
    },
    {
      "name": "vault:open",
      "kind": "handle"
    },
    {
      "name": "vault:pick",
      "kind": "handle"
    },
    {
      "name": "vault:rename",
      "kind": "handle"
    },
    {
      "name": "vault:restoreBackup",
      "kind": "handle"
    },
    {
      "name": "vault:reveal",
      "kind": "handle"
    },
    {
      "name": "vault:revealPath",
      "kind": "handle"
    },
    {
      "name": "vault:seed",
      "kind": "handle"
    },
    {
      "name": "vault:setColor",
      "kind": "handle"
    },
    {
      "name": "vault:storageLocations",
      "kind": "handle"
    },
    {
      "name": "vault:switch",
      "kind": "handle"
    },
    {
      "name": "vault:verifyBackup",
      "kind": "handle"
    },
    {
      "name": "vaults:tree",
      "kind": "handle"
    },
    {
      "name": "vaults:xgraph",
      "kind": "handle"
    },
    {
      "name": "window:close-reply",
      "kind": "on"
    },
    {
      "name": "window:control",
      "kind": "handle"
    },
    {
      "name": "window:isMaximized",
      "kind": "handle"
    }
  ],
  "events": [
    "app:notice",
    "astra:state",
    "mind:neuro",
    "mind:quantum",
    "mind:tick",
    "neolink:deeplink",
    "vault:changed",
    "window:ask-close"
  ],
  "apis": [
    {
      "path": "addNode",
      "channel": "tool:invoke",
      "tool": "kb_add_node",
      "group": "tool",
      "state": "hub",
      "refs": []
    },
    {
      "path": "apiServer.genToken",
      "channel": "api:genToken",
      "tool": null,
      "group": "api",
      "state": "hub",
      "refs": [
        "views/enterprise.js",
        "views/vaults.js"
      ]
    },
    {
      "path": "apiServer.revealToken",
      "channel": "api:revealToken",
      "tool": null,
      "group": "api",
      "state": "hub",
      "refs": []
    },
    {
      "path": "apiServer.start",
      "channel": "api:start",
      "tool": null,
      "group": "api",
      "state": "hub",
      "refs": [
        "cosmos.js",
        "views/enterprise.js",
        "views/settle.js",
        "views/vaults.js",
        "xgalaxy.js"
      ]
    },
    {
      "path": "apiServer.status",
      "channel": "api:status",
      "tool": null,
      "group": "api",
      "state": "hub",
      "refs": [
        "sprite/sprite-window.js",
        "views/astra.js",
        "views/enterprise.js",
        "views/mind3d.js",
        "views/neolm.js",
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "apiServer.stop",
      "channel": "api:stop",
      "tool": null,
      "group": "api",
      "state": "hub",
      "refs": [
        "views/enterprise.js",
        "views/settle.js",
        "views/vaults.js"
      ]
    },
    {
      "path": "applyReview",
      "channel": "tool:invoke",
      "tool": "kb_apply_review",
      "group": "tool",
      "state": "hub",
      "refs": [
        "views/consolidate.js",
        "views/settle.js"
      ]
    },
    {
      "path": "ask",
      "channel": "tool:invoke",
      "tool": "kb_ask",
      "group": "tool",
      "state": "view",
      "refs": [
        "sprite/sprite-window.js",
        "views/ask.js"
      ]
    },
    {
      "path": "astra.audit",
      "channel": "astra:audit",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "astra.clickThrough",
      "channel": "astra:click-through",
      "tool": null,
      "group": "astra",
      "state": "view",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.deepMath",
      "channel": "astra:deep-math",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.deepStatus",
      "channel": "astra:deep-status",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.evolve",
      "channel": "astra:evolve",
      "tool": null,
      "group": "astra",
      "state": "view",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.hold",
      "channel": "astra:hold",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": []
    },
    {
      "path": "astra.home",
      "channel": "astra:home",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.library.graph",
      "channel": "astra:library:graph",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": [
        "app.js",
        "views/astra.js"
      ]
    },
    {
      "path": "astra.library.open",
      "channel": "astra:library:open",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": [
        "app.js",
        "views/astra.js",
        "views/atlas.js",
        "views/graph.js",
        "views/map2d.js",
        "views/relations.js"
      ]
    },
    {
      "path": "astra.library.query",
      "channel": "astra:library:query",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.library.relocate",
      "channel": "astra:library:relocate",
      "tool": null,
      "group": "astra",
      "state": "view",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.library.status",
      "channel": "astra:library:status",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": [
        "sprite/sprite-window.js",
        "views/astra.js",
        "views/enterprise.js",
        "views/mind3d.js",
        "views/neolm.js",
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "astra.memories",
      "channel": "astra:memories",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": []
    },
    {
      "path": "astra.mode",
      "channel": "astra:mode",
      "tool": null,
      "group": "astra",
      "state": "view",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.onState",
      "channel": null,
      "tool": null,
      "group": "astra",
      "state": "view",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.perceive",
      "channel": "astra:perceive",
      "tool": null,
      "group": "astra",
      "state": "view",
      "refs": [
        "app.js"
      ]
    },
    {
      "path": "astra.refreshBounds",
      "channel": "astra:refresh-bounds",
      "tool": null,
      "group": "astra",
      "state": "none",
      "refs": []
    },
    {
      "path": "astra.reset",
      "channel": "astra:reset",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": []
    },
    {
      "path": "astra.rollback",
      "channel": "astra:rollback",
      "tool": null,
      "group": "astra",
      "state": "view",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.selfIterate",
      "channel": "astra:self-iterate",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.setAutonomous",
      "channel": "astra:set-autonomous",
      "tool": null,
      "group": "astra",
      "state": "view",
      "refs": [
        "views/astra.js"
      ]
    },
    {
      "path": "astra.status",
      "channel": "astra:status",
      "tool": null,
      "group": "astra",
      "state": "hub",
      "refs": [
        "sprite/sprite-window.js",
        "views/astra.js",
        "views/enterprise.js",
        "views/mind3d.js",
        "views/neolm.js",
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "astra.tick",
      "channel": "astra:tick",
      "tool": null,
      "group": "astra",
      "state": "view",
      "refs": [
        "views/astra.js",
        "views/mind3d.js"
      ]
    },
    {
      "path": "connections.bind",
      "channel": "conn:bind",
      "tool": null,
      "group": "conn",
      "state": "view",
      "refs": [
        "views/connections.js"
      ]
    },
    {
      "path": "connections.block",
      "channel": "conn:block",
      "tool": null,
      "group": "conn",
      "state": "view",
      "refs": [
        "views/connections.js"
      ]
    },
    {
      "path": "connections.disconnect",
      "channel": "conn:disconnect",
      "tool": null,
      "group": "conn",
      "state": "view",
      "refs": [
        "brain3d.js",
        "cosmos.js",
        "sprite/sprite3d.js",
        "views/connections.js",
        "views/map2d.js",
        "xgalaxy.js"
      ]
    },
    {
      "path": "connections.list",
      "channel": "conn:list",
      "tool": null,
      "group": "conn",
      "state": "view",
      "refs": [
        "app.js",
        "views/atlas.js",
        "views/connections.js",
        "views/mcp-links-panel.js",
        "views/relations.js",
        "views/settings.js"
      ]
    },
    {
      "path": "connections.scopeSet",
      "channel": "conn:scopeSet",
      "tool": null,
      "group": "conn",
      "state": "view",
      "refs": [
        "views/connections.js",
        "views/settings.js"
      ]
    },
    {
      "path": "connections.sedimentCreate",
      "channel": "conn:sedimentCreate",
      "tool": null,
      "group": "conn",
      "state": "view",
      "refs": [
        "views/connections.js",
        "views/settle.js"
      ]
    },
    {
      "path": "connections.sedimentSet",
      "channel": "conn:sedimentSet",
      "tool": null,
      "group": "conn",
      "state": "view",
      "refs": [
        "views/connections.js",
        "views/settle.js"
      ]
    },
    {
      "path": "connections.service",
      "channel": "conn:service",
      "tool": null,
      "group": "conn",
      "state": "view",
      "refs": [
        "views/connections.js"
      ]
    },
    {
      "path": "connections.unblock",
      "channel": "conn:unblock",
      "tool": null,
      "group": "conn",
      "state": "view",
      "refs": [
        "views/connections.js"
      ]
    },
    {
      "path": "consolidate",
      "channel": "consolidate:run",
      "tool": null,
      "group": "consolidate",
      "state": "hub",
      "refs": [
        "views/consolidate.js"
      ]
    },
    {
      "path": "crosskb.add",
      "channel": "crosskb:add",
      "tool": null,
      "group": "crosskb",
      "state": "view",
      "refs": [
        "app.js",
        "boot-cosmos.js",
        "brain3d.js",
        "card-tools.js",
        "cosmos.js",
        "doc-render.js"
      ]
    },
    {
      "path": "crosskb.open",
      "channel": "crosskb:open",
      "tool": null,
      "group": "crosskb",
      "state": "view",
      "refs": [
        "app.js",
        "views/astra.js",
        "views/atlas.js",
        "views/graph.js",
        "views/map2d.js",
        "views/relations.js"
      ]
    },
    {
      "path": "crosskb.remoteList",
      "channel": "crosskb:remoteList",
      "tool": null,
      "group": "crosskb",
      "state": "view",
      "refs": [
        "views/relations.js"
      ]
    },
    {
      "path": "crosskb.remove",
      "channel": "crosskb:remove",
      "tool": null,
      "group": "crosskb",
      "state": "view",
      "refs": [
        "app.js",
        "boot-cosmos.js",
        "brain3d.js",
        "cosmos.js",
        "float-panel.js",
        "sprite/sprite-window.js"
      ]
    },
    {
      "path": "deepLink.deep",
      "channel": "link:deep",
      "tool": null,
      "group": "link",
      "state": "hub",
      "refs": [
        "app.js"
      ]
    },
    {
      "path": "deepLink.onDeepLink",
      "channel": null,
      "tool": null,
      "group": "deepLink",
      "state": "view",
      "refs": [
        "app.js"
      ]
    },
    {
      "path": "deepLink.takeDeepLink",
      "channel": "link:takeDeepLink",
      "tool": null,
      "group": "link",
      "state": "hub",
      "refs": [
        "app.js"
      ]
    },
    {
      "path": "derive",
      "channel": "synapse:derive",
      "tool": null,
      "group": "synapse",
      "state": "hub",
      "refs": [
        "app.js",
        "views/atlas.js",
        "views/explorer.js"
      ]
    },
    {
      "path": "diagMark",
      "channel": "diag:mark",
      "tool": null,
      "group": "diag",
      "state": "none",
      "refs": []
    },
    {
      "path": "doc.allTree",
      "channel": "vaults:tree",
      "tool": null,
      "group": "vaults",
      "state": "view",
      "refs": [
        "views/explorer.js",
        "views/starred.js"
      ]
    },
    {
      "path": "doc.archive",
      "channel": "doc:archive",
      "tool": null,
      "group": "doc",
      "state": "view",
      "refs": [
        "views/document.js"
      ]
    },
    {
      "path": "doc.create",
      "channel": "doc:create",
      "tool": null,
      "group": "doc",
      "state": "view",
      "refs": [
        "app.js",
        "views/atlas.js",
        "views/document.js",
        "views/relations.js",
        "views/settle.js",
        "views/team.js"
      ]
    },
    {
      "path": "doc.export",
      "channel": "doc:export",
      "tool": null,
      "group": "doc",
      "state": "view",
      "refs": [
        "views/document.js"
      ]
    },
    {
      "path": "doc.read",
      "channel": "doc:read",
      "tool": null,
      "group": "doc",
      "state": "view",
      "refs": [
        "views/document.js"
      ]
    },
    {
      "path": "doc.relations",
      "channel": "doc:relations",
      "tool": null,
      "group": "doc",
      "state": "view",
      "refs": [
        "views/graph.js",
        "views/map2d.js",
        "views/relations.js"
      ]
    },
    {
      "path": "doc.rename",
      "channel": "doc:rename",
      "tool": null,
      "group": "doc",
      "state": "view",
      "refs": [
        "views/atlas.js",
        "views/document.js"
      ]
    },
    {
      "path": "doc.resolve",
      "channel": "doc:resolve",
      "tool": null,
      "group": "doc",
      "state": "view",
      "refs": [
        "app.js",
        "boot-cosmos.js",
        "views/connections.js",
        "views/mind3d.js",
        "views/settle.js"
      ]
    },
    {
      "path": "doc.save",
      "channel": "doc:save",
      "tool": null,
      "group": "doc",
      "state": "view",
      "refs": [
        "views/document.js"
      ]
    },
    {
      "path": "doc.tree",
      "channel": "doc:tree",
      "tool": null,
      "group": "doc",
      "state": "hub",
      "refs": [
        "app.js",
        "views/document.js",
        "views/explorer.js"
      ]
    },
    {
      "path": "enterprise.audit",
      "channel": "vault:audit",
      "tool": null,
      "group": "vault",
      "state": "hub",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "enterprise.importFolder",
      "channel": "vault:importFolder",
      "tool": null,
      "group": "vault",
      "state": "view",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "enterprise.recheckIntegrity",
      "channel": "ent:recheckIntegrity",
      "tool": null,
      "group": "ent",
      "state": "hub",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "enterprise.securityStatus",
      "channel": "ent:securityStatus",
      "tool": null,
      "group": "ent",
      "state": "hub",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "enterprise.sedimentList",
      "channel": "ent:sedimentList",
      "tool": null,
      "group": "ent",
      "state": "hub",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "enterprise.sedimentStatus",
      "channel": "ent:sedimentStatus",
      "tool": null,
      "group": "ent",
      "state": "hub",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "enterprise.setSediment",
      "channel": "ent:setSediment",
      "tool": null,
      "group": "ent",
      "state": "hub",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "enterprise.syncConfigSet",
      "channel": "ent:syncConfigSet",
      "tool": null,
      "group": "ent",
      "state": "view",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "enterprise.syncNow",
      "channel": "ent:syncNow",
      "tool": null,
      "group": "ent",
      "state": "view",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "enterprise.syncStatus",
      "channel": "ent:syncStatus",
      "tool": null,
      "group": "ent",
      "state": "view",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "enterprise.verifySediment",
      "channel": "ent:verifySediment",
      "tool": null,
      "group": "ent",
      "state": "hub",
      "refs": [
        "views/enterprise.js"
      ]
    },
    {
      "path": "expand",
      "channel": "tool:invoke",
      "tool": "kb_expand",
      "group": "tool",
      "state": "hub",
      "refs": [
        "views/neolm.js"
      ]
    },
    {
      "path": "graph",
      "channel": "graph:get",
      "tool": null,
      "group": "graph",
      "state": "view",
      "refs": [
        "app.js",
        "views/astra.js"
      ]
    },
    {
      "path": "history",
      "channel": "tool:invoke",
      "tool": "kb_history",
      "group": "tool",
      "state": "hub",
      "refs": []
    },
    {
      "path": "init",
      "channel": "app:init",
      "tool": null,
      "group": "app",
      "state": "hub",
      "refs": [
        "app.js"
      ]
    },
    {
      "path": "journal",
      "channel": "journal:tail",
      "tool": null,
      "group": "journal",
      "state": "hub",
      "refs": [
        "views/atlas.js"
      ]
    },
    {
      "path": "link",
      "channel": "tool:invoke",
      "tool": "kb_link",
      "group": "tool",
      "state": "hub",
      "refs": [
        "views/relations.js"
      ]
    },
    {
      "path": "linkAudit",
      "channel": "tool:invoke",
      "tool": "kb_link_audit",
      "group": "tool",
      "state": "hub",
      "refs": []
    },
    {
      "path": "linkRecommend",
      "channel": "tool:invoke",
      "tool": "kb_link_recommend",
      "group": "tool",
      "state": "view",
      "refs": [
        "views/relations.js"
      ]
    },
    {
      "path": "mcpLinks.alias",
      "channel": "mcp:link-alias",
      "tool": null,
      "group": "mcp",
      "state": "view",
      "refs": [
        "views/mcp-links-panel.js"
      ]
    },
    {
      "path": "mcpLinks.clear",
      "channel": "mcp:link-clear",
      "tool": null,
      "group": "mcp",
      "state": "view",
      "refs": [
        "cosmos.js",
        "views/explorer.js",
        "views/map2d.js",
        "views/mcp-links-panel.js"
      ]
    },
    {
      "path": "mcpLinks.list",
      "channel": "mcp:links",
      "tool": null,
      "group": "mcp",
      "state": "view",
      "refs": [
        "app.js",
        "views/atlas.js",
        "views/connections.js",
        "views/mcp-links-panel.js",
        "views/relations.js",
        "views/settings.js"
      ]
    },
    {
      "path": "mcpLinks.remove",
      "channel": "mcp:link-remove",
      "tool": null,
      "group": "mcp",
      "state": "view",
      "refs": [
        "app.js",
        "boot-cosmos.js",
        "brain3d.js",
        "cosmos.js",
        "float-panel.js",
        "sprite/sprite-window.js"
      ]
    },
    {
      "path": "mcpLinks.restore",
      "channel": "mcp:link-restore",
      "tool": null,
      "group": "mcp",
      "state": "view",
      "refs": [
        "views/enterprise.js",
        "views/mcp-links-panel.js",
        "views/team.js"
      ]
    },
    {
      "path": "mcpLinks.reveal",
      "channel": "mcp:link-reveal",
      "tool": null,
      "group": "mcp",
      "state": "view",
      "refs": [
        "app.js",
        "views/atlas.js",
        "views/mcp-links-panel.js",
        "views/settle.js",
        "views/team.js"
      ]
    },
    {
      "path": "mcpLinks.revoke",
      "channel": "mcp:link-revoke",
      "tool": null,
      "group": "mcp",
      "state": "view",
      "refs": [
        "views/mcp-links-panel.js"
      ]
    },
    {
      "path": "mcpLinks.setPolicy",
      "channel": "mcp:link-policy",
      "tool": null,
      "group": "mcp",
      "state": "view",
      "refs": [
        "views/mcp-links-panel.js"
      ]
    },
    {
      "path": "mind.anatomy",
      "channel": "mind:anatomy",
      "tool": null,
      "group": "mind",
      "state": "hub",
      "refs": [
        "views/mind3d.js"
      ]
    },
    {
      "path": "mind.autonomous",
      "channel": "mind:autonomous",
      "tool": null,
      "group": "mind",
      "state": "view",
      "refs": [
        "views/mind3d.js"
      ]
    },
    {
      "path": "mind.feedback",
      "channel": "mind:feedback",
      "tool": null,
      "group": "mind",
      "state": "view",
      "refs": [
        "views/ask.js"
      ]
    },
    {
      "path": "mind.ledger",
      "channel": "mind:ledger",
      "tool": null,
      "group": "mind",
      "state": "hub",
      "refs": [
        "views/mind3d.js"
      ]
    },
    {
      "path": "mind.legalAsk",
      "channel": "tool:invoke",
      "tool": "kb_legal_mind",
      "group": "tool",
      "state": "view",
      "refs": [
        "views/ask.js",
        "views/mind3d.js"
      ]
    },
    {
      "path": "mind.neuroLearn",
      "channel": "mind:neuro-learn",
      "tool": null,
      "group": "mind",
      "state": "hub",
      "refs": []
    },
    {
      "path": "mind.neuroPredict",
      "channel": "mind:neuro-predict",
      "tool": null,
      "group": "mind",
      "state": "hub",
      "refs": [
        "views/mind3d.js"
      ]
    },
    {
      "path": "mind.neuroRecall",
      "channel": "mind:neuro-recall",
      "tool": null,
      "group": "mind",
      "state": "hub",
      "refs": [
        "views/mind3d.js"
      ]
    },
    {
      "path": "mind.neuroStatus",
      "channel": "mind:neuro-status",
      "tool": null,
      "group": "mind",
      "state": "hub",
      "refs": [
        "views/mind3d.js"
      ]
    },
    {
      "path": "mind.neuroStep",
      "channel": "mind:neuro-step",
      "tool": null,
      "group": "mind",
      "state": "hub",
      "refs": [
        "views/mind3d.js"
      ]
    },
    {
      "path": "mind.onNeuro",
      "channel": null,
      "tool": null,
      "group": "mind",
      "state": "view",
      "refs": [
        "views/mind3d.js"
      ]
    },
    {
      "path": "mind.onQuantum",
      "channel": null,
      "tool": null,
      "group": "mind",
      "state": "view",
      "refs": [
        "sprite/sprite-window.js"
      ]
    },
    {
      "path": "mind.onTick",
      "channel": null,
      "tool": null,
      "group": "mind",
      "state": "view",
      "refs": [
        "views/mind3d.js"
      ]
    },
    {
      "path": "mind.quantumBind",
      "channel": "mind:quantum-bind",
      "tool": null,
      "group": "mind",
      "state": "hub",
      "refs": []
    },
    {
      "path": "mind.quantumStatus",
      "channel": "mind:quantum-status",
      "tool": null,
      "group": "mind",
      "state": "hub",
      "refs": []
    },
    {
      "path": "mind.quantumStep",
      "channel": "mind:quantum-step",
      "tool": null,
      "group": "mind",
      "state": "hub",
      "refs": []
    },
    {
      "path": "mind.status",
      "channel": "mind:status",
      "tool": null,
      "group": "mind",
      "state": "hub",
      "refs": [
        "sprite/sprite-window.js",
        "views/astra.js",
        "views/enterprise.js",
        "views/mind3d.js",
        "views/neolm.js",
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "mind.tick",
      "channel": "mind:tick",
      "tool": null,
      "group": "mind",
      "state": "view",
      "refs": [
        "views/astra.js",
        "views/mind3d.js"
      ]
    },
    {
      "path": "neolm.expand",
      "channel": "neolm:expand",
      "tool": null,
      "group": "neolm",
      "state": "view",
      "refs": [
        "views/neolm.js"
      ]
    },
    {
      "path": "neolm.generate",
      "channel": "neolm:generate",
      "tool": null,
      "group": "neolm",
      "state": "view",
      "refs": [
        "views/neolm.js"
      ]
    },
    {
      "path": "neolm.nearest",
      "channel": "neolm:nearest",
      "tool": null,
      "group": "neolm",
      "state": "view",
      "refs": [
        "views/neolm.js"
      ]
    },
    {
      "path": "neolm.next",
      "channel": "neolm:next",
      "tool": null,
      "group": "neolm",
      "state": "view",
      "refs": [
        "views/neolm.js"
      ]
    },
    {
      "path": "neolm.similarity",
      "channel": "neolm:similarity",
      "tool": null,
      "group": "neolm",
      "state": "view",
      "refs": [
        "views/neolm.js"
      ]
    },
    {
      "path": "neolm.status",
      "channel": "neolm:status",
      "tool": null,
      "group": "neolm",
      "state": "view",
      "refs": [
        "sprite/sprite-window.js",
        "views/astra.js",
        "views/enterprise.js",
        "views/mind3d.js",
        "views/neolm.js",
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "neolm.verify",
      "channel": "neolm:verify",
      "tool": null,
      "group": "neolm",
      "state": "view",
      "refs": [
        "views/enterprise.js",
        "views/neolm.js",
        "views/team.js"
      ]
    },
    {
      "path": "onNotice",
      "channel": null,
      "tool": null,
      "group": "onNotice",
      "state": "view",
      "refs": [
        "app.js"
      ]
    },
    {
      "path": "onVaultChanged",
      "channel": null,
      "tool": null,
      "group": "onVaultChanged",
      "state": "view",
      "refs": [
        "app.js",
        "views/graph.js"
      ]
    },
    {
      "path": "openExternal",
      "channel": "app:openExternal",
      "tool": null,
      "group": "app",
      "state": "hub",
      "refs": [
        "views/document.js"
      ]
    },
    {
      "path": "read",
      "channel": "tool:invoke",
      "tool": "kb_read",
      "group": "tool",
      "state": "view",
      "refs": [
        "views/document.js"
      ]
    },
    {
      "path": "rebuild",
      "channel": "index:rebuild",
      "tool": null,
      "group": "index",
      "state": "hub",
      "refs": [
        "app.js",
        "views/atlas.js",
        "views/explorer.js"
      ]
    },
    {
      "path": "reviewQueue",
      "channel": "tool:invoke",
      "tool": "kb_review_queue",
      "group": "tool",
      "state": "hub",
      "refs": []
    },
    {
      "path": "search",
      "channel": "tool:invoke",
      "tool": "kb_search",
      "group": "tool",
      "state": "view",
      "refs": [
        "app.js",
        "views/graph.js",
        "views/map2d.js",
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "sediment",
      "channel": "sediment:list",
      "tool": null,
      "group": "sediment",
      "state": "hub",
      "refs": [
        "views/settle.js"
      ]
    },
    {
      "path": "semantic.applyBridge",
      "channel": "semantic:apply-bridge",
      "tool": null,
      "group": "semantic",
      "state": "view",
      "refs": [
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "semantic.applySuggestion",
      "channel": "semantic:apply-suggestion",
      "tool": null,
      "group": "semantic",
      "state": "view",
      "refs": [
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "semantic.bridges",
      "channel": "semantic:bridges",
      "tool": null,
      "group": "semantic",
      "state": "view",
      "refs": [
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "semantic.reindex",
      "channel": "semantic:reindex",
      "tool": null,
      "group": "semantic",
      "state": "view",
      "refs": [
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "semantic.search",
      "channel": "semantic:search",
      "tool": null,
      "group": "semantic",
      "state": "view",
      "refs": [
        "app.js",
        "views/graph.js",
        "views/map2d.js",
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "semantic.status",
      "channel": "semantic:status",
      "tool": null,
      "group": "semantic",
      "state": "view",
      "refs": [
        "sprite/sprite-window.js",
        "views/astra.js",
        "views/enterprise.js",
        "views/mind3d.js",
        "views/neolm.js",
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "semantic.suggestions",
      "channel": "semantic:suggestions",
      "tool": null,
      "group": "semantic",
      "state": "view",
      "refs": [
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "semantic.vaults",
      "channel": "semantic:vaults",
      "tool": null,
      "group": "semantic",
      "state": "view",
      "refs": [
        "views/semantic-bridge.js"
      ]
    },
    {
      "path": "stats",
      "channel": "tool:invoke",
      "tool": "kb_graph_stats",
      "group": "tool",
      "state": "hub",
      "refs": [
        "views/atlas.js",
        "views/consolidate.js"
      ]
    },
    {
      "path": "vault.chooseStorage",
      "channel": "vault:chooseStorage",
      "tool": null,
      "group": "vault",
      "state": "hub",
      "refs": [
        "app.js"
      ]
    },
    {
      "path": "vault.create",
      "channel": "vault:create",
      "tool": null,
      "group": "vault",
      "state": "view",
      "refs": [
        "app.js",
        "views/atlas.js",
        "views/document.js",
        "views/relations.js",
        "views/settle.js",
        "views/team.js"
      ]
    },
    {
      "path": "vault.exampleInfo",
      "channel": "vault:exampleInfo",
      "tool": null,
      "group": "vault",
      "state": "hub",
      "refs": []
    },
    {
      "path": "vault.forget",
      "channel": "vault:forget",
      "tool": null,
      "group": "vault",
      "state": "view",
      "refs": [
        "views/atlas.js",
        "views/vaults.js"
      ]
    },
    {
      "path": "vault.info",
      "channel": "vault:info",
      "tool": null,
      "group": "vault",
      "state": "hub",
      "refs": [
        "app.js"
      ]
    },
    {
      "path": "vault.list",
      "channel": "vault:list",
      "tool": null,
      "group": "vault",
      "state": "view",
      "refs": [
        "app.js",
        "views/atlas.js",
        "views/connections.js",
        "views/mcp-links-panel.js",
        "views/relations.js",
        "views/settings.js"
      ]
    },
    {
      "path": "vault.loadExample",
      "channel": "vault:loadExample",
      "tool": null,
      "group": "vault",
      "state": "hub",
      "refs": [
        "views/atlas.js"
      ]
    },
    {
      "path": "vault.migrate",
      "channel": "vault:migrate",
      "tool": null,
      "group": "vault",
      "state": "hub",
      "refs": [
        "app.js"
      ]
    },
    {
      "path": "vault.open",
      "channel": "vault:open",
      "tool": null,
      "group": "vault",
      "state": "view",
      "refs": [
        "app.js",
        "views/astra.js",
        "views/atlas.js",
        "views/graph.js",
        "views/map2d.js",
        "views/relations.js"
      ]
    },
    {
      "path": "vault.pick",
      "channel": "vault:pick",
      "tool": null,
      "group": "vault",
      "state": "view",
      "refs": [
        "app.js",
        "views/atlas.js"
      ]
    },
    {
      "path": "vault.rename",
      "channel": "vault:rename",
      "tool": null,
      "group": "vault",
      "state": "view",
      "refs": [
        "views/atlas.js",
        "views/document.js"
      ]
    },
    {
      "path": "vault.reveal",
      "channel": "vault:reveal",
      "tool": null,
      "group": "vault",
      "state": "view",
      "refs": [
        "app.js",
        "views/atlas.js",
        "views/mcp-links-panel.js",
        "views/settle.js",
        "views/team.js"
      ]
    },
    {
      "path": "vault.revealPath",
      "channel": "vault:revealPath",
      "tool": null,
      "group": "vault",
      "state": "hub",
      "refs": [
        "views/document.js"
      ]
    },
    {
      "path": "vault.seed",
      "channel": "vault:seed",
      "tool": null,
      "group": "vault",
      "state": "view",
      "refs": [
        "views/atlas.js"
      ]
    },
    {
      "path": "vault.setColor",
      "channel": "vault:setColor",
      "tool": null,
      "group": "vault",
      "state": "view",
      "refs": [
        "views/atlas.js"
      ]
    },
    {
      "path": "vault.storageLocations",
      "channel": "vault:storageLocations",
      "tool": null,
      "group": "vault",
      "state": "hub",
      "refs": []
    },
    {
      "path": "vault.switch",
      "channel": "vault:switch",
      "tool": null,
      "group": "vault",
      "state": "view",
      "refs": [
        "app.js",
        "views/atlas.js",
        "views/explorer.js",
        "views/graph.js",
        "views/settings.js",
        "views/vault-overview.js"
      ]
    },
    {
      "path": "vaultBackup.backup",
      "channel": "vault:backup",
      "tool": null,
      "group": "vault",
      "state": "hub",
      "refs": [
        "views/enterprise.js",
        "views/team.js"
      ]
    },
    {
      "path": "vaultBackup.restore",
      "channel": "vault:restoreBackup",
      "tool": null,
      "group": "vault",
      "state": "hub",
      "refs": [
        "views/enterprise.js",
        "views/mcp-links-panel.js",
        "views/team.js"
      ]
    },
    {
      "path": "vaultBackup.verify",
      "channel": "vault:verifyBackup",
      "tool": null,
      "group": "vault",
      "state": "hub",
      "refs": [
        "views/enterprise.js",
        "views/neolm.js",
        "views/team.js"
      ]
    },
    {
      "path": "vaults.xgraph",
      "channel": "vaults:xgraph",
      "tool": null,
      "group": "vaults",
      "state": "hub",
      "refs": [
        "views/vault-overview.js",
        "views/vaults.js"
      ]
    },
    {
      "path": "verify.node",
      "channel": "link:verify",
      "tool": null,
      "group": "link",
      "state": "hub",
      "refs": [
        "views/ask.js"
      ]
    },
    {
      "path": "win.close",
      "channel": "window:control",
      "tool": null,
      "group": "window",
      "state": "view",
      "refs": [
        "app.js",
        "sprite/sprite-window.js"
      ]
    },
    {
      "path": "win.isMaximized",
      "channel": "window:isMaximized",
      "tool": null,
      "group": "window",
      "state": "hub",
      "refs": []
    },
    {
      "path": "win.max",
      "channel": "window:control",
      "tool": null,
      "group": "window",
      "state": "view",
      "refs": [
        "app.js",
        "appearance.js",
        "boot-cosmos.js",
        "brain3d.js",
        "cosmos.js",
        "float-panel.js"
      ]
    },
    {
      "path": "win.min",
      "channel": "window:control",
      "tool": null,
      "group": "window",
      "state": "view",
      "refs": [
        "app.js",
        "appearance.js",
        "boot-cosmos.js",
        "brain3d.js",
        "cosmos.js",
        "float-panel.js"
      ]
    },
    {
      "path": "win.onAskClose",
      "channel": null,
      "tool": null,
      "group": "win",
      "state": "view",
      "refs": [
        "app.js"
      ]
    },
    {
      "path": "win.replyClose",
      "channel": "window:close-reply",
      "tool": null,
      "group": "window",
      "state": "view",
      "refs": [
        "app.js"
      ]
    },
    {
      "path": "writeBack",
      "channel": "tool:invoke",
      "tool": "kb_write_back",
      "group": "tool",
      "state": "hub",
      "refs": []
    }
  ]
};
