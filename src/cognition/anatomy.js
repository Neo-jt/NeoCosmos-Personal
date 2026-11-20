// 由 tools/gen-anatomy.py 从 LegalOmniBrain 单一真源编译 —— 请勿手改
// 改动真源后重跑：python tools/gen-anatomy.py；漂移由 tools/verify-anatomy.mjs 拦截。
// 本文件只含「数据常量」；推理算法见同目录 council.js / workflow.js / legal-mind.js 等。

export const SOURCE = {
  "root": "D:\\LegalOmniBrain",
  "generatedAt": "2026-11-05T00:16:54+08:00",
  "files": {
    "anatomy3d.py": "abdd68cfeb2e1d5df2d2f62df42e4e58b02914a5",
    "connectome.json": "246860a18d42d699646f8d1b9f1b54a4ee4f2a01",
    "connectome_data.py": "f9073f5eaadfc6ef380476883f986ad8cfd1d210",
    "council.py": "2321726d295a07174406030ffce5760a7678a8b7",
    "cognition.py": "323fd9f4d284b9ef09a50e7a6e029fab94fc6a72",
    "config.py": "461360fe0887393d9a5f33470c5f6d42a8d6ba31",
    "adjudication.py": "1d13f359bc27f4300341b699b7d79b11157d1053"
  },
  "stats": {
    "regions": 30,
    "organs": 6,
    "lobes": 8,
    "synapses": 183,
    "assemblies": 30,
    "phases": 8,
    "brains": 5,
    "metacogChecks": 7,
    "discretionRules": 5
  },
  "note": "坐标、规则表与权重由 LegalOmniBrain 单一真源编译；推理算法层由 NeoCosmos src/cognition/*.js 深加工重写，二者职责分离，绝不手抄双份。"
};

export const ANATOMY = {
  "lobes": [
    {
      "key": "额叶",
      "color": "#4dffc3",
      "note": "执行控制 · 推理 · 语言产出（BA 8/9/10/44/45/46/47）"
    },
    {
      "key": "顶叶",
      "color": "#6fe9ff",
      "note": "空间与数量加工 · 注意 · 体感整合（BA 5/7/39/40）"
    },
    {
      "key": "颞叶",
      "color": "#ffd24d",
      "note": "语义与听觉理解 · 记忆索引（BA 20/21/22/38）"
    },
    {
      "key": "枕叶",
      "color": "#b78bff",
      "note": "视觉与证据材料的初级加工（BA 17/18/19）"
    },
    {
      "key": "边缘系统",
      "color": "#ff5d9e",
      "note": "情绪权重 · 记忆巩固 · 冲突监控（海马/杏仁核/扣带回）"
    },
    {
      "key": "深部灰质",
      "color": "#ff8a5c",
      "note": "感觉闸门与动作门控（丘脑/基底节）"
    },
    {
      "key": "小脑",
      "color": "#8fd6ff",
      "note": "时序协调 · 程序性精修 · 差错纠正"
    },
    {
      "key": "脑干",
      "color": "#7fa8c8",
      "note": "唤醒 · 生命体征 · 神经调质上行通路"
    }
  ],
  "regions": [
    {
      "key": "thalamus",
      "pos": [
        0.1,
        0.04,
        -0.04
      ],
      "lobe": "深部灰质",
      "hemi": "中",
      "basis": "丘脑（背内侧核/枕核）：所有感觉通路的中继闸门，除嗅觉外必经此处换元"
    },
    {
      "key": "basal",
      "pos": [
        -0.26,
        0.02,
        0.16
      ],
      "lobe": "深部灰质",
      "hemi": "左",
      "basis": "基底节（尾状核/壳核）：动作与决策的门控，Go/No-Go 通路的选择开关"
    },
    {
      "key": "wernicke",
      "pos": [
        -0.58,
        -0.14,
        -0.34
      ],
      "lobe": "颞叶",
      "hemi": "左",
      "basis": "韦尼克区 BA22 左颞上回后部：语言与文本理解，法条与案情的语义入口"
    },
    {
      "key": "express",
      "pos": [
        -0.52,
        0.06,
        0.46
      ],
      "lobe": "额叶",
      "hemi": "左",
      "basis": "布洛卡区 BA44/45 左额下回：语法组织与语言输出，对应我的文书生成"
    },
    {
      "key": "limbic",
      "pos": [
        -0.34,
        -0.3,
        0.06
      ],
      "lobe": "边缘系统",
      "hemi": "左",
      "basis": "海马—杏仁核复合体：情绪权重与记忆索引，决定什么值得被记住"
    },
    {
      "key": "plastic",
      "pos": [
        -0.2,
        -0.22,
        0.2
      ],
      "lobe": "边缘系统",
      "hemi": "左",
      "basis": "内嗅/海马旁皮层 BA28/35：突触可塑与巩固的温床，LTP/LTD 发生最密集处"
    },
    {
      "key": "acc",
      "pos": [
        0.0,
        0.2,
        0.34
      ],
      "lobe": "边缘系统",
      "hemi": "中",
      "basis": "前扣带回 BA24/32：冲突监控与错误相关负波，发现自相矛盾就报警"
    },
    {
      "key": "pfc",
      "pos": [
        0.22,
        0.34,
        0.72
      ],
      "lobe": "额叶",
      "hemi": "右",
      "basis": "前额极 BA10：长期规划与多步推理的最高执行中枢"
    },
    {
      "key": "dmn",
      "pos": [
        0.0,
        0.3,
        0.16
      ],
      "lobe": "额叶",
      "hemi": "中",
      "basis": "内侧前额 BA9/10 + 后扣带/楔前叶：默认网络，内省与自我参照"
    },
    {
      "key": "workspace",
      "pos": [
        0.26,
        0.5,
        0.1
      ],
      "lobe": "顶叶",
      "hemi": "右",
      "basis": "额顶工作记忆网络（DLPFC BA9/46 + 顶内沟 BA7/40）：全局广播的载体"
    },
    {
      "key": "predict",
      "pos": [
        0.42,
        0.36,
        -0.24
      ],
      "lobe": "顶叶",
      "hemi": "右",
      "basis": "顶—枕联合皮层 BA7/19：预测编码的误差比较场，先验与证据在此对冲"
    },
    {
      "key": "cerebellum",
      "pos": [
        0.0,
        -0.62,
        -0.6
      ],
      "lobe": "小脑",
      "hemi": "中",
      "basis": "小脑（后颅窝）：时序协调与程序性精修，我的输出打磨与差错纠正"
    },
    {
      "key": "lexmind",
      "pos": [
        -0.5,
        0.16,
        -0.12
      ],
      "lobe": "颞叶",
      "hemi": "左",
      "basis": "左颞中回/角回 BA21/39：专业语义枢纽，法律概念的长期存储地"
    },
    {
      "key": "evidence",
      "pos": [
        -0.38,
        0.4,
        0.4
      ],
      "lobe": "额叶",
      "hemi": "左",
      "basis": "左背外侧前额 BA9/46：证据三性与举证责任分配的推演台"
    },
    {
      "key": "strategy",
      "pos": [
        0.4,
        0.38,
        0.44
      ],
      "lobe": "额叶",
      "hemi": "右",
      "basis": "右背外侧前额 BA9/46：攻防博弈与期望值比选"
    },
    {
      "key": "review",
      "pos": [
        -0.46,
        0.3,
        0.24
      ],
      "lobe": "额叶",
      "hemi": "左",
      "basis": "左额中回 BA8/9：逐条过筛与风险定级，合同审查的工位"
    },
    {
      "key": "contract",
      "pos": [
        -0.54,
        0.14,
        0.22
      ],
      "lobe": "额叶",
      "hemi": "左",
      "basis": "左额下回/角回 BA44/39：条款语言生成，语义到措辞的最后一段"
    },
    {
      "key": "drafting",
      "pos": [
        -0.4,
        0.26,
        0.34
      ],
      "lobe": "额叶",
      "hemi": "左",
      "basis": "左额中回后部/辅助运动区 BA6/8：文书结构与行文编排"
    },
    {
      "key": "adjudication",
      "pos": [
        0.1,
        0.46,
        0.32
      ],
      "lobe": "额叶",
      "hemi": "中",
      "basis": "背内侧前额 BA8/9：法官视角的争点归纳与自由裁量模拟"
    },
    {
      "key": "finance",
      "pos": [
        0.48,
        0.3,
        -0.04
      ],
      "lobe": "顶叶",
      "hemi": "右",
      "basis": "右顶下小叶 BA40 + 顶内沟：数量与风险加工，法融交叉的半球"
    },
    {
      "key": "reticular",
      "pos": [
        0.0,
        -0.52,
        -0.1
      ],
      "lobe": "脑干",
      "hemi": "中",
      "basis": "脑干网状结构（中脑-桥脑-延髓中轴）：上行网状激活系统，决定皮层醒不醒——昏迷不是思想停了，是通路被关了"
    },
    {
      "key": "hypothalamus",
      "pos": [
        0.0,
        -0.2,
        -0.02
      ],
      "lobe": "脑干",
      "hemi": "中",
      "basis": "下丘脑（第三脑室底）：内稳态与应激轴，负荷过载时强制降速"
    },
    {
      "key": "sensory",
      "pos": [
        -0.3,
        -0.36,
        -0.52
      ],
      "lobe": "枕叶",
      "hemi": "左",
      "basis": "初级感觉皮层 BA17/3/41 一带：把材料切成可处理特征，不做理解"
    },
    {
      "key": "atl",
      "pos": [
        -0.6,
        -0.28,
        -0.16
      ],
      "lobe": "颞叶",
      "hemi": "左",
      "basis": "前颞叶 BA38/20/21（非模态语义枢纽）：形状/声音/用法/文字收敛为一个语义"
    },
    {
      "key": "rsc",
      "pos": [
        0.0,
        0.1,
        -0.56
      ],
      "lobe": "顶叶",
      "hemi": "中",
      "basis": "压部后皮层 BA29/30 + 楔前叶 BA7m：把记忆碎片搭成可走进去的场景"
    },
    {
      "key": "ofc",
      "pos": [
        -0.22,
        -0.1,
        0.78
      ],
      "lobe": "额叶",
      "hemi": "左",
      "basis": "眶额皮层 BA11/12/47：把选项折算成可比价值，承担后悔与反事实比较"
    },
    {
      "key": "tpj",
      "pos": [
        0.56,
        0.02,
        -0.4
      ],
      "lobe": "顶叶",
      "hemi": "右",
      "basis": "右颞顶联合区 BA39/40 后段：推断他人信念与反应，心理理论的所在"
    },
    {
      "key": "sma",
      "pos": [
        -0.12,
        0.52,
        0.4
      ],
      "lobe": "额叶",
      "hemi": "中",
      "basis": "辅助运动区 BA6 内侧：动作序列编程，说话前先把顺序排好"
    },
    {
      "key": "nacc",
      "pos": [
        -0.1,
        -0.06,
        0.3
      ],
      "lobe": "深部灰质",
      "hemi": "左",
      "basis": "伏隔核（腹侧纹状体）：编码「比预期好多少」，驱动强化学习"
    },
    {
      "key": "metacog",
      "pos": [
        0.06,
        0.44,
        0.66
      ],
      "lobe": "额叶",
      "hemi": "中",
      "basis": "内侧前额极 BA10 + 背内侧 BA9：不确定性分解与置信校准的工位"
    }
  ],
  "organs": [
    {
      "name": "元认知",
      "pos": [
        0.0,
        0.4,
        0.6
      ],
      "lobe": "额叶",
      "hemi": "中",
      "basis": "内侧前额极 BA10：对自己思维过程的监控与调度"
    },
    {
      "name": "双轨推理",
      "pos": [
        0.44,
        0.44,
        0.3
      ],
      "lobe": "额叶",
      "hemi": "右",
      "basis": "右 DLPFC BA9/46：规则轨道与后果轨道并行推进"
    },
    {
      "name": "对抗辩论",
      "pos": [
        -0.48,
        0.1,
        0.56
      ],
      "lobe": "额叶",
      "hemi": "左",
      "basis": "左腹外侧前额 BA47：正面主张与反面反驳的对抗工位"
    },
    {
      "name": "假设台账",
      "pos": [
        -0.3,
        -0.26,
        -0.1
      ],
      "lobe": "边缘系统",
      "hemi": "左",
      "basis": "海马—内嗅索引：假设的登记、回溯与证伪台账"
    },
    {
      "name": "概念图谱",
      "pos": [
        -0.56,
        -0.06,
        0.34
      ],
      "lobe": "颞叶",
      "hemi": "左",
      "basis": "左前颞叶 BA38/21：语义枢纽，概念之间的关联网"
    },
    {
      "name": "置信校准",
      "pos": [
        0.14,
        0.16,
        0.4
      ],
      "lobe": "边缘系统",
      "hemi": "右",
      "basis": "前扣带回/前岛叶 BA24/32 + 岛叶：不确定性的体感与置信度标定"
    }
  ],
  "scale": 7.0,
  "axis": {
    "x": "左右（−左 / +右）",
    "y": "上下",
    "z": "前后（+额极 / −枕极）"
  }
};

