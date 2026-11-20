// 版本形态锁（v7.0.0）
// 取值：'both' | 'personal' | 'enterprise'
//   both       —— 应用内可自由切换个人版 / 企业版（开发 / 通用分发默认）
//   personal   —— 锁定个人版：星图（graph）为主图谱，企业管理等企业能力不可见
//   enterprise —— 锁定企业版：保留全部功能（含星系 / 3D 智脑 / 企业管理）
// 此文件由 tools/stage-app.mjs 在构建期根据 EDITION 环境变量覆写，勿手工长期编辑。
export const EDITION_LOCK = 'personal';
