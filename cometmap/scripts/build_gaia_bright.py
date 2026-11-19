#!/usr/bin/env python3
"""Build a test-only, all-sky G<11 bright Gaia DR3 tile set from pinned upstream.
Input is ngwnos/gaia-dr3-chunked, packed sorted Gaia DR3 sources (12 float32 per row).
Output is 72 equal-area sky tiles; no alterations to cometmap/index.html.
"""
import json
import math
import pathlib
import struct
import time
import urllib.request

VERSION="7ed549309fb4999cbee94efd971d8cf6182efafa"
URL=f"https://raw.githubusercontent.com/ngwnos/gaia-dr3-chunked/{VERSION}/chunk_{{:04d}}.bin"
ROOT=pathlib.Path(__file__).resolve().parents[1]/"gaia-bright"
ROOT.mkdir(parents=True,exist_ok=True)
NRA,NZ=12,6
catalog={(r,z):bytearray() for r in range(NRA) for z in range(NZ)}
counts={(r,z):0 for r in range(NRA) for z in range(NZ)}
selected=0
under10=0
input_chunks=[]
prev_last=float("-inf")
for idx in range(80):
    addr=URL.format(idx)
    for attempt in range(4):
        try:
            req=urllib.request.Request(addr,headers={"User-Agent":"cometmap-gaia-bright-test/1.0"})
            with urllib.request.urlopen(req,timeout=120) as response:
                content=response.read()
            break
        except Exception:
            if attempt==3: raise
            time.sleep(2**attempt)
    if len(content)%48:
        raise ValueError(f"Unexpected length in chunk {idx}: {len(content)}")
    first_mag=struct.unpack_from("<f",content,24)[0]
    last_mag=struct.unpack_from("<f",content,len(content)-48+24)[0]
    if first_mag < prev_last-0.001: raise ValueError(f"Input not sorted at {idx}")
    prev_last=last_mag
    input_chunks.append({"chunk":idx,"records":len(content)//48,"first_g":first_mag,"last_g":last_mag})
    for row in struct.iter_unpack("<12f",content):
        ra,dec,mag,bp_rp = row[0],row[1],row[6],row[7]
        if not(math.isfinite(ra) and math.isfinite(dec) and math.isfinite(mag)):
            continue
        if not (-90<=dec<=90 and 0<=ra<=360 and mag<11):
            continue
        if not math.isfinite(bp_rp): bp_rp=0.0
        r=min(NRA-1,int((ra%360)/30))
        z=min(NZ-1,max(0,int((math.sin(math.radians(dec))+1)*NZ/2)))
        catalog[(r,z)].extend(struct.pack("<ffff",ra,dec,mag,bp_rp))
        counts[(r,z)]+=1
        selected+=1
        if mag<10: under10+=1
    print("Read upstream chunk",idx,"G",round(first_mag,3),"to",round(last_mag,3),"cumulative G<11",selected,flush=True)
    if last_mag>=11:break
else:
    raise RuntimeError("Did not reach G=11")
if not (1100000<=selected<=1500000 and 400000<=under10<=650000):
    raise RuntimeError(f"Unexpected bright-star counts: <10={under10} <11={selected}; refusing to publish")
tiles=[]
for r in range(NRA):
    for z in range(NZ):
        filename=f"bright-r{r:02d}-z{z}.bin"
        (ROOT/filename).write_bytes(catalog[(r,z)])
        tiles.append({"file":filename,"ra_min":r*30,"ra_max":(r+1)*30,
                      "sin_dec_min":-1+2*z/NZ,"sin_dec_max":-1+2*(z+1)/NZ,
                      "count":counts[(r,z)],"bytes":len(catalog[(r,z)])})
manifest={"format":"cometmap-gaia-dr3-bright-v1","epoch":"J2016.0","record_format":"little-endian float32[ra_deg,dec_deg,phot_g_mean_mag,bp_rp], stride=16",
          "mag_limit":"G<11","stars_g_lt_10":under10,"stars_g_lt_11":selected,"tiles":tiles,
          "source_repo":"https://github.com/ngwnos/gaia-dr3-chunked","source_revision":VERSION,
          "gaia_credit":"ESA/Gaia/DPAC; Gaia Collaboration (2022), Gaia DR3",
          "selection_note":"From a third-party Gaia DR3-derived, magnitude-sorted subset. The upstream does not document its initial selection completely; this is NOT an independently complete Gaia DR3 extract. Very bright stars may be absent owing to Gaia saturation.",
          "input_chunks":input_chunks}
(ROOT/"manifest.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print(f"DONE {selected} stars (G<10 {under10}), {len(tiles)} tiles, total bytes {sum(len(x) for x in catalog.values())}",flush=True)
