#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
升级安装验收：把安装目录里的文件与源码逐字节比对。

为什么必须单独做这道闸门：
  NSIS 的 SetOverwrite ifnewer 比较的是「**安装包里记录的时间戳**」与
  「目标文件的时间戳」。若安装包是**先编译、后 stage** 生成的，
  包里存的就是旧时间戳 → 判定"目标更新" → **跳过写入** →
  用户重装却拿到旧版本代码，而且**不报任何错**。

  这道闸门在真实机器上装一遍，然后逐字节比对，任何漏更新都能当场发现。

用法：python tools/verify-install-files.py <安装目录>
"""
import hashlib
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'build', 'win', 'electron-v33.0.0', 'resources', 'app')

# 必须逐字节一致的关键文件（覆盖三大功能面）
CRITICAL = [
    'package.json',
    'BUILD.txt',
    'main.js',
    'preload.js',
    'ui/app.js',
    'ui/index.html',
    'ui/styles.css',
    'ui/ui-kit.js',
    'ui/cosmos.js',
    'ui/views/graph.js',
    'ui/views/document.js',
    'ui/views/explorer.js',
]


def sha(p):
    try:
        with open(p, 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()[:16]
    except Exception:
        return None


def main():
    dst = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\legal\AppData\Local\Programs\NeoLink'
    app = os.path.join(dst, 'resources', 'app')
    print('════ 升级安装文件验收 ════')
    print('  安装目录：', app)
    if not os.path.isdir(app):
        print('  ✗ 安装目录不存在')
        return 1

    ok = True
    for rel in CRITICAL:
        s = os.path.join(SRC, rel.replace('/', os.sep))
        d = os.path.join(app, rel.replace('/', os.sep))
        a, b = sha(s), sha(d)
        if not os.path.exists(d):
            print(f'  ✗ 缺失  {rel}')
            ok = False
        elif a != b:
            print(f'  ✗ 不一致 {rel}\n      源={a}\n      装={b}')
            ok = False
        else:
            print(f'  ✓ {rel}')

    # 版本号必须与源码一致（升级是否真的生效，看这一行最直接）
    import json
    try:
        with open(os.path.join(app, 'package.json'), encoding='utf-8') as f:
            v = json.load(f).get('version')
        with open(os.path.join(SRC, 'package.json'), encoding='utf-8') as f:
            vs = json.load(f).get('version')
        print(f'  版本号：安装={v}  源码={vs}')
        if v != vs:
            print('  ✗ 安装的版本与源码不一致 ⇒ 升级没生效')
            ok = False
    except Exception as e:
        print('  ✗ 读版本号失败：', e)
        ok = False

    print('结果：', '全部一致 ✓' if ok else '有问题 ✗')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
