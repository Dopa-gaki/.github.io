#!/usr/bin/env python3
"""旧 data/posts.json を日別 posts/YYYY-MM-DD.json と data/index.json に分割する．

使い方: python3 migrate_legacy.py
既に data/index.json に記事が登録済みの場合は上書きを拒否する．
"""
from pathlib import Path
import json, re, sys
ROOT=Path(__file__).resolve().parent
legacy=ROOT/'data/posts.json'
manifest=ROOT/'data/index.json'
if not legacy.exists():
    sys.exit('旧記事 data/posts.json がありません．')
posts=json.loads(legacy.read_text(encoding='utf-8'))
if not isinstance(posts,list):sys.exit('旧記事ファイルは配列である必要があります．')
if json.loads(manifest.read_text(encoding='utf-8')) != []:
    sys.exit('data/index.json に既存の記事があるため，安全のため停止しました．')
dates=[item.get('date') for item in posts]
if any(not isinstance(d,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',d) for d in dates):sys.exit('日付が不正です．')
if len(set(dates))!=len(dates):sys.exit('同じ日付の記事があります．日別ファイルへの移行前に整理してください．')
for item in posts:
    p=ROOT/'posts'/f'{item["date"]}.json'
    if p.exists():sys.exit(f'すでに{p}があります．安全のため停止しました．')
for item in posts:
    p=ROOT/'posts'/f'{item["date"]}.json'
    p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps(item,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
rows=[{k:item.get(k,([] if k=='tags' else '')) for k in ('id','date','title','weather','mood','tags')} for item in posts]
rows.sort(key=lambda x:x['date'],reverse=True)
manifest.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'{len(posts)}件を変換しました．旧 data/posts.json はバックアップ用に残しました．')
