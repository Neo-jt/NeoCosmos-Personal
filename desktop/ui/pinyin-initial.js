// 离线拼音首字母检索（运行期零依赖，字典见 pinyin-data.js）
// 设计：把一段中文文本的「每个汉字拼音首字母」拼出来，与原文小写一起组成检索键。
//   pinyinMatch('bj',  '北京会议') === true   // 首字母命中
//   pinyinMatch('abc', 'ABC 文件') === true   // 拉丁原文命中
//   pinyinMatch('京',  '北京会议') === true   // 直接输入汉字也命中
// 不做全文拼音（只取首字母），契合「首字母检索」诉求，且字典体积最小。
import { PINYIN_CH, PINYIN_IN } from './pinyin-data.js';

const MAP = new Map();
for (let i = 0; i < PINYIN_CH.length; i++) {
  const c = PINYIN_IN[i];
  if (c >= 'a' && c <= 'z') MAP.set(PINYIN_CH[i], c);
}

/** 文本 → 检索键：小写原文 + 空格 + 各汉字拼音首字母拼接。 */
export function pinyinKey(text) {
  const s = String(text || '');
  let ini = '';
  for (const ch of s) {
    const v = MAP.get(ch);
    if (v) ini += v;
  }
  return s.toLowerCase() + ' ' + ini;
}

/**
 * 查询串是否命中文本。
 * @param {string} query 用户输入（可含空格，会被忽略）
 * @param {string} text  待匹配文本（卡片标题 / 知识库名等）
 */
export function pinyinMatch(query, text) {
  const q = String(query || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  return pinyinKey(text).includes(q);
}

export { MAP as _pinyinMap };