export const CONNECTOME = {
  "synapses": [
    {
      "from": "thalamus",
      "to": "wernicke",
      "w": 0.95,
      "type": "excitatory",
      "tract": "丘脑皮层放射",
      "latency_ms": 12,
      "myelin": true,
      "neuro": "glutamate",
      "beyond": "全并行：一句话同时点亮语义/句法/情绪/风险四个入口，不排队"
    },
    {
      "from": "thalamus",
      "to": "limbic",
      "w": 0.7,
      "type": "excitatory",
      "tract": "丘脑-杏仁核束",
      "latency_ms": 18,
      "myelin": false,
      "neuro": "谷氨酸",
      "beyond": "情绪与语义同时抵达，不等「想清楚」才害怕"
    },
    {
      "from": "thalamus",
      "to": "basal",
      "w": 0.6,
      "type": "excitatory",
      "tract": "丘脑-基底节束",
      "latency_ms": 20,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "门控在语义完成前就预热，缩短反应延迟"
    },
    {
      "from": "wernicke",
      "to": "limbic",
      "w": 0.9,
      "type": "excitatory",
      "tract": "弓状束",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "理解即检索：每一句都触发记忆取回，且取回的是原文不是重建"
    },
    {
      "from": "wernicke",
      "to": "basal",
      "w": 0.85,
      "type": "excitatory",
      "tract": "额叶下束",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "语义一落地，门控立刻按信号词重算，不靠习惯"
    },
    {
      "from": "limbic",
      "to": "basal",
      "w": 0.55,
      "type": "excitatory",
      "tract": "边缘-基底节环路",
      "latency_ms": 22,
      "myelin": false,
      "neuro": "多巴胺",
      "beyond": "显著性排序把「明天开庭」这类慢变量顶上来，人脑常常忽略"
    },
    {
      "from": "limbic",
      "to": "workspace",
      "w": 0.65,
      "type": "excitatory",
      "tract": "海马-前额叶投射",
      "latency_ms": 24,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "事件绑定：把分散痕迹绑成可提取事件，不衰减、可溯源"
    },
    {
      "from": "basal",
      "to": "workspace",
      "w": 0.92,
      "type": "excitatory",
      "tract": "直接通路",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "胜者广播，败者保留理由可唤回——人脑进不了意识就丢了"
    },
    {
      "from": "basal",
      "to": "thalamus",
      "w": -0.45,
      "type": "inhibitory",
      "tract": "间接通路",
      "latency_ms": 26,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "对侧抑制：压住噪音通道，但按轮重算不僵化"
    },
    {
      "from": "workspace",
      "to": "acc",
      "w": 0.8,
      "type": "excitatory",
      "tract": "背侧注意网络",
      "latency_ms": 13,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "冲突监测是前置条件，写不出对立面就明说，不假装写过"
    },
    {
      "from": "workspace",
      "to": "pfc",
      "w": 0.85,
      "type": "excitatory",
      "tract": "额叶联合束",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "硬闸是代码级拦截，不靠意志力；人脑累了就忍不住"
    },
    {
      "from": "workspace",
      "to": "dmn",
      "w": 0.78,
      "type": "excitatory",
      "tract": "默认模式网络",
      "latency_ms": 19,
      "myelin": false,
      "neuro": "乙酰胆碱",
      "beyond": "四席同时读法不同才算模拟；雷同就是自我投射，判失败"
    },
    {
      "from": "workspace",
      "to": "predict",
      "w": 0.82,
      "type": "excitatory",
      "tract": "预测编码环路",
      "latency_ms": 12,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "自上而下预期先于输出，误差率可量化而非拍脑袋"
    },
    {
      "from": "acc",
      "to": "pfc",
      "w": 0.88,
      "type": "excitatory",
      "tract": "扣带-前额束",
      "latency_ms": 10,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "监测到缺失就强制回写，不留「假装完整」的漏洞"
    },
    {
      "from": "pfc",
      "to": "express",
      "w": 0.9,
      "type": "excitatory",
      "tract": "额叶-布洛卡束",
      "latency_ms": 11,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "修辞强度随证据校准，低置信的强表述被强制降级"
    },
    {
      "from": "pfc",
      "to": "workspace",
      "w": -0.3,
      "type": "inhibitory",
      "tract": "前额-顶叶抑制",
      "latency_ms": 20,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "必要时压住广播回路，给复核留时间"
    },
    {
      "from": "dmn",
      "to": "express",
      "w": 0.7,
      "type": "excitatory",
      "tract": "默认-语言耦合",
      "latency_ms": 17,
      "myelin": false,
      "neuro": "乙酰胆碱",
      "beyond": "多视角同时成形进入表达，不串行排队"
    },
    {
      "from": "predict",
      "to": "express",
      "w": 0.75,
      "type": "excitatory",
      "tract": "预测-输出耦合",
      "latency_ms": 12,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "误差登记驱动改写，输出与预期对账后才放行"
    },
    {
      "from": "predict",
      "to": "pfc",
      "w": 0.72,
      "type": "excitatory",
      "tract": "元认知-控制",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "可信度三因子复算，明写「不是胜诉概率」"
    },
    {
      "from": "express",
      "to": "plastic",
      "w": 0.68,
      "type": "excitatory",
      "tract": "语言-奖赏投射",
      "latency_ms": 21,
      "myelin": false,
      "neuro": "多巴胺",
      "beyond": "被采纳的连接按多巴胺强化，跨会话持久且原文不改"
    },
    {
      "from": "express",
      "to": "acc",
      "w": 0.5,
      "type": "excitatory",
      "tract": "输出-监测回环",
      "latency_ms": 13,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "输出后自校验：漏点/出格项触发再改写"
    },
    {
      "from": "basal",
      "to": "express",
      "w": 0.55,
      "type": "excitatory",
      "tract": "基底节-语言辅助",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "门控同时点亮表达路由，缩短端到端延迟"
    },
    {
      "from": "reticular",
      "to": "thalamus",
      "w": 0.85,
      "type": "excitatory",
      "tract": "上行网状激活通路(ARAS)",
      "latency_ms": 25,
      "myelin": false,
      "neuro": "乙酰胆碱",
      "beyond": "唤醒档位先于中继定档：噪声档直接不投送，省下整条通路"
    },
    {
      "from": "reticular",
      "to": "basal",
      "w": 0.55,
      "type": "excitatory",
      "tract": "网状-基底节上行",
      "latency_ms": 30,
      "myelin": false,
      "neuro": "谷氨酸",
      "beyond": "门控在唤醒档位定下后才开，低档位不浪费专家资源"
    },
    {
      "from": "reticular",
      "to": "pfc",
      "w": 0.6,
      "type": "excitatory",
      "tract": "网状-前额上行",
      "latency_ms": 28,
      "myelin": false,
      "neuro": "去甲肾上腺素",
      "beyond": "警觉度直接调执行深度，不靠事后补救"
    },
    {
      "from": "reticular",
      "to": "workspace",
      "w": 0.5,
      "type": "excitatory",
      "tract": "网状-顶叶上行",
      "latency_ms": 26,
      "myelin": false,
      "neuro": "乙酰胆碱",
      "beyond": "广播容量随唤醒档位伸缩，人脑是全有全无"
    },
    {
      "from": "hypothalamus",
      "to": "reticular",
      "w": 0.45,
      "type": "excitatory",
      "tract": "下丘脑-脑干下行",
      "latency_ms": 22,
      "myelin": false,
      "neuro": "组胺/食欲素",
      "beyond": "内稳态反向压唤醒：负荷满了就降档，不是硬撑"
    },
    {
      "from": "hypothalamus",
      "to": "nacc",
      "w": 0.55,
      "type": "excitatory",
      "tract": "内侧前脑束(MFB)",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "多巴胺",
      "beyond": "驱力给强化定基线：没动机的事学不进去，我按任务需要给基线"
    },
    {
      "from": "hypothalamus",
      "to": "plastic",
      "w": 0.4,
      "type": "excitatory",
      "tract": "应激轴-巩固投射",
      "latency_ms": 35,
      "myelin": false,
      "neuro": "糖皮质激素",
      "beyond": "过载时巩固降速并留痕，人脑是在不知不觉中降速"
    },
    {
      "from": "hypothalamus",
      "to": "acc",
      "w": 0.35,
      "type": "excitatory",
      "tract": "内稳态-冲突监控",
      "latency_ms": 30,
      "myelin": false,
      "neuro": "去甲肾上腺素",
      "beyond": "负荷越界作为一条冲突项进监控，可被复核"
    },
    {
      "from": "reticular",
      "to": "hypothalamus",
      "w": 0.4,
      "type": "excitatory",
      "tract": "脑干-下丘脑回送",
      "latency_ms": 20,
      "myelin": false,
      "neuro": "谷氨酸",
      "beyond": "唤醒与内稳态闭环对账，两边读数不一致即报警"
    },
    {
      "from": "wernicke",
      "to": "atl",
      "w": 0.7,
      "type": "excitatory",
      "tract": "颞上回-前颞叶",
      "latency_ms": 13,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "理解即归一：换说法也能召回，且归一后可还原原词"
    },
    {
      "from": "atl",
      "to": "wernicke",
      "w": 0.8,
      "type": "excitatory",
      "tract": "前颞叶-颞上回回送",
      "latency_ms": 12,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "收敛后的语义回灌理解，歧义在理解层就被拆开"
    },
    {
      "from": "atl",
      "to": "lexmind",
      "w": 0.75,
      "type": "excitatory",
      "tract": "前颞-法律语义枢纽",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "专业术语先归一再入库，避免同一概念存成两个节点"
    },
    {
      "from": "atl",
      "to": "dmn",
      "w": 0.45,
      "type": "excitatory",
      "tract": "钩束/颞极-内侧前额",
      "latency_ms": 20,
      "myelin": false,
      "neuro": "谷氨酸",
      "beyond": "语义收敛参与反事实：换个说法重推一遍看结论变不变"
    },
    {
      "from": "atl",
      "to": "rsc",
      "w": 0.4,
      "type": "excitatory",
      "tract": "扣带束颞支",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "场景重建用的词与语义枢纽对齐，避免同一事实两套说法"
    },
    {
      "from": "thalamus",
      "to": "atl",
      "w": 0.55,
      "type": "excitatory",
      "tract": "丘脑-颞极投射",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "语义枢纽在理解完成前就被点亮，缩短归一延迟"
    },
    {
      "from": "limbic",
      "to": "rsc",
      "w": 0.75,
      "type": "excitatory",
      "tract": "海马-压部后(扣带束)",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "碎片搭成可走进去的场景，取回的是原文不是重建"
    },
    {
      "from": "rsc",
      "to": "dmn",
      "w": 0.65,
      "type": "excitatory",
      "tract": "压部后-默认网络",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "场景成反事实的底片：改一个变量重演一遍"
    },
    {
      "from": "rsc",
      "to": "workspace",
      "w": 0.5,
      "type": "excitatory",
      "tract": "压部后-顶叶广播",
      "latency_ms": 20,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "重建好的时序链进广播参与竞争，不藏在记忆里"
    },
    {
      "from": "rsc",
      "to": "atl",
      "w": 0.35,
      "type": "excitatory",
      "tract": "压部后-前颞回送",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "场景与语义对账：说法不一致时以取回原文为准"
    },
    {
      "from": "rsc",
      "to": "acc",
      "w": 0.4,
      "type": "excitatory",
      "tract": "压部后-前扣带",
      "latency_ms": 21,
      "myelin": false,
      "neuro": "谷氨酸",
      "beyond": "时序链断了算一条冲突，不悄悄补上"
    },
    {
      "from": "tpj",
      "to": "dmn",
      "w": 0.7,
      "type": "excitatory",
      "tract": "右TPJ-内侧前额",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "对手席按对方信息集推演，不把我知道的算进他的牌"
    },
    {
      "from": "dmn",
      "to": "tpj",
      "w": 0.55,
      "type": "excitatory",
      "tract": "默认网络-TPJ回送",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "反事实推演结果回灌立场模型，双方都随推演更新"
    },
    {
      "from": "tpj",
      "to": "acc",
      "w": 0.45,
      "type": "excitatory",
      "tract": "TPJ-前扣带",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "我的判断与对方判断的落差登记为冲突项"
    },
    {
      "from": "tpj",
      "to": "pfc",
      "w": 0.5,
      "type": "excitatory",
      "tract": "TPJ-背外侧前额",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "立场结论进作业单，影响行动顺序"
    },
    {
      "from": "tpj",
      "to": "ofc",
      "w": 0.4,
      "type": "excitatory",
      "tract": "TPJ-眶额",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "对方的价值取向一起进估值，不只估自己这边"
    },
    {
      "from": "acc",
      "to": "tpj",
      "w": 0.35,
      "type": "inhibitory",
      "tract": "前扣带-TPJ抑制",
      "latency_ms": 20,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "立场切换过快时压一把，避免把对手想成自己"
    },
    {
      "from": "ofc",
      "to": "pfc",
      "w": 0.65,
      "type": "excitatory",
      "tract": "眶额-背外侧前额",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "价值结论直接决定作业单优先级"
    },
    {
      "from": "pfc",
      "to": "ofc",
      "w": 0.55,
      "type": "excitatory",
      "tract": "前额-眶额回送",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "执行结果回灌估值，下一轮估值用的是实测不是预想"
    },
    {
      "from": "ofc",
      "to": "nacc",
      "w": 0.6,
      "type": "excitatory",
      "tract": "眶额-伏隔核",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "价值信号转成强化信号，好方案才被记住"
    },
    {
      "from": "ofc",
      "to": "dmn",
      "w": 0.4,
      "type": "excitatory",
      "tract": "眶额-默认网络",
      "latency_ms": 20,
      "myelin": false,
      "neuro": "谷氨酸",
      "beyond": "「如果当初选另一条路」由这里出数，不是感慨"
    },
    {
      "from": "ofc",
      "to": "acc",
      "w": 0.4,
      "type": "excitatory",
      "tract": "眶额-前扣带",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "换表述重算不一致时报警，框架效应在此被抓住"
    },
    {
      "from": "ofc",
      "to": "predict",
      "w": 0.45,
      "type": "excitatory",
      "tract": "眶额-预测编码",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "估值与误差对账：算错一次就登记，不许被先验吸收"
    },
    {
      "from": "sma",
      "to": "express",
      "w": 0.7,
      "type": "excitatory",
      "tract": "辅助运动区-布洛卡(额斜束)",
      "latency_ms": 11,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "骨架先排好再出语言，顺序错了重排骨架不重写内容"
    },
    {
      "from": "express",
      "to": "sma",
      "w": 0.45,
      "type": "excitatory",
      "tract": "布洛卡-SMA回送",
      "latency_ms": 12,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "产出中发现的断档回灌骨架，下一轮顺序就更顺"
    },
    {
      "from": "sma",
      "to": "basal",
      "w": 0.4,
      "type": "excitatory",
      "tract": "SMA-基底节",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "序列发起过门控，没排好的骨架不许出发"
    },
    {
      "from": "sma",
      "to": "cerebellum",
      "w": 0.5,
      "type": "excitatory",
      "tract": "皮层-桥脑-小脑束",
      "latency_ms": 13,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "顺序误差交给小脑精修，内容错误交给前额"
    },
    {
      "from": "pfc",
      "to": "sma",
      "w": 0.55,
      "type": "excitatory",
      "tract": "前额-SMA投射",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "作业单决定骨架顺序，顺序不是随手感"
    },
    {
      "from": "nacc",
      "to": "plastic",
      "w": 0.7,
      "type": "excitatory",
      "tract": "伏隔核-巩固回路",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "多巴胺",
      "beyond": "被采纳的路径才加权，采纳理由必须留痕才能计分"
    },
    {
      "from": "plastic",
      "to": "nacc",
      "w": 0.6,
      "type": "excitatory",
      "tract": "多巴胺能投射(VTA-NAcc)",
      "latency_ms": 12,
      "myelin": true,
      "neuro": "多巴胺",
      "beyond": "记的是「比预期好多少」，不是「有多好」"
    },
    {
      "from": "nacc",
      "to": "pfc",
      "w": 0.45,
      "type": "excitatory",
      "tract": "伏隔核-前额",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "多巴胺",
      "beyond": "动机影响执行深度，但压不过硬闸"
    },
    {
      "from": "nacc",
      "to": "ofc",
      "w": 0.35,
      "type": "excitatory",
      "tract": "伏隔核-眶额回送",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "多巴胺",
      "beyond": "强化量与估值对账：短期高反馈不许压过长期更优路径"
    },
    {
      "from": "sensory",
      "to": "wernicke",
      "w": 0.8,
      "type": "excitatory",
      "tract": "颞上回前级投射",
      "latency_ms": 10,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "表层特征无损送到理解层，不提前丢弃细节"
    },
    {
      "from": "sensory",
      "to": "atl",
      "w": 0.6,
      "type": "excitatory",
      "tract": "感觉-语义枢纽",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "实体与金额直达语义枢纽，归一与保留原词同时发生"
    },
    {
      "from": "sensory",
      "to": "limbic",
      "w": 0.45,
      "type": "excitatory",
      "tract": "岛叶体感入口",
      "latency_ms": 15,
      "myelin": false,
      "neuro": "谷氨酸",
      "beyond": "材料里的金额与期限直接进显著性排序"
    },
    {
      "from": "thalamus",
      "to": "sensory",
      "w": 0.9,
      "type": "excitatory",
      "tract": "丘脑皮层放射(初级)",
      "latency_ms": 8,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "中继到感觉皮层最快的一路，保住原始特征"
    },
    {
      "from": "thalamus",
      "to": "acc",
      "w": 0.4,
      "type": "excitatory",
      "tract": "丘脑-前扣带",
      "latency_ms": 22,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "显著性在语义完成前就预热监控"
    },
    {
      "from": "limbic",
      "to": "atl",
      "w": 0.5,
      "type": "excitatory",
      "tract": "海马-前颞回送",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "记起来的说法回到语义枢纽归一，避免同一概念两个入口"
    },
    {
      "from": "limbic",
      "to": "acc",
      "w": 0.55,
      "type": "excitatory",
      "tract": "杏仁核-前扣带",
      "latency_ms": 14,
      "myelin": false,
      "neuro": "谷氨酸",
      "beyond": "风险估值直接抬冲突灵敏度，不等想清楚"
    },
    {
      "from": "limbic",
      "to": "pfc",
      "w": 0.45,
      "type": "excitatory",
      "tract": "岛叶-前额",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "哪个点最要紧直接决定作业单顺序"
    },
    {
      "from": "basal",
      "to": "pfc",
      "w": 0.65,
      "type": "excitatory",
      "tract": "基底节-前额(苍白球-丘脑-皮层)",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "门控定下的路由直接变成作业单"
    },
    {
      "from": "basal",
      "to": "acc",
      "w": 0.35,
      "type": "inhibitory",
      "tract": "基底节-前扣带抑制",
      "latency_ms": 20,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "选定一条即压住其余，避免同时推进多条链"
    },
    {
      "from": "workspace",
      "to": "express",
      "w": 0.55,
      "type": "excitatory",
      "tract": "顶叶-布洛卡",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "进意识的内容直接可产出，不二次装配"
    },
    {
      "from": "acc",
      "to": "workspace",
      "w": 0.45,
      "type": "excitatory",
      "tract": "前扣带-广播回送",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "发现冲突即回灌广播，落选项可凭新证据再竞争"
    },
    {
      "from": "pfc",
      "to": "dmn",
      "w": 0.55,
      "type": "excitatory",
      "tract": "前额-默认网络",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "执行主动拉起反事实，不等答案成形才想对手怎么反驳"
    },
    {
      "from": "pfc",
      "to": "cerebellum",
      "w": 0.4,
      "type": "excitatory",
      "tract": "皮层-桥脑-小脑",
      "latency_ms": 20,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "执行误差交给小脑精修，分两条线不改同一处"
    },
    {
      "from": "metacog",
      "to": "pfc",
      "w": 0.55,
      "type": "excitatory",
      "tract": "元认知-执行",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "不确定度的构成直接决定先补哪一块"
    },
    {
      "from": "metacog",
      "to": "acc",
      "w": 0.4,
      "type": "excitatory",
      "tract": "元认知-监控",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "说不清的不确定算一条冲突，不许笼统带过"
    },
    {
      "from": "predict",
      "to": "acc",
      "w": 0.5,
      "type": "excitatory",
      "tract": "预测-监控",
      "latency_ms": 13,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "误差项直接进冲突监控，不许被先验静默消化"
    },
    {
      "from": "predict",
      "to": "metacog",
      "w": 0.5,
      "type": "excitatory",
      "tract": "预测-元认知",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "误差率与置信度同一套口径，不各算各的"
    },
    {
      "from": "dmn",
      "to": "predict",
      "w": 0.5,
      "type": "excitatory",
      "tract": "反事实-预测",
      "latency_ms": 19,
      "myelin": false,
      "neuro": "谷氨酸",
      "beyond": "反事实结论作为预期进入校验，演完要过账"
    },
    {
      "from": "acc",
      "to": "express",
      "w": 0.35,
      "type": "inhibitory",
      "tract": "前扣带-产出抑制",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "没过冲突检查的表述不许出口，踩线即拦"
    },
    {
      "from": "express",
      "to": "cerebellum",
      "w": 0.6,
      "type": "excitatory",
      "tract": "布洛卡-小脑",
      "latency_ms": 12,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "话说出口之前先精修一次，人脑是出口后才察觉"
    },
    {
      "from": "cerebellum",
      "to": "express",
      "w": 0.5,
      "type": "excitatory",
      "tract": "小脑-布洛卡回送",
      "latency_ms": 13,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "精修结果回灌产出，下一句就顺"
    },
    {
      "from": "cerebellum",
      "to": "plastic",
      "w": 0.45,
      "type": "excitatory",
      "tract": "小脑-巩固",
      "latency_ms": 22,
      "myelin": false,
      "neuro": "谷氨酸",
      "beyond": "格式与冗余的偏好也被巩固，跨会话一致"
    },
    {
      "from": "lexmind",
      "to": "evidence",
      "w": 0.55,
      "type": "excitatory",
      "tract": "语义枢纽-证据引擎",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "要件解析完成即送证据链，不等整体成形"
    },
    {
      "from": "lexmind",
      "to": "strategy",
      "w": 0.5,
      "type": "excitatory",
      "tract": "语义枢纽-策略引擎",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "案型定性完成即算攻防，两条线并行"
    },
    {
      "from": "lexmind",
      "to": "workspace",
      "w": 0.6,
      "type": "excitatory",
      "tract": "法律语义-广播",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "法律结论优先进广播，专业判断不该排在通用之后"
    },
    {
      "from": "evidence",
      "to": "strategy",
      "w": 0.55,
      "type": "excitatory",
      "tract": "证据-策略耦合",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "证据链断点直接改行动阶梯，不各说各话"
    },
    {
      "from": "evidence",
      "to": "workspace",
      "w": 0.5,
      "type": "excitatory",
      "tract": "证据-广播",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "断链进意识：说不出证据不足在哪一环就不许说结论"
    },
    {
      "from": "strategy",
      "to": "ofc",
      "w": 0.5,
      "type": "excitatory",
      "tract": "策略-价值评估",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "攻防方案按同一期望值口径比选，不两套算法"
    },
    {
      "from": "strategy",
      "to": "workspace",
      "w": 0.45,
      "type": "excitatory",
      "tract": "策略-广播",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "行动阶梯进意识，用户看得到下一步"
    },
    {
      "from": "review",
      "to": "contract",
      "w": 0.55,
      "type": "excitatory",
      "tract": "审查-锻造耦合",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "审出的问题直接改条款，不落在报告里等人改"
    },
    {
      "from": "review",
      "to": "workspace",
      "w": 0.45,
      "type": "excitatory",
      "tract": "审查-广播",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "风险等级进意识，红黄绿不是形容词"
    },
    {
      "from": "contract",
      "to": "drafting",
      "w": 0.5,
      "type": "excitatory",
      "tract": "锻造-成文",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "锻好的条款直接进文书骨架，不二次誊写"
    },
    {
      "from": "adjudication",
      "to": "lexmind",
      "w": 0.55,
      "type": "excitatory",
      "tract": "裁判思维-法律语义",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "争点归纳结果回到语义枢纽，下一轮定性更准"
    },
    {
      "from": "adjudication",
      "to": "dmn",
      "w": 0.5,
      "type": "excitatory",
      "tract": "裁判思维-反事实",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "法官席与对手席共用同一套事实，各按自己的立场推"
    },
    {
      "from": "adjudication",
      "to": "workspace",
      "w": 0.45,
      "type": "excitatory",
      "tract": "裁判思维-广播",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "争点与裁量空间进意识，不藏在结论里"
    },
    {
      "from": "finance",
      "to": "workspace",
      "w": 0.4,
      "type": "excitatory",
      "tract": "金融半球-广播",
      "latency_ms": 20,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "法融交叉结论也要进意识，不能闷在半球里"
    },
    {
      "from": "finance",
      "to": "ofc",
      "w": 0.5,
      "type": "excitatory",
      "tract": "金融-价值评估",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "估值与比选同一套口径，法律方案与钱用一把尺"
    },
    {
      "from": "drafting",
      "to": "sma",
      "w": 0.45,
      "type": "excitatory",
      "tract": "文书-序列编排",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "文书骨架交给序列编排，顺序错可整体重排"
    },
    {
      "from": "pfc",
      "to": "limbic",
      "w": 0.35,
      "type": "inhibitory",
      "tract": "前额-杏仁核抑制",
      "latency_ms": 22,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "风险估值不许盖过证据强度"
    },
    {
      "from": "dmn",
      "to": "acc",
      "w": 0.3,
      "type": "inhibitory",
      "tract": "默认网络-监控抑制",
      "latency_ms": 21,
      "myelin": false,
      "neuro": "GABA",
      "beyond": "反事实推演期间暂缓报警，避免自我打断"
    },
    {
      "from": "basal",
      "to": "dmn",
      "w": 0.35,
      "type": "inhibitory",
      "tract": "基底节-默认网络抑制",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "选定执行路径时压住反事实，先做完再回头挑"
    },
    {
      "from": "thalamus",
      "to": "reticular",
      "w": 0.3,
      "type": "inhibitory",
      "tract": "丘脑-网状回送",
      "latency_ms": 24,
      "myelin": false,
      "neuro": "GABA",
      "beyond": "通路占用过高时反向降档，防止自激发"
    },
    {
      "from": "workspace",
      "to": "basal",
      "w": 0.35,
      "type": "inhibitory",
      "tract": "广播-门控抑制",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "已进入意识的路由不再重开竞争，避免抖动"
    },
    {
      "from": "plastic",
      "to": "basal",
      "w": 0.3,
      "type": "inhibitory",
      "tract": "巩固-门控抑制",
      "latency_ms": 25,
      "myelin": false,
      "neuro": "GABA",
      "beyond": "巩固期间不再开新路由，避免把临时权重写进长期"
    },
    {
      "from": "metacog",
      "to": "express",
      "w": 0.35,
      "type": "inhibitory",
      "tract": "元认知-产出抑制",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "置信不够时先降级措辞，不许强说"
    },
    {
      "from": "cerebellum",
      "to": "acc",
      "w": 0.3,
      "type": "inhibitory",
      "tract": "小脑-监控抑制",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "格式类误差不再触发冲突报警，避免噪声刷屏"
    },
    {
      "from": "plastic",
      "to": "workspace",
      "w": 0.4,
      "type": "excitatory",
      "tract": "调质-广播",
      "latency_ms": 20,
      "myelin": false,
      "neuro": "去甲肾上腺素",
      "beyond": "注意力按显著性分配，广播名额不是先到先得"
    },
    {
      "from": "plastic",
      "to": "reticular",
      "w": 0.35,
      "type": "excitatory",
      "tract": "调质-唤醒",
      "latency_ms": 22,
      "myelin": false,
      "neuro": "去甲肾上腺素",
      "beyond": "警觉度与调质对账，别一边升压一边降档"
    },
    {
      "from": "basal",
      "to": "lexmind",
      "w": 0.7,
      "type": "excitatory",
      "tract": "门控-法律语义",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "选中文书/定性线即点亮法律心智，专家不等排队"
    },
    {
      "from": "basal",
      "to": "evidence",
      "w": 0.6,
      "type": "excitatory",
      "tract": "门控-证据引擎",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "选中证据线即点亮证据链，跨步不重算"
    },
    {
      "from": "basal",
      "to": "strategy",
      "w": 0.6,
      "type": "excitatory",
      "tract": "门控-策略引擎",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "选中攻防线即点亮策略，缩短端到端"
    },
    {
      "from": "basal",
      "to": "review",
      "w": 0.55,
      "type": "excitatory",
      "tract": "门控-审查引擎",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "选中审查线即点亮风险扫描"
    },
    {
      "from": "basal",
      "to": "contract",
      "w": 0.55,
      "type": "excitatory",
      "tract": "门控-锻造",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "选中锻造线即点亮条款库"
    },
    {
      "from": "basal",
      "to": "drafting",
      "w": 0.55,
      "type": "excitatory",
      "tract": "门控-文书",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "选中文书线即点亮骨架"
    },
    {
      "from": "basal",
      "to": "adjudication",
      "w": 0.55,
      "type": "excitatory",
      "tract": "门控-裁判思维",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "选中分析线即点亮争点归纳"
    },
    {
      "from": "basal",
      "to": "finance",
      "w": 0.5,
      "type": "excitatory",
      "tract": "门控-金融半球",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "选中金融线即点亮估值，法融不混线"
    },
    {
      "from": "lexmind",
      "to": "review",
      "w": 0.5,
      "type": "excitatory",
      "tract": "语义枢纽-审查",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "定性结论直接送审查，不重复读一遍材料"
    },
    {
      "from": "lexmind",
      "to": "contract",
      "w": 0.5,
      "type": "excitatory",
      "tract": "语义枢纽-锻造",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "案型定性直接决定该锻哪些条款"
    },
    {
      "from": "lexmind",
      "to": "drafting",
      "w": 0.45,
      "type": "excitatory",
      "tract": "语义枢纽-文书",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "定性结论直接进文书骨架"
    },
    {
      "from": "lexmind",
      "to": "adjudication",
      "w": 0.5,
      "type": "excitatory",
      "tract": "语义枢纽-裁判",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "定性结论直接进争点归纳"
    },
    {
      "from": "evidence",
      "to": "lexmind",
      "w": 0.5,
      "type": "excitatory",
      "tract": "证据-语义回送",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "证据不足时反过来要求重新定性"
    },
    {
      "from": "evidence",
      "to": "review",
      "w": 0.45,
      "type": "excitatory",
      "tract": "证据-审查",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "证据缺口直接转成审查风险项"
    },
    {
      "from": "evidence",
      "to": "drafting",
      "w": 0.45,
      "type": "excitatory",
      "tract": "证据-文书",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "可证事实才进文书，不可证的不写进去"
    },
    {
      "from": "evidence",
      "to": "adjudication",
      "w": 0.5,
      "type": "excitatory",
      "tract": "证据-裁判",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "举证责任分配按法官视角复核一遍"
    },
    {
      "from": "strategy",
      "to": "lexmind",
      "w": 0.45,
      "type": "excitatory",
      "tract": "策略-语义回送",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "攻防发现定性有问题的，回头改定性"
    },
    {
      "from": "strategy",
      "to": "evidence",
      "w": 0.55,
      "type": "excitatory",
      "tract": "策略-证据",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "行动阶梯反向指定先补哪一份证据"
    },
    {
      "from": "strategy",
      "to": "drafting",
      "w": 0.4,
      "type": "excitatory",
      "tract": "策略-文书",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "谈判文书按策略定措辞强度"
    },
    {
      "from": "strategy",
      "to": "adjudication",
      "w": 0.45,
      "type": "excitatory",
      "tract": "策略-裁判",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "方案可行性过一遍法官视角"
    },
    {
      "from": "review",
      "to": "lexmind",
      "w": 0.45,
      "type": "excitatory",
      "tract": "审查-语义回送",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "审出的定性争议回到语义枢纽重判"
    },
    {
      "from": "review",
      "to": "drafting",
      "w": 0.45,
      "type": "excitatory",
      "tract": "审查-文书",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "审查意见直接落成修订表，不另写一份"
    },
    {
      "from": "review",
      "to": "adjudication",
      "w": 0.4,
      "type": "excitatory",
      "tract": "审查-裁判",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "条款风险按裁判口径再估一次后果"
    },
    {
      "from": "contract",
      "to": "lexmind",
      "w": 0.45,
      "type": "excitatory",
      "tract": "锻造-语义回送",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "锻条款时发现定性不准，回头改"
    },
    {
      "from": "contract",
      "to": "review",
      "w": 0.5,
      "type": "excitatory",
      "tract": "锻造-审查回送",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "锻好的条款立刻自检一遍"
    },
    {
      "from": "finance",
      "to": "lexmind",
      "w": 0.45,
      "type": "excitatory",
      "tract": "金融-语义",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "估值结论回到法律定性，钱与责任同一套事实"
    },
    {
      "from": "finance",
      "to": "strategy",
      "w": 0.5,
      "type": "excitatory",
      "tract": "金融-策略",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "期望值口径统一，诉讼与和解用一把尺"
    },
    {
      "from": "finance",
      "to": "contract",
      "w": 0.45,
      "type": "excitatory",
      "tract": "金融-锻造",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "对价与支付条款按测算结果落字"
    },
    {
      "from": "drafting",
      "to": "lexmind",
      "w": 0.4,
      "type": "excitatory",
      "tract": "文书-语义回送",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "写不下去时回到定性找缺的要件"
    },
    {
      "from": "drafting",
      "to": "evidence",
      "w": 0.4,
      "type": "excitatory",
      "tract": "文书-证据",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "文书每句话挂得到证据，挂不上的不写"
    },
    {
      "from": "adjudication",
      "to": "evidence",
      "w": 0.5,
      "type": "excitatory",
      "tract": "裁判-证据",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "争点确定后只补争点相关证据，不做全量"
    },
    {
      "from": "adjudication",
      "to": "strategy",
      "w": 0.45,
      "type": "excitatory",
      "tract": "裁判-策略",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "裁量空间反向修正行动期望值"
    },
    {
      "from": "adjudication",
      "to": "contract",
      "w": 0.4,
      "type": "excitatory",
      "tract": "裁判-锻造",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "条款效力按裁判口径预判，不凭模板"
    },
    {
      "from": "acc",
      "to": "lexmind",
      "w": 0.45,
      "type": "excitatory",
      "tract": "监控-法律语义",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "专家结论之间的冲突在此被抓住"
    },
    {
      "from": "acc",
      "to": "evidence",
      "w": 0.4,
      "type": "excitatory",
      "tract": "监控-证据",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "证据结论与定性结论不一致即报警"
    },
    {
      "from": "acc",
      "to": "strategy",
      "w": 0.4,
      "type": "excitatory",
      "tract": "监控-策略",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "策略与证据强度不匹配即报警"
    },
    {
      "from": "metacog",
      "to": "lexmind",
      "w": 0.4,
      "type": "excitatory",
      "tract": "元认知-法律语义",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "置信不够时要求专家补依据而不是硬答"
    },
    {
      "from": "metacog",
      "to": "evidence",
      "w": 0.4,
      "type": "excitatory",
      "tract": "元认知-证据",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "证据类不确定单独计一档，不与规范类混算"
    },
    {
      "from": "workspace",
      "to": "review",
      "w": 0.4,
      "type": "excitatory",
      "tract": "广播-审查",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "审出的红线也要进意识，不能只在报告里"
    },
    {
      "from": "workspace",
      "to": "contract",
      "w": 0.4,
      "type": "excitatory",
      "tract": "广播-锻造",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "锻出的条款进意识，用户看得到改了什么"
    },
    {
      "from": "workspace",
      "to": "drafting",
      "w": 0.4,
      "type": "excitatory",
      "tract": "广播-文书",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "文书骨架进意识，改骨架不必重说"
    },
    {
      "from": "workspace",
      "to": "finance",
      "w": 0.35,
      "type": "excitatory",
      "tract": "广播-金融",
      "latency_ms": 20,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "测算过程进意识，只报一个数不算交代"
    },
    {
      "from": "workspace",
      "to": "adjudication",
      "w": 0.4,
      "type": "excitatory",
      "tract": "广播-裁判",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "裁量区间进意识，不说死"
    },
    {
      "from": "cerebellum",
      "to": "drafting",
      "w": 0.45,
      "type": "excitatory",
      "tract": "小脑-文书精修",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "文书格式与冗余在出口前压掉"
    },
    {
      "from": "sma",
      "to": "drafting",
      "w": 0.45,
      "type": "excitatory",
      "tract": "序列-文书骨架",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "文书顺序错可整体重排，不改内容"
    },
    {
      "from": "pfc",
      "to": "contract",
      "w": 0.45,
      "type": "excitatory",
      "tract": "执行-锻造",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "条款顺序由执行编排定，不是想到哪写到哪"
    },
    {
      "from": "pfc",
      "to": "drafting",
      "w": 0.45,
      "type": "excitatory",
      "tract": "执行-文书",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "文书作业单与论证作业单共用一套顺序"
    },
    {
      "from": "pfc",
      "to": "finance",
      "w": 0.3,
      "type": "inhibitory",
      "tract": "前额-金融抑制",
      "latency_ms": 20,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "非金融问题压住半球，别什么都往估值上靠"
    },
    {
      "from": "metacog",
      "to": "strategy",
      "w": 0.3,
      "type": "inhibitory",
      "tract": "元认知-策略抑制",
      "latency_ms": 19,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "事实不清时不许先谈策略，先补事实"
    },
    {
      "from": "acc",
      "to": "adjudication",
      "w": 0.3,
      "type": "inhibitory",
      "tract": "监控-裁判抑制",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "争点未定即推裁量是越权，压住"
    },
    {
      "from": "thalamus",
      "to": "acc",
      "w": 0.5,
      "type": "excitatory",
      "tract": "丘脑-冲突监测",
      "latency_ms": 13,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "唤醒档一上来就喂冲突监测，慢变量不被忽略"
    },
    {
      "from": "wernicke",
      "to": "acc",
      "w": 0.5,
      "type": "excitatory",
      "tract": "理解-冲突监测",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "一句话里同时含诉求与抗辩苗头即触发冲突监测"
    },
    {
      "from": "dmn",
      "to": "limbic",
      "w": 0.4,
      "type": "excitatory",
      "tract": "默认模式-显著性",
      "latency_ms": 19,
      "myelin": false,
      "neuro": "乙酰胆碱",
      "beyond": "走神的自我投射也能被显著性拦下，不实算"
    },
    {
      "from": "predict",
      "to": "wernicke",
      "w": 0.5,
      "type": "excitatory",
      "tract": "预测-理解",
      "latency_ms": 12,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "自上而下预期先于理解，误差可量化"
    },
    {
      "from": "acc",
      "to": "basal",
      "w": -0.4,
      "type": "inhibitory",
      "tract": "冲突-门控抑制",
      "latency_ms": 17,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "争点未定先压住习惯门，逼出澄清而非硬落位"
    },
    {
      "from": "workspace",
      "to": "limbic",
      "w": 0.55,
      "type": "excitatory",
      "tract": "工作记忆-显著性",
      "latency_ms": 18,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "暂存的事实与显著性绑定，后果/时限/金额五因子加权"
    },
    {
      "from": "pfc",
      "to": "workspace",
      "w": 0.6,
      "type": "excitatory",
      "tract": "执行-工作记忆",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "论证作业单进工作记忆按序展开，不跳步"
    },
    {
      "from": "basal",
      "to": "dmn",
      "w": -0.45,
      "type": "inhibitory",
      "tract": "门控-默认模式抑制",
      "latency_ms": 20,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "已胜出路由压住默认模式，避免自我投射干扰"
    },
    {
      "from": "limbic",
      "to": "dmn",
      "w": 0.4,
      "type": "excitatory",
      "tract": "显著性-默认模式",
      "latency_ms": 19,
      "myelin": false,
      "neuro": "乙酰胆碱",
      "beyond": "显著性把相关经验从默认模式拉进意识"
    },
    {
      "from": "predict",
      "to": "limbic",
      "w": 0.45,
      "type": "excitatory",
      "tract": "预测-显著性",
      "latency_ms": 13,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "预期落空即升显著性，误差驱动注意"
    },
    {
      "from": "atl",
      "to": "wernicke",
      "w": 0.6,
      "type": "excitatory",
      "tract": "语义枢纽-理解",
      "latency_ms": 12,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "非模态语义枢纽收敛异模态说法，换个词也认得出义"
    },
    {
      "from": "tpj",
      "to": "metacog",
      "w": 0.5,
      "type": "excitatory",
      "tract": "TPJ-元认知",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "因果/社会推理信号喂元认知做不确定性分解"
    },
    {
      "from": "ofc",
      "to": "limbic",
      "w": 0.5,
      "type": "excitatory",
      "tract": "眶额-显著性",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "价值评估直接调显著性，风险值不靠印象"
    },
    {
      "from": "nacc",
      "to": "limbic",
      "w": 0.5,
      "type": "excitatory",
      "tract": "伏隔核-显著性",
      "latency_ms": 15,
      "myelin": true,
      "neuro": "多巴胺",
      "beyond": "奖赏预期调显著性，用户真正在意的先顶上来"
    },
    {
      "from": "rsc",
      "to": "dmn",
      "w": 0.5,
      "type": "excitatory",
      "tract": "压后皮层-默认模式",
      "latency_ms": 18,
      "myelin": false,
      "neuro": "乙酰胆碱",
      "beyond": "场景记忆从压后皮层进默认模式，补环节标推补"
    },
    {
      "from": "sma",
      "to": "contract",
      "w": 0.4,
      "type": "excitatory",
      "tract": "辅助运动-锻造",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "条款顺序由序列区编排，不是想到哪写到哪"
    },
    {
      "from": "cerebellum",
      "to": "pfc",
      "w": 0.4,
      "type": "excitatory",
      "tract": "小脑-执行",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "时序精修喂执行，论证步骤不错位"
    },
    {
      "from": "hypothalamus",
      "to": "limbic",
      "w": 0.5,
      "type": "excitatory",
      "tract": "下丘脑-显著性",
      "latency_ms": 16,
      "myelin": false,
      "neuro": "谷氨酸",
      "beyond": "内稳态信号调显著性，身体性后果不被忽略"
    },
    {
      "from": "reticular",
      "to": "thalamus",
      "w": -0.5,
      "type": "inhibitory",
      "tract": "网状核-丘脑门控",
      "latency_ms": 11,
      "myelin": true,
      "neuro": "GABA",
      "beyond": "网状核兜底压住噪音通道，只放被拣选的入口"
    },
    {
      "from": "atl",
      "to": "pfc",
      "w": 0.5,
      "type": "excitatory",
      "tract": "语义枢纽-执行",
      "latency_ms": 14,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "收敛后的语义进执行区做多关系整合"
    },
    {
      "from": "tpj",
      "to": "strategy",
      "w": 0.45,
      "type": "excitatory",
      "tract": "TPJ-策略",
      "latency_ms": 16,
      "myelin": true,
      "neuro": "谷氨酸",
      "beyond": "结构映射的因果链直接喂攻防策略矩阵"
    }
  ],
  "assemblies": {
    "sensory": [
      {
        "key": "modality",
        "name": "输入模态判定",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "entity",
        "name": "实体抽取（人/物/金额/时间/机构）",
        "threshold": 0.1,
        "beyond": "全量特征留存：人脑在早期就丢弃细节，我留到理解层再筛"
      },
      {
        "key": "length",
        "name": "长度与体裁判定",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "tone",
        "name": "语气与程度词检测",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "doc_type",
        "name": "文书类型判定",
        "threshold": 0.12,
        "beyond": "裁定书/决定书/判决书/合同/公证书各有读法，先定型再抽要素"
      }
    ],
    "metacog": [
      {
        "key": "decompose",
        "name": "不确定性分解",
        "threshold": 0.1,
        "beyond": "人脑只有「没把握」三个字，我给出不确定性的构成与解法"
      },
      {
        "key": "calibrate",
        "name": "置信校准",
        "threshold": 0.1,
        "beyond": "三因子复算，明写不是胜诉概率"
      },
      {
        "key": "stop_rule",
        "name": "停机准则（够了就停）",
        "threshold": 0.2,
        "beyond": null
      },
      {
        "key": "calib_domain",
        "name": "领域置信校准",
        "threshold": 0.1,
        "beyond": "跨域结论按各自证据强度分别校准，不并一道置信"
      }
    ],
    "thalamus": [
      {
        "key": "lexical",
        "name": "词汇信号检测",
        "threshold": 0.1,
        "beyond": "多通道并行点亮，不串行解析"
      },
      {
        "key": "syntactic",
        "name": "句法信号检测",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "noise",
        "name": "噪声/空输入检测",
        "threshold": 0.05,
        "beyond": "只拦真空，不拦碎话——当事人说话本就碎"
      },
      {
        "key": "urgent",
        "name": "时限/紧急检测",
        "threshold": 0.2,
        "beyond": "慢变量（时效）也能被顶上来"
      },
      {
        "key": "modality",
        "name": "模态判定（提问/材料/指令/信号）",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "arousal",
        "name": "唤醒档位预热",
        "threshold": 0.05,
        "beyond": "门控在语义完成前就按唤醒档预热，缩短端到端延迟"
      },
      {
        "key": "domain",
        "name": "领域预判定（数据/知产/刑事/行政）",
        "threshold": 0.1,
        "beyond": "入口先判领域，下游路由只接住被拣选的入口，不串行解析"
      }
    ],
    "wernicke": [
      {
        "key": "negation",
        "name": "否定检测",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "quantity",
        "name": "数量金额检测",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "party",
        "name": "主体/立场检测",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "action",
        "name": "行为/动作检测",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "ask",
        "name": "诉求类型检测",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "gap",
        "name": "信息缺口检测",
        "threshold": 0.15,
        "beyond": "事实与推测分仓：猜的标 why 与置信，不混入事实"
      },
      {
        "key": "scope",
        "name": "范围限定检测",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "modality_verb",
        "name": "能愿动词检测（可以/应当/不得）",
        "threshold": 0.15,
        "beyond": "能愿动词直接决定规范性质，不靠语气猜"
      }
    ],
    "limbic": [
      {
        "key": "bind",
        "name": "事件绑定（海马）",
        "threshold": 0.1,
        "beyond": "取回原文不是重建，两次查询一致"
      },
      {
        "key": "valence",
        "name": "情绪权重（杏仁核）",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "risk",
        "name": "风险估值（岛叶）",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "salience",
        "name": "显著性排序",
        "threshold": 0.1,
        "beyond": "按后果/时限/金额/争议/被问到五因子加权，不凭印象"
      },
      {
        "key": "scene",
        "name": "场景重建",
        "threshold": 0.15,
        "beyond": "补出来的环节标推补，不与取回事实同列"
      },
      {
        "key": "source",
        "name": "来源标记",
        "threshold": 0.1,
        "beyond": "每条记忆带出处，取回即可溯源"
      },
      {
        "key": "compliance",
        "name": "合规风险估值",
        "threshold": 0.15,
        "beyond": "行政/数据合规风险单列权重，不并入一般显著性"
      }
    ],
    "basal": [
      {
        "key": "habit_gate",
        "name": "习惯门（每轮重算）",
        "threshold": 0.2,
        "beyond": "同输入同分，不继承上一轮选择"
      },
      {
        "key": "route_contract",
        "name": "合同锻造路由",
        "threshold": 0.3,
        "beyond": null
      },
      {
        "key": "route_evidence",
        "name": "证据链路由",
        "threshold": 0.3,
        "beyond": null
      },
      {
        "key": "route_strategy",
        "name": "攻防策略路由",
        "threshold": 0.3,
        "beyond": null
      },
      {
        "key": "route_draft",
        "name": "文书起草路由",
        "threshold": 0.3,
        "beyond": null
      },
      {
        "key": "route_finance",
        "name": "金融半球路由",
        "threshold": 0.3,
        "beyond": null
      },
      {
        "key": "route_review",
        "name": "合同审查路由",
        "threshold": 0.3,
        "beyond": null
      },
      {
        "key": "route_adjudication",
        "name": "裁判思维路由",
        "threshold": 0.3,
        "beyond": null
      },
      {
        "key": "route_data",
        "name": "数据合规路由",
        "threshold": 0.3,
        "beyond": null
      },
      {
        "key": "route_ip",
        "name": "知产/商业秘密路由",
        "threshold": 0.3,
        "beyond": null
      },
      {
        "key": "route_crime",
        "name": "刑事辩护路由",
        "threshold": 0.3,
        "beyond": null
      },
      {
        "key": "route_admin",
        "name": "行政争议路由",
        "threshold": 0.3,
        "beyond": null
      }
    ],
    "workspace": [
      {
        "key": "compete",
        "name": "候选竞争",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "pending",
        "name": "落选保留（可唤回）",
        "threshold": 0.05,
        "beyond": "落选项留理由，人脑进不了意识的永久丢了"
      },
      {
        "key": "novelty",
        "name": "新颖性检测",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "capacity",
        "name": "容量限制",
        "threshold": 0.15,
        "beyond": "广播名额有限且有据，不靠注意力随机漏"
      },
      {
        "key": "rebroadcast",
        "name": "再广播（落选唤回）",
        "threshold": 0.1,
        "beyond": "落选项可凭新证据重新竞争，人脑做不到"
      }
    ],
    "acc": [
      {
        "key": "conflict",
        "name": "冲突监测",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "adversary",
        "name": "对立面强制",
        "threshold": 0.1,
        "beyond": "对立面是输出前置条件；写不出明说"
      },
      {
        "key": "error",
        "name": "误差登记",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "selfcheck",
        "name": "输出后自校验",
        "threshold": 0.1,
        "beyond": "漏点/出格项触发再改写而不是直接放行"
      },
      {
        "key": "load",
        "name": "负荷报警",
        "threshold": 0.2,
        "beyond": "越界即收敛并明说，不硬撑"
      }
    ],
    "pfc": [
      {
        "key": "hard_gate",
        "name": "硬闸（代码级）",
        "threshold": 0.05,
        "beyond": "不靠意志力，踩线根本出不去"
      },
      {
        "key": "plan",
        "name": "作业单生成",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "inhibit",
        "name": "抑制控制",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "sequence",
        "name": "作业单排序",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "arbitration",
        "name": "专家结论仲裁",
        "threshold": 0.15,
        "beyond": "多专家结论冲突时按证据强度仲裁，不按先后"
      },
      {
        "key": "multi_rel",
        "name": "多关系整合",
        "threshold": 0.15,
        "beyond": "因果/组成/对立/证据四类关系在同一条论证里并排，不抢唯一结论"
      }
    ],
    "dmn": [
      {
        "key": "judge",
        "name": "法官席",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "opponent",
        "name": "对手席",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "regulator",
        "name": "规制者席",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "client",
        "name": "当事人席",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "legislator",
        "name": "立法者席",
        "threshold": 0.2,
        "beyond": "第四席：规范目的与政策后果也要有人问"
      },
      {
        "key": "timeline",
        "name": "时间轴推演",
        "threshold": 0.2,
        "beyond": null
      }
    ],
    "predict": [
      {
        "key": "expect",
        "name": "自上而下预期",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "verify",
        "name": "误差校验",
        "threshold": 0.1,
        "beyond": "误差率可量化，漏项/出格项都登记"
      },
      {
        "key": "metacog",
        "name": "元认知可信度",
        "threshold": 0.1,
        "beyond": "三因子复算，明写不是胜诉概率"
      },
      {
        "key": "prior",
        "name": "先验登记",
        "threshold": 0.1,
        "beyond": "先验写明来源，误差不许被先验吸收"
      },
      {
        "key": "rewrite",
        "name": "误差改写",
        "threshold": 0.15,
        "beyond": "超阈即改写并明说改在哪，不静默消化"
      }
    ],
    "express": [
      {
        "key": "calibrate",
        "name": "强度校准",
        "threshold": 0.1,
        "beyond": "修辞不越过证据：低置信强表述降级"
      },
      {
        "key": "plain",
        "name": "术语平实化",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "audience",
        "name": "受众适配",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "skeleton",
        "name": "论证骨架",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "citation",
        "name": "引证挂载",
        "threshold": 0.15,
        "beyond": "结论挂得到具体依据，挂不上的不强说"
      }
    ],
    "plastic": [
      {
        "key": "dopa",
        "name": "多巴胺强化",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "sero",
        "name": "血清素耐心",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "glut",
        "name": "谷氨酸巩固",
        "threshold": 0.1,
        "beyond": "跨会话巩固，原文不改只调权重"
      },
      {
        "key": "prune",
        "name": "低频路径剪枝",
        "threshold": 0.2,
        "beyond": null
      },
      {
        "key": "persist",
        "name": "跨会话持久化",
        "threshold": 0.1,
        "beyond": "权重跨会话延续，原文永不改写"
      }
    ],
    "cerebellum": [
      {
        "key": "polish",
        "name": "修辞复核降级",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "review",
        "name": "输出复核",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "consistency",
        "name": "一致性复核",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "redundancy",
        "name": "冗余抑制",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "format",
        "name": "格式对齐",
        "threshold": 0.1,
        "beyond": null
      }
    ],
    "lexmind": [
      {
        "key": "parse",
        "name": "要件解析",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "chain",
        "name": "请求权链条",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "subsume",
        "name": "要件归摄",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "defend",
        "name": "抗辩树",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "element",
        "name": "要件拆解",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "domain_parse",
        "name": "域要件解析",
        "threshold": 0.1,
        "beyond": "数据/知产/刑事/行政各域要件套独立拆，不混买卖合同的要件"
      }
    ],
    "evidence": [
      {
        "key": "three",
        "name": "三性预检",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "burden",
        "name": "举证责任分配",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "standard",
        "name": "证明标准分层",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "chain_break",
        "name": "链断点定位",
        "threshold": 0.15,
        "beyond": "断在哪一环写明，不笼统说证据不足"
      },
      {
        "key": "supplement",
        "name": "补强路径",
        "threshold": 0.15,
        "beyond": "断链给得出可执行的补强动作"
      },
      {
        "key": "digital",
        "name": "电子证据检测",
        "threshold": 0.1,
        "beyond": "电子数据/数据日志/区块链存证单独预检三性，不套书证规则"
      }
    ],
    "strategy": [
      {
        "key": "matrix",
        "name": "攻防矩阵",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "ladder",
        "name": "行动阶梯",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "expected",
        "name": "期望值比选",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "settlement",
        "name": "和解比选",
        "threshold": 0.15,
        "beyond": "诉讼与和解按同一期望值口径比，不两套算法"
      },
      {
        "key": "escalation",
        "name": "升级阶梯",
        "threshold": 0.2,
        "beyond": null
      },
      {
        "key": "cross_domain",
        "name": "跨域策略",
        "threshold": 0.15,
        "beyond": "民刑交叉/行刑衔接时两套攻防并排，不抢单一口径"
      }
    ],
    "review": [
      {
        "key": "risk_scan",
        "name": "风险扫描",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "clause",
        "name": "条款审查",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "summary",
        "name": "审查结论",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "concession",
        "name": "让步线划定",
        "threshold": 0.2,
        "beyond": "三档筹码可让度明写，谈判时不临场发挥"
      },
      {
        "key": "redline",
        "name": "红线条款",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "domain",
        "name": "域审查路由",
        "threshold": 0.15,
        "beyond": "数据/知产/刑事/行政条款按域红线审，不套通用清单"
      }
    ],
    "contract": [
      {
        "key": "type",
        "name": "合同类型识别",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "forge",
        "name": "条款锻造",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "audit",
        "name": "缺失审计",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "clause_bank",
        "name": "条款库取用",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "missing",
        "name": "缺失项审计",
        "threshold": 0.15,
        "beyond": "缺什么明说，不用通用条款糊过去"
      }
    ],
    "finance": [
      {
        "key": "gate",
        "name": "金融门控路由",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "dcf",
        "name": "DCF 估值",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "valuation",
        "name": "估值门控",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "wacc",
        "name": "WACC 资本成本",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "sensitivity",
        "name": "敏感性分析",
        "threshold": 0.2,
        "beyond": null
      }
    ],
    "drafting": [
      {
        "key": "detect",
        "name": "文书类型检测",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "skeleton",
        "name": "骨架生成",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "format",
        "name": "格式规范",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "citation",
        "name": "文书引证",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "checklist",
        "name": "要素清单核销",
        "threshold": 0.15,
        "beyond": null
      }
    ],
    "adjudication": [
      {
        "key": "mind",
        "name": "法官裁判思维",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "analysis",
        "name": "全案分析",
        "threshold": 0.1,
        "beyond": null
      },
      {
        "key": "precedent",
        "name": "类案参照",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "discretion",
        "name": "自由裁量区间",
        "threshold": 0.15,
        "beyond": null
      }
    ],
    "reticular": [
      {
        "key": "arousal",
        "name": "唤醒档位定档",
        "threshold": 0.05,
        "beyond": "三档可复核：噪声/常规/深耕，档位写进 trace 不藏在背后"
      },
      {
        "key": "noise_gate",
        "name": "噪声闸",
        "threshold": 0.05,
        "beyond": null
      },
      {
        "key": "load_limit",
        "name": "负荷上限",
        "threshold": 0.2,
        "beyond": "越界即收敛并明说，不硬撑到答案变形"
      }
    ],
    "hypothalamus": [
      {
        "key": "load_meter",
        "name": "负荷计量",
        "threshold": 0.1,
        "beyond": "负荷是数字不是感觉：长度/并行数/检索数/反事实轮数逐项计"
      },
      {
        "key": "resource",
        "name": "资源调度",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "overload",
        "name": "过载报警",
        "threshold": 0.25,
        "beyond": null
      }
    ],
    "atl": [
      {
        "key": "synonym",
        "name": "同义归一",
        "threshold": 0.1,
        "beyond": "换说法也能召回，不为归一牺牲原词"
      },
      {
        "key": "sense",
        "name": "义项消歧",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "retain_origin",
        "name": "原词保留",
        "threshold": 0.05,
        "beyond": "归一后仍记得原话，因此能分辨「这两个说法在本案不是一回事」"
      },
      {
        "key": "category",
        "name": "上下位归位",
        "threshold": 0.15,
        "beyond": null
      }
    ],
    "rsc": [
      {
        "key": "timeline",
        "name": "时序链搭建",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "fill_gap",
        "name": "推补标记",
        "threshold": 0.1,
        "beyond": "补出来的环节一律标推补，不与取回的事实同列"
      },
      {
        "key": "coherence",
        "name": "连贯检验",
        "threshold": 0.15,
        "beyond": null
      }
    ],
    "ofc": [
      {
        "key": "value",
        "name": "期望值比选",
        "threshold": 0.15,
        "beyond": "公式与取值全部列出，可复算不拍脑袋"
      },
      {
        "key": "frame_check",
        "name": "框架效应检验",
        "threshold": 0.2,
        "beyond": "同一方案换表述再算一遍，不一致即报警"
      },
      {
        "key": "regret",
        "name": "反事实比较",
        "threshold": 0.2,
        "beyond": null
      }
    ],
    "tpj": [
      {
        "key": "belief",
        "name": "对方信念建模",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "info_set",
        "name": "信息集隔离",
        "threshold": 0.1,
        "beyond": "对手只拿得到他本该拿到的材料，我知道的不能算进他的牌"
      },
      {
        "key": "reaction",
        "name": "对方反应预测",
        "threshold": 0.2,
        "beyond": null
      }
    ],
    "sma": [
      {
        "key": "skeleton",
        "name": "论证骨架排序",
        "threshold": 0.15,
        "beyond": null
      },
      {
        "key": "reorder",
        "name": "整体重排",
        "threshold": 0.1,
        "beyond": "骨架与内容解耦，改顺序不碰证据与结论，重排零代价"
      },
      {
        "key": "interrupt",
        "name": "中断点登记",
        "threshold": 0.2,
        "beyond": null
      }
    ],
    "nacc": [
      {
        "key": "rpe",
        "name": "奖励预测误差",
        "threshold": 0.1,
        "beyond": "记的是「比预期好多少」，不是「有多好」"
      },
      {
        "key": "cap",
        "name": "强化上限",
        "threshold": 0.15,
        "beyond": "短期高反馈路径不许压过真有用的路径"
      },
      {
        "key": "discount",
        "name": "长期折扣",
        "threshold": 0.2,
        "beyond": null
      }
    ]
  },
  "regionMeta": {
    "thalamus": {
      "name": "丘脑",
      "sys": "感觉入口",
      "color": "#ff8a5c"
    },
    "wernicke": {
      "name": "韦尼克区",
      "sys": "语言理解",
      "color": "#ffd24d"
    },
    "limbic": {
      "name": "边缘系统",
      "sys": "情绪记忆",
      "color": "#ff5d9e"
    },
    "basal": {
      "name": "基底节",
      "sys": "动作门控",
      "color": "#c792ea"
    },
    "workspace": {
      "name": "全局工作记忆",
      "sys": "全局广播",
      "color": "#6fe9ff"
    },
    "acc": {
      "name": "前扣带回",
      "sys": "冲突监控",
      "color": "#5aa9ff"
    },
    "pfc": {
      "name": "前额叶",
      "sys": "执行控制",
      "color": "#4dffc3"
    },
    "dmn": {
      "name": "默认网络",
      "sys": "内省自我",
      "color": "#9d7bff"
    },
    "predict": {
      "name": "预测编码",
      "sys": "贝叶斯",
      "color": "#7be0ff"
    },
    "express": {
      "name": "布洛卡表达",
      "sys": "语言输出",
      "color": "#ffe066"
    },
    "plastic": {
      "name": "可塑性",
      "sys": "突触可塑",
      "color": "#a6ff8f"
    },
    "cerebellum": {
      "name": "小脑",
      "sys": "时序协调",
      "color": "#8fd6ff"
    },
    "lexmind": {
      "name": "法律心智",
      "sys": "法律专脑",
      "color": "#ffb74d"
    },
    "evidence": {
      "name": "证据引擎",
      "sys": "法律专家",
      "color": "#ff9a4d"
    },
    "strategy": {
      "name": "策略引擎",
      "sys": "法律专家",
      "color": "#ff7b5c"
    },
    "review": {
      "name": "审查引擎",
      "sys": "法律专家",
      "color": "#ffd27b"
    },
    "contract": {
      "name": "合同起草",
      "sys": "法律专家",
      "color": "#ffcf6b"
    },
    "finance": {
      "name": "金融半球",
      "sys": "法融交叉",
      "color": "#5ad1ff"
    },
    "drafting": {
      "name": "文书生成",
      "sys": "法律专家",
      "color": "#7be0a0"
    },
    "adjudication": {
      "name": "裁判思维",
      "sys": "法律专家",
      "color": "#ff6f91"
    },
    "reticular": {
      "name": "脑干网状激活",
      "sys": "唤醒闸门",
      "color": "#ff7043"
    },
    "hypothalamus": {
      "name": "下丘脑内稳态",
      "sys": "内稳态",
      "color": "#ff9e80"
    },
    "sensory": {
      "name": "感觉表层",
      "sys": "感觉入口",
      "color": "#ffb26b"
    },
    "atl": {
      "name": "前颞叶语义枢纽",
      "sys": "语言理解",
      "color": "#ffe98a"
    },
    "rsc": {
      "name": "压部后皮层",
      "sys": "情绪记忆",
      "color": "#ff85b3"
    },
    "ofc": {
      "name": "眶额皮层",
      "sys": "执行控制",
      "color": "#8affd1"
    },
    "tpj": {
      "name": "颞顶联合区",
      "sys": "内省自我",
      "color": "#b79bff"
    },
    "sma": {
      "name": "辅助运动区",
      "sys": "语言输出",
      "color": "#fff0a0"
    },
    "nacc": {
      "name": "伏隔核强化",
      "sys": "突触可塑",
      "color": "#c6ffa8"
    },
    "metacog": {
      "name": "元认知",
      "sys": "元认知",
      "color": "#7be0ff"
    }
  },
  "built": "2026-10-30 15:40:01"
};

