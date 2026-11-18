#!/usr/bin/env python3
"""SNmap public feed builder. Fetches documented public API; no invented observations.
Never overwrites the previous published JSON if all source queries fail.
"""
from __future__ import annotations
import datetime as dt
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data' / 'snmap-live.json'
API = 'https://transients.fyi/api/objects'
JOBS = [
    ('named TNS', {'window':'1M', 'tns':'named', 'sort':'last_mjd'}),
    ('classified supernovae', {'window':'3M', 'group':'sn', 'sort':'last_mjd'}),
    ('unclassified candidates', {'window':'3M', 'bucket':'sn_candidate', 'sort':'last_mjd'}),
]
MAX_ROWS = 25000
MAX_DOWNLOAD = 21_000_000
# Retain fields used by SNmap; omit long auxiliary metadata to keep snapshots under 25 MB.
RETAIN = frozenset("source source_id survey object_id id tns_name tns_designation name_prefix display_name name class_bucket bucket sn_type tns_type type classification class_label fink_class ra ra_deg dec dec_deg is_sso candidate tnsVerified last_mag latest_mag mag last_band last_filter band filter last_mjd latest_mjd last_night last_date last_observed last_detection peak_mag peak max_mag first_mjd first_night first_detection discovery discovery_date discovered_night tns_discovery_date host tns_host host_name host_galaxy tns_redshift tns_host_redshift z z_host redshift".split())

def compact_row(row):
    return {k:v for k,v in row.items() if k in RETAIN and v is not None}


def retrieve(url):
    req = Request(url, headers={'Accept':'application/json', 'User-Agent':'SNmap-public-catalogue/6.2 (+https://dopa-gaki.github.io/.github.io/snmap/)'})
    with urlopen(req, timeout=40) as response:
        content_type = response.headers.get('Content-Type', '')
        if 'json' not in content_type.lower():
            raise ValueError('non-JSON response')
        raw = response.read(MAX_DOWNLOAD + 1)
        if len(raw) > MAX_DOWNLOAD:
            raise ValueError('API response too large')
        result = json.loads(raw)
        if not isinstance(result, dict) or not isinstance(result.get('rows'), list):
            raise ValueError('API rows missing')
        if len(result['rows']) > 10100:
            raise ValueError('Unexpectedly large result')
        return result


def safe_total(value):
    try:
        n = int(value)
        return n if 0 <= n <= 100_000_000 else None
    except (ValueError, TypeError, OverflowError):
        return None


def valid_row(row):
    if not isinstance(row, dict): return False
    try:
        ra,dec = float(row.get('ra')),float(row.get('dec'))
    except (ValueError, TypeError):
        return False
    return 0 <= ra < 360 and -90 <= dec <= 90


def key_for(row):
    sid = str(row.get('source') or row.get('source_id') or '').strip().lower()
    objid = str(row.get('object_id') or row.get('id') or '').strip().lower()
    tns = str(row.get('tns_name') or '').strip().lower()
    if sid and objid: return sid + ':' + objid
    if tns: return 'tns:' + tns
    if objid: return objid
    return ''


def build():
    records=[];seen=set();sources=[];partial=False;observed=[]
    for i,(label,params) in enumerate(JOBS):
        if i: time.sleep(12.1)   # export endpoint is rate limited (6 calls/min)
        query = urlencode(params)
        errors=[];result=None;export=False
        for path in ('/export',''):
            url=API + path + '?' + query + ('' if path else '&limit=100')
            try:
                result=retrieve(url)
                export=bool(path)
                break
            except (HTTPError,URLError,ValueError,TimeoutError,OSError) as exc:
                errors.append(('export' if path else 'objects') + ': ' + str(exc)[:120])
                # Try the documented paged endpoint even if export fails.
                if path: time.sleep(1.5)
        if result is None:
            partial=True
            sources.append({'query':label,'received':0,'total':0,'complete':False,'data_through':'','errors':errors})
            continue
        rows=result['rows']
        total=safe_total(result.get('total'))
        through=str(result.get('data_through') or '').strip()
        if through: observed.append(through)
        complete=(total is not None and len(rows)>=total and not bool(result.get('truncated')))
        if total is None or not complete or not through: partial=True
        sources.append({'query':label,'received':len(rows),'total':total, 'complete':complete,
                        'data_through':through,'method':'export' if export else 'paged-sample',
                        'errors':[] if export else errors[:1]})
        for row in rows:
            if not valid_row(row):continue
            key=key_for(row)
            if not key or key in seen:continue
            seen.add(key)
            if len(records)<MAX_ROWS:records.append(compact_row(row))
            else:partial=True
    if not records:
        raise RuntimeError('All sources failed or provided no verifiable coordinates; keep old published feed')
    if len(observed)<sum(1 for s in sources if s['received']>0): partial=True
    dates=[s['data_through'] for s in sources if s['received']>0 and s['data_through']]
    payload={'format':'SNmap-public-feed-v1',
             'generated_at':dt.datetime.now(dt.timezone.utc).isoformat(),
             'data_through':min(dates) if dates and len(dates)==sum(s['received']>0 for s in sources) else '',
             'partial':partial, 'rows':records, 'sources':sources}
    DEST.parent.mkdir(parents=True,exist_ok=True)
    tmp=DEST.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    os.replace(tmp,DEST)
    print('SNmap rows:', len(records),'partial:',partial)
    for note in sources:print(note['query'],note['received'],'/',note['total'],note['method'] if 'method' in note else 'unavailable')

if __name__=='__main__':
    build()