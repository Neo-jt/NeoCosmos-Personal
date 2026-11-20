// SafeResolver —— 严格目录沙箱（对应 R5）
// 统一路径判定：拦截 .. 穿越、绝对路径注入、symlink/junction 逃逸。
// 零依赖，仅用 Node 内置 path / fs。

import path from 'node:path';
import fs from 'node:fs';

export class SafeResolver {
  /**
   * @param {string} root 用户显式授权的知识库根目录（绝对路径，已归一化）
   */
  constructor(root) {
    this.root = path.resolve(root);
    if (!fs.existsSync(this.root) || !fs.statSync(this.root).isDirectory()) {
      throw new Error(`[SafeResolver] 根目录不存在或非目录: ${this.root}`);
    }
  }

  /**
   * 把任意传入路径解析为根目录内的绝对安全路径。
   * 失败抛错（绝不放行越界路径）。
   * 设计要点：始终把 p 当作"相对根"的路径解析，再用 path.relative 做越界判定，
   * 不预先剥离任何 ../ 前缀（否则会人为放经过滤）。
   * @param {string} p 相对根的路径 / 用户给的路径（含可能的越界尝试）
   */
  resolve(p) {
    if (p == null) throw new Error('[SafeResolver] 空路径');
    const abs = path.resolve(this.root, String(p));
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`[SafeResolver] 拒绝越界路径: ${p} -> ${abs}`);
    }
    return abs;
  }

  /**
   * 校验目标是否仍在根内（用于写前校验 + symlink 逃逸检测）。
   */
  ensureInside(target) {
    const abs = path.resolve(target);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`[SafeResolver] 目标越界: ${target}`);
    }
    return abs;
  }

  /**
   * 写前校验：真实文件（解析符号链接后）必须仍在根内。
   * 防止 symlink / junction 指向根外。
   */
  assertNoEscape(filePath) {
    let real = filePath;
    try {
      real = fs.realpathSync(filePath);
    } catch {
      // 文件尚不存在（新建），按传入路径判定
      real = filePath;
    }
    this.ensureInside(real);
    return true;
  }
}