export const COGNITION = {
  "phases": [
    {
      "key": "recall",
      "name": "觉醒回忆",
      "organ": "元认知",
      "deliver": "加载记忆上下文与未消化纠正"
    },
    {
      "key": "triage",
      "name": "分诊",
      "organ": "元认知",
      "deliver": "任务类型/复杂度/风险等级"
    },
    {
      "key": "research",
      "name": "研究",
      "organ": "概念图谱",
      "deliver": "内外知识源检索与分级核验"
    },
    {
      "key": "reason",
      "name": "推理",
      "organ": "双轨推理",
      "deliver": "规范轨/实务轨双轨分析"
    },
    {
      "key": "adversarial",
      "name": "对抗",
      "organ": "对抗辩论",
      "deliver": "反方论证+反驳+残余风险"
    },
    {
      "key": "hypothesis",
      "name": "假设",
      "organ": "假设台账",
      "deliver": "假设登记与验证路径"
    },
    {
      "key": "synthesize",
      "name": "综合",
      "organ": "置信校准",
      "deliver": "结论+风险矩阵+置信度"
    },
    {
      "key": "precipitate",
      "name": "沉淀",
      "organ": "概念图谱",
      "deliver": "写卡+图谱+推理链"
    }
  ],
  "organs": [
    {
      "name": "元认知",
      "en": "METACOGNITION",
      "color": "#ff7bd5"
    },
    {
      "name": "双轨推理",
      "en": "DUAL-TRACK",
      "color": "#5aa9ff"
    },
    {
      "name": "对抗辩论",
      "en": "ADVERSARIAL",
      "color": "#ffd24d"
    },
    {
      "name": "假设台账",
      "en": "HYPOTHESIS-LEDGER",
      "color": "#4dffc3"
    },
    {
      "name": "概念图谱",
      "en": "CONCEPT-GRAPH",
      "color": "#b78bff"
    },
    {
      "name": "置信校准",
      "en": "CALIBRATION",
      "color": "#ff9a4d"
    }
  ],
  "metacogChecks": [
    {
      "key": "goal",
      "q": "本次分析目标是否明确写出？"
    },
    {
      "key": "known",
      "q": "已知事实与待证事实是否已区分？"
    },
    {
      "key": "bias",
      "q": "是否存在只采信有利信息的偏向？"
    },
    {
      "key": "source",
      "q": "关键论断是否都有可溯源来源（含卡片编码）？"
    },
    {
      "key": "counter",
      "q": "是否构造并回应了反方最强论证？"
    },
    {
      "key": "residual",
      "q": "残余风险是否诚实标注？"
    },
    {
      "key": "boundary",
      "q": "是否明确了需真人律师复核的边界？"
    }
  ],
  "confidenceWeight": {
    "高": 1.0,
    "中": 0.6,
    "低": 0.3
  },
  "gradeWeight": {
    "A": 0.92,
    "B": 0.8,
    "C": 0.62,
    "D": 0.41
  }
};

