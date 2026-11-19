#!/usr/bin/env python3
"""Prepare named-star overlay from HYG v4.1.
Derived from HYG-Database (CC BY-SA 4.0), © Astronexus/David Nash and contributors.
Names are supplemental to Gaia DR3 tiled photometry, NOT labels from Gaia DR3.
"""
import csv,json,io,math,urllib.request,pathlib,collections
SOURCE_SHA="c7f7f883fe678cc7680169a50ccd7dcc49b060ce"
SOURCE_URL=f"https://raw.githubusercontent.com/astronexus/HYG-Database/{SOURCE_SHA}/hyg/CURRENT/hygdata_v41.csv"
OUT=pathlib.Path("cometmap/star-labels");OUT.mkdir(parents=True,exist_ok=True)
GREEK={"alp":"α","bet":"β","gam":"γ","del":"δ","eps":"ε","zet":"ζ","eta":"η","the":"θ","iot":"ι","kap":"κ","lam":"λ","mu":"μ","nu":"ν","xi":"ξ","omi":"ο","pi":"π","rho":"ρ","sig":"σ","tau":"τ","ups":"υ","phi":"φ","chi":"χ","psi":"ψ","ome":"ω"}
with urllib.request.urlopen(urllib.request.Request(SOURCE_URL,headers={"User-Agent":"Cometmap-StarLabels-Test/1.0"}),timeout=100) as response:
    decoded=io.TextIOWrapper(response,encoding="utf-8-sig",newline="")
    reader=csv.DictReader(decoded)
    assert {"proper","bayer","flam","con","ra","dec","mag"}.issubset(set(reader.fieldnames)),reader.fieldnames
    labels=[]
    stats=collections.Counter()
    for row in reader:
        b=(row.get("bayer") or "").strip()
        flam=(row.get("flam") or "").strip()
        con=(row.get("con") or "").strip()
        proper=(row.get("proper") or "").strip()
        # HYG v4.1 includes some unofficial "Name B" aliases for binary companions.
        # We omit these until a formally verified star name exists for the component.
        if proper.endswith(" B") and not b and not flam:continue
        if not (proper or b or flam):continue
        try:
            ra=float(row["ra"])*15.0
            dec=float(row["dec"])
            mag=float(row["mag"])
        except (ValueError,KeyError):continue
        if not(0<=ra<360.01 and -90<=dec<=90 and -3<mag<13):continue
        bf=""
        if b:
            import re
            m=re.fullmatch(r"([A-Za-z]{2,3})-?(\d*)",b)
            if m:
                p=GREEK.get(m.group(1).lower())
                if p:bf=p+''.join("⁰¹²³⁴⁵⁶⁷⁸⁹"[int(d)] for d in m.group(2))+(" "+con if con else "")
                else:bf=b+(" "+con if con else "")
            else:bf=b+(" "+con if con else "")
        fs=(flam+" "+con).strip() if flam else ""
        if proper:stats["proper"]+=1
        if bf:stats["bayer"]+=1
        if fs:stats["flam"]+=1
        # limit to usable title lengths and precision of source positions
        labels.append([round(ra%360,6),round(dec,6),round(mag,2),proper[:64],bf[:24],fs[:20]])
    # stable dedupe components with identical designations and coordinates:
    dedup={}
    for x in labels:
        key=(round(x[0],4),round(x[1],4),x[3],x[4],x[5])
        if key not in dedup or x[2]<dedup[key][2]:dedup[key]=x
    labels=sorted(dedup.values(),key=lambda x:(x[2],x[0],x[1]))
    assert len(labels)>3000, f"Unexpectedly low matching names {len(labels)} {dict(stats)}"
    assert any("Sirius"==x[3] for x in labels),"Sirius missing"
    assert any(x[4].startswith("α ") for x in labels),"Greek bayer missing"
    assert any(x[5].startswith("12 ") for x in labels),"12 Flamsteed missing"
    json_data={"format":"cometmap-hyg-star-labels-v1","source":"HYG v4.1, David Nash / Astronexus; data derived from Hipparcos/Yale Bright Star/IAU names","source_url":"https://github.com/astronexus/HYG-Database","source_sha":SOURCE_SHA,"license":"CC BY-SA 4.0","epoch":"J2000.0","fields":["ra_deg","dec_deg","Vmag","proper","bayer","flamsteed"],"count":len(labels),"stats":dict(stats),"data":labels}
    (OUT/"hyg-labels.json").write_text(json.dumps(json_data,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print("Processed:",len(labels),"proper:",stats["proper"],"bayer:",stats["bayer"],"flam:",stats["flam"])
    print("Examples:",[x for x in labels if x[3] in ("Sirius","Betelgeuse","Vega")][:5])
