# mean |difference| of luminance between successive crops saved by flicker.mjs, and the share of pixels that jump
import sys, glob
from PIL import Image
import numpy as np
for d in sys.argv[1:]:
    fs = sorted(glob.glob(d + '/f*.png')); L = [np.asarray(Image.open(f).convert('L'), dtype=np.float32) for f in fs]
    m = [np.abs(b - a).mean() for a, b in zip(L, L[1:])]; j = [(np.abs(b - a) > 12).mean() * 100 for a, b in zip(L, L[1:])]
    print(f'{d}: mean |dL| {np.mean(m):.3f} (max {np.max(m):.3f}) /255, pixels jumping > 12: {np.mean(j):.3f} % (max {np.max(j):.3f} %)')