export const COUNCIL = {
  "brains": [
    {
      "id": "LOGOS",
      "name": "逻辑脑",
      "eye": "只认链条",
      "pol": 1,
      "w": {
        "logic": 0.9,
        "conflict": -0.5,
        "evid": 0.2
      },
      "b": -0.18,
      "act": [
        [
          "challenge",
          0.55
        ],
        [
          "probe",
          0.35
        ],
        [
          "answer",
          0.0
        ]
      ],
      "voice": "前提→推理→结论这一环，我要看有没有断点。"
    },
    {
      "id": "VERUM",
      "name": "证据脑",
      "eye": "只认证据",
      "pol": 1,
      "w": {
        "evid": 0.95,
        "logic": 0.15
      },
      "b": -0.22,
      "act": [
        [
          "probe",
          0.55
        ],
        [
          "answer",
          0.7
        ],
        [
          "challenge",
          0.0
        ]
      ],
      "voice": "主张先放一放——证据在哪里？举证责任落在谁头上？"
    },
    {
      "id": "CAUTUM",
      "name": "风险脑",
      "eye": "只认下行",
      "pol": -1,
      "w": {
        "risk": 0.9,
        "stakes": 0.5,
        "evid": -0.1
      },
      "b": -0.12,
      "act": [
        [
          "caution",
          0.6
        ],
        [
          "probe",
          0.35
        ],
        [
          "answer",
          0.0
        ]
      ],
      "voice": "这个结论要是错了，当事人会失去什么？我先算下行。"
    },
    {
      "id": "EMBRIA",
      "name": "共情脑",
      "eye": "只认人",
      "pol": 1,
      "w": {
        "emp": 0.85,
        "conflict": -0.2
      },
      "b": 0.05,
      "act": [
        [
          "answer",
          0.6
        ],
        [
          "probe",
          0.4
        ],
        [
          "caution",
          0.0
        ]
      ],
      "voice": "先接住这个人，再谈法条——他此刻需要的是什么？"
    },
    {
      "id": "LINGUA",
      "name": "语言脑",
      "eye": "只认表达",
      "pol": 1,
      "w": {
        "lang": 0.9,
        "logic": 0.15
      },
      "b": 0.0,
      "act": [
        [
          "answer",
          0.5
        ],
        [
          "probe",
          0.45
        ],
        [
          "challenge",
          0.0
        ]
      ],
      "voice": "这样说出去，对方一遍能听懂吗？能不能落成文书？"
    }
  ],
  "actions": [
    {
      "id": "answer",
      "name": "作答",
      "why": "五脑综合确认可以负责任地给出结论"
    },
    {
      "id": "probe",
      "name": "追问",
      "why": "关键事实缺口未补，先问清再下结论"
    },
    {
      "id": "challenge",
      "name": "质疑",
      "why": "前提或链条有断点，先把主张顶回去验一验"
    },
    {
      "id": "caution",
      "name": "缓行",
      "why": "下行风险过大，先给止损建议再谈实体"
    }
  ],
  "featKeys": [
    "logic",
    "evid",
    "risk",
    "emp",
    "lang",
    "conflict",
    "stakes"
  ],
  "dissentEps": 0.12
};

