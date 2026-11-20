// NeoCosmos 版本身份配置（主进程 CJS，唯一真源）
// ---------------------------------------------------------------------------
// 由 tools/stage-app.mjs 在编排阶段根据 EDITION 环境变量覆写：
//   both       —— 通用/融合版（开发默认，保持历史行为）
//   personal   —— 个人版（AGPL-3.0 开源，独立数据目录与协议）
//   enterprise —— 企业版（专有商用，独立数据目录，沿用 neolink:// 协议）
//
// 主进程读取本配置来隔离「进程身份 / 数据目录 / 协议 / 关于信息」，
// 使两个客户端可同时安装、同时运行、互不覆盖数据。
// 此文件为源码默认（both）；构建期由编排脚本写入对应形态。
'use strict';

const EDITION = 'personal';

const PROFILES = {
  both: {
    edition: 'both',
    appName: 'NeoCosmos',
    userDataDir: 'NeoLink',          // 历史默认目录，保持兼容
    appUserModelId: 'NeoCosmos.Desktop',
    protocol: 'neolink',
    license: 'MIT 引擎 / 个人版 AGPL-3.0 / 企业版专有商用；见安装目录 LICENSES.md',
    commercial: false,
  },
  personal: {
    edition: 'personal',
    appName: 'NeoCosmos 个人版',
    userDataDir: 'NeoCosmosPersonal',// 与个人版 exe / NSIS InstallDir 一一对应
    appUserModelId: 'NeoCosmos.Personal',
    protocol: 'neolinkp',
    license: 'AGPL-3.0 开源（个人/学习/内网免费，商用须授权）；见安装目录 legal/AGPL-3.0.txt 与 COMMERCIAL-LICENSE.md',
    commercial: false,
  },
  enterprise: {
    edition: 'enterprise',
    appName: 'NeoCosmos 企业版',
    userDataDir: 'NeoCosmosEnterprise',
    appUserModelId: 'NeoCosmos.Enterprise',
    protocol: 'neolink',             // 企业版沿用主协议，兼容既有深链
    license: '专有商用许可；见安装目录 legal/ENTERPRISE-EULA.txt',
    commercial: true,
  },
};

function current() {
  return PROFILES[EDITION] || PROFILES.both;
}

module.exports = { EDITION, current, PROFILES };
