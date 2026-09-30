import numpy as np, cv2
from PIL import Image
def key(src, dst, size=(424,632)):
    im = np.array(Image.open(src).convert('RGB')).astype(np.float32)/255
    r,g,b = im[...,0],im[...,1],im[...,2]
    # greenness: how much g exceeds max(r,b)
    d = g - np.maximum(r,b)
    a = 1 - np.clip((d-0.08)/(0.30-0.08),0,1)          # soft matte
    a = cv2.GaussianBlur(a,(0,0),0.7)
    # erode matte slightly to kill green fringe
    a = np.clip(cv2.erode(a,np.ones((3,3),np.uint8))*1.0,0,1)
    # despill: clamp g to max(r,b) where spill
    lim = np.maximum(r,b)
    g2 = np.where(g>lim, lim + (g-lim)*0.15, g)
    out = np.dstack([r,g2,b,a])
    o = Image.fromarray((out*255+.5).astype(np.uint8),'RGBA').resize(size,Image.LANCZOS)
    o.save(dst,'WEBP',quality=90,method=6,exact=False)
    A=np.array(o)[...,3]; print(dst, o.size, 'transparent %.1f%%'%(100*(A<8).mean()), 'semi %.1f%%'%(100*((A>=8)&(A<248)).mean()))
import sys; key(sys.argv[1], sys.argv[2])