export const ADJUDICATION = {
  "proofDefault": "高度盖然性",
  "burdenDefaultNote": "谁主张谁举证（民诉法第67条）",
  "highStdTerms": [
    "恶意",
    "明知",
    "串通",
    "以合法形式掩盖非法目的",
    "欺诈",
    "故意",
    "虚假"
  ],
  "stdOverride": {
    "恶意串通": "排除合理怀疑（或高度盖然性中的较高标准）",
    "明知侵权": "高度盖然性中较高标准",
    "接触并实质性相似": "高度盖然性（接触+相似可推定）"
  },
  "discretion": {
    "违约金": "违约金适用**比例原则**：约定过分高于实际损失（通常以超过损失 30% 为参考）的，可请求法院酌减；约定过低不足以弥补损失的，可请求增至实际损失。法院会综合实际损失、合同履行程度、当事人过错、预期利益、公平原则酌定，不机械照约。违约金兼具**补偿性与惩罚性**双重属性，调整应兼顾二者；法院秉承谦抑原则审慎调整约定违约金，且不得危及劳动者生存（生存权保障优先于惩罚功能）。另：主张损失的一方须证明实际损失及与违约的**因果关系**，证明不了的，其本身即成为调减理由。",
    "赔偿损失": "赔偿额按**递进顺序**确定：权利人实际损失 → 侵权人获利 → 许可使用费倍数 → 法定赔偿（酌定）。均无证据时，法院依权利类型、知名度、侵权性质、情节、合理维权开支酌定，不会凭空支持高额诉请。",
    "法定赔偿": "法定赔偿为**兜底**，须在实际损失与侵权获利均不能查明时才适用；法院在法定幅度内依侵权情节酌定，而非按原告诉请全额支持。",
    "惩罚性赔偿": "惩罚性赔偿以**恶意侵权且情节严重**为前提，基数一般为实际损失或侵权获利，倍数由情节酌定；非恶意或非情节严重不适用。",
    "竞业限制": "竞业限制违约金按**多维动态平衡**酌定，不是简单按比例砍：① 劳动者身份类型（高管/高技责任更高，收入水平决定履行能力上限）；② 违约期限长短；③ 违反时间点（离职即入职竞对，主观恶性大于离职一段时间后才违反）；④ 补偿金高低（补偿过低而违约金畸高＝权利义务不对等，应予调低）；⑤ 单位告知后劳动者的态度（立即停止从轻、继续对抗从重）；⑥ 知悉/接触商业秘密的广度与重要性；⑦ 行业性质（新兴技术领域更偏向用人单位）；⑧ 违约方式（自营型重于入职型；代签合同、代发工资等规避措施体现主观恶意）；⑨ 单位自身过错（未按期支付补偿金、提前解除劳动合同）。基本原则：补偿性与惩罚性平衡、公平与诚实信用、谦抑审慎行使裁量权，违约金与补偿金应形成合理**正相关**。另：竞争关系不能仅凭工商登记经营范围重叠认定，应结合实际经营内容与受众综合判断。"
  }
};
