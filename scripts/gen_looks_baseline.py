import importlib.util, json, numpy as np
from pathlib import Path
HERE = Path("/home/user/workspace/opendrt")
import sys
spec = importlib.util.spec_from_file_location("opendrt_v110", HERE/"opendrt_v110.py")
odt = importlib.util.module_from_spec(spec)
sys.modules["opendrt_v110"] = odt
spec.loader.exec_module(odt)

# 测试网格:灰阶 + 彩色 stops,ap0 输入,rec1886(display_gamut=0 rec709, eotf=2, tn_su=0)
grid = []
for e in [-4,-2,0,1,2,4]:
    v = 0.18*(2.0**e)
    grid.append([v,v,v])
for base in ([1,0,0],[0,1,0],[0,0,1],[0,1,1],[1,0,1],[1,1,0]):
    for e in [-2,0,2,4]:
        s = 0.18*(2.0**e)
        grid.append([base[0]*s, base[1]*s, base[2]*s])
grid = np.array(grid, dtype=np.float64)

looks = ["Standard","Arriba","Sylvan","Colorful","Aery","Dystopic","Umbra"]
out = {}
for lk in looks:
    p = odt.OpenDRTParams.from_look_preset(lk, in_gamut="ap0", in_oetf="linear",
                                           display_gamut=0, eotf=2, tn_su=1,
                                           tn_Lp=100.0, tn_Lg=10.0)
    drt = odt.OpenDRT(p)
    res = drt.evaluate(grid)
    out[lk] = res.tolist()
out["_grid"] = grid.tolist()
print(json.dumps(out))
