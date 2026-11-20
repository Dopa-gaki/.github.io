#!/usr/bin/env python3
"""SNmap public feed builder. Fetches documented public API; no invented observations.
Never overwrites the previous published JSON if all source queries fail.
"""
from __future__ import annotations
import datetime as dt
import json
import math
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


# Transients.fyi /objects/export stops at 10,100 rows, and API offsets stop
# at 10,000.  Count first, then split a wide declination range into complete
# independent exports.  Dec-band boundary duplicates are removed by object ID.
SAFE_EXPORT_ROWS=9000
MAX_REQUESTS=180
MAX_PARTITIONS=64
COLLECT_TIME_BUDGET=12*60
MIN_DEC_WIDTH=.025
MAX_JSON_BYTES=25_000_000

class PartialData(Exception):
    pass

class Pacer:
    def __init__(self):
        self.start=time.monotonic()
        self.next_request=self.start
        self.next_export=self.start
        self.requests=0
        self.exports=0

    def fetch(self,path,params):
        url=API+path+'?'+urlencode(params)
        for retry in range(3):
            if self.requests>=MAX_REQUESTS or time.monotonic()-self.start>COLLECT_TIME_BUDGET:
                raise PartialData('request/time budget reached')
            wait=max(self.next_request,self.next_export if path=='/export' else 0)-time.monotonic()
            if wait>0:time.sleep(wait)
            self.next_request=time.monotonic()+1.05  # <= one request/second
            if path=='/export':
                self.exports+=1
                self.next_export=time.monotonic()+10.5  # <= six exports/minute
            self.requests+=1
            try:
                return retrieve(url)
            except HTTPError as exc:
                if exc.code not in (429,500,502,503,504) or retry==2:raise
                try:
                    delay=min(90,max(2,float(exc.headers.get('Retry-After') or '0')))
                except (TypeError,ValueError):
                    delay=3*(retry+1)
                self.next_request=max(self.next_request,time.monotonic()+delay)
            except (URLError,TimeoutError,OSError):
                if retry==2:raise
                self.next_request=max(self.next_request,time.monotonic()+3*(retry+1))
        raise PartialData('no valid API response')

def fetch_adaptive(pacer,label,params):
    rows=[]
    errs=[]
    dates=set()
    versions=set()
    root_total=None
    parts=0
    splits=0
    verified=True

    def visit(lo,hi,depth=0):
        nonlocal root_total,parts,splits,verified
        if parts>=MAX_PARTITIONS:
            raise PartialData('declination partition budget reached')
        query={**params,'dec_min':round(lo,6),'dec_max':round(hi,6)}
        # Unlike /export, /objects exposes an exact total for a 1-row probe.
        count=pacer.fetch('',{**query,'limit':1,'offset':0})
        total=safe_total(count.get('total'))
        if total is None:raise PartialData('count endpoint did not provide an exact total')
        if depth==0:root_total=total
        if total>SAFE_EXPORT_ROWS:
            if depth>=16 or hi-lo<=MIN_DEC_WIDTH:
                raise PartialData('crowded sky region could not be subdivided')
            splits+=1
            mid=(lo+hi)/2
            visit(lo,mid,depth+1)
            visit(mid,hi,depth+1)
            return
        parts+=1
        if total==0:return
        result=pacer.fetch('/export',query)
        segment=result['rows']
        if result.get('truncated') is not False or len(segment)!=total:
            # Never accept a capped export or a changing total silently.
            if depth>=16 or hi-lo<=MIN_DEC_WIDTH:
                raise PartialData('count/export mismatch: %s/%s'%(len(segment),total))
            parts-=1
            splits+=1
            mid=(lo+hi)/2
            visit(lo,mid,depth+1)
            visit(mid,hi,depth+1)
            return
        date=str(result.get('data_through') or count.get('data_through') or '').strip()
        if date:dates.add(date)
        else:verified=False
        build_id=str(result.get('generated_at') or count.get('generated_at') or '').strip()
        if build_id:versions.add(build_id)
        for row in segment:
            if not valid_row(row):
                verified=False
                continue
            if not lo-1e-6<=float(row['dec'])<=hi+1e-6:
                verified=False
                continue
            rows.append(row)

    try:
        visit(-90.0,90.0)
    except (PartialData,HTTPError,URLError,ValueError,TimeoutError,OSError) as exc:
        verified=False
        errs.append(str(exc)[:160])
    unique={}
    for row in rows:
        key=key_for(row)
        if key:unique[key]=compact_row(row)
        else:verified=False
    if root_total is None or len(unique)!=root_total:
        verified=False
        errs.append('coverage mismatch: %s/%s unique objects'%(len(unique),root_total))
    if len(dates)>1 or len(versions)>1:
        verified=False
        errs.append('provider rebuilt its data during the segmented fetch')
    note={'query':label,'received':len(unique),'total':root_total,
          'complete':verified and not errs,'data_through':min(dates) if dates else '',
          'method':'adaptive-dec-slices','partitions':parts,'splits':splits,'errors':errs}
    return list(unique.values()),note

def build():
    pacer=Pacer()
    records={}
    sources=[]
    for label,params in JOBS:
        rows,note=fetch_adaptive(pacer,label,params)
        sources.append(note)
        budget_hit=False
        for row in rows:
            key=key_for(row)
            if key not in records:
                if len(records)>=MAX_ROWS:
                    budget_hit=True
                else:
                    records[key]=row
        if budget_hit:
            note['complete']=False
            note['errors'].append('SNmap display record budget reached (%s)'%MAX_ROWS)
    if not records:
        raise RuntimeError('All sources unavailable; previous public feed preserved')
    dates=[s['data_through'] for s in sources if s['received']>0 and s['data_through']]
    enough_dates=len(dates)==sum(s['received']>0 for s in sources)
    payload={'format':'SNmap-public-feed-v1',
        'generated_at':dt.datetime.now(dt.timezone.utc).isoformat(),
        'data_through':min(dates) if dates and enough_dates else '',
        'partial':any(not s['complete'] for s in sources),
        'collection_strategy':'adaptive-declination-slices-v1',
        'rows':list(records.values()),'sources':sources}
    raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode('utf-8')
    if len(raw)>MAX_JSON_BYTES:
        raise RuntimeError('JSON size budget exceeded; previous feed preserved')
    DEST.parent.mkdir(parents=True,exist_ok=True)
    tmp=DEST.with_suffix('.json.tmp')
    tmp.write_bytes(raw)
    os.replace(tmp,DEST)
    print('SNmap rows:',len(records),'partial:',payload['partial'],
          'requests:',pacer.requests,'exports:',pacer.exports)
    for note in sources:
        print(note['query'],note['received'],'/',note['total'],
              'parts:',note['partitions'],'complete:',note['complete'],
              'errors:',note['errors'])

if __name__=='__main__':
    build()
