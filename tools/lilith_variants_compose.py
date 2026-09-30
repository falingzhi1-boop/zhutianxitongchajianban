"""Align AI-edited face crops back onto the original Lilith art and composite.

ref crop box (118,30,278,190) scaled to 640. Generated crops are 1024².
Alignment: ORB on hair/horn/ear areas (outside the face oval, which changed),
estimateAffinePartial2D with RANSAC -> warp gen onto ref crop coordinates.
Then paste into full-res art with a feathered ellipse mask over the face.
"""
import sys, json
import cv2, numpy as np
from PIL import Image

BOX = (118, 30, 278, 190)
REF = cv2.cvtColor(np.array(Image.open('/var/tmp/lilith-ref.png').convert('RGB')), cv2.COLOR_RGB2BGR)
S = 640
ref_crop = cv2.resize(REF[BOX[1]:BOX[3], BOX[0]:BOX[2]], (S, S), interpolation=cv2.INTER_CUBIC)

# face oval in 640 crop coords (from visual inspection): centre ~(300,300)
FACE_C = (285, 300); FACE_AX = (175, 205)

def outside_mask(size):
    m = np.full((size, size), 255, np.uint8)
    cv2.ellipse(m, FACE_C, (int(FACE_AX[0]*1.05), int(FACE_AX[1]*1.05)), 0, 0, 360, 0, -1)
    return m

def align(gen):
    g = cv2.resize(gen, (S, S), interpolation=cv2.INTER_AREA)
    orb = cv2.ORB_create(4000)
    ga = cv2.GaussianBlur(cv2.cvtColor(g, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    ra = cv2.GaussianBlur(cv2.cvtColor(ref_crop, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    # the gen is sharper; blur both so features match
    k1, d1 = orb.detectAndCompute(ga, outside_mask(S))
    k2, d2 = orb.detectAndCompute(ra, outside_mask(S))
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    ms = sorted(bf.match(d1, d2), key=lambda m: m.distance)[:400]
    p1 = np.float32([k1[m.queryIdx].pt for m in ms]); p2 = np.float32([k2[m.trainIdx].pt for m in ms])
    M, inl = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=4, maxIters=5000)
    n = int(inl.sum()) if inl is not None else 0
    if M is None or n < 12:
        # fallback: ECC on blurred grayscale, similarity (euclidean+scale via affine)
        M = np.eye(2, 3, dtype=np.float32)
        try:
            _, M = cv2.findTransformECC(ra.astype(np.float32)/255, ga.astype(np.float32)/255, M,
                                        cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-5))
            M = cv2.invertAffineTransform(M)
        except cv2.error:
            pass
    warped = cv2.warpAffine(g, M, (S, S), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    sc = float(np.sqrt(abs(np.linalg.det(M[:, :2]))))
    return warped, n, sc, M

def colour_match(src, ref, mask):
    """match mean/std per channel in LAB inside the ring around the face."""
    s = cv2.cvtColor(src, cv2.COLOR_BGR2LAB).astype(np.float32)
    r = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB).astype(np.float32)
    m = mask > 0
    for c in range(3):
        sm, ss = s[..., c][m].mean(), s[..., c][m].std() + 1e-3
        rm, rs = r[..., c][m].mean(), r[..., c][m].std() + 1e-3
        k = np.clip(rs/ss, 0.8, 1.25)
        s[..., c] = (s[..., c]-sm)*k + rm
    return cv2.cvtColor(np.clip(s, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)

def compose(name, out_dir):
    gen = cv2.imread(f'/var/tmp/gen/face-{name}.png')
    warped, n, sc, M = align(gen)
    ring = np.zeros((S, S), np.uint8)
    cv2.ellipse(ring, FACE_C, (int(FACE_AX[0]*1.25), int(FACE_AX[1]*1.2)), 0, 0, 360, 255, -1)
    cv2.ellipse(ring, FACE_C, FACE_AX, 0, 0, 360, 0, -1)
    warped = colour_match(warped, ref_crop, ring)
    # downscale to native crop size first (matches original softness)
    w = BOX[2]-BOX[0]
    small = cv2.resize(warped, (w, w), interpolation=cv2.INTER_AREA)
    mask = np.zeros((w, w), np.float32)
    cx, cy = FACE_C[0]*w/S, FACE_C[1]*w/S
    cv2.ellipse(mask, (int(cx), int(cy)), (int(FACE_AX[0]*w/S), int(FACE_AX[1]*w/S)), 0, 0, 360, 1.0, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), w*0.045)[..., None]
    full = REF.copy().astype(np.float32)
    region = full[BOX[1]:BOX[3], BOX[0]:BOX[2]]
    full[BOX[1]:BOX[3], BOX[0]:BOX[2]] = region*(1-mask) + small.astype(np.float32)*mask
    out = np.clip(full, 0, 255).astype(np.uint8)
    Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB)).save(f'{out_dir}/{name}.webp', 'WEBP', quality=90, method=6)
    # also a patch (face rect only) for rig mode
    return dict(name=name, inliers=n, scale=round(sc, 3), tx=round(float(M[0, 2]), 1), ty=round(float(M[1, 2]), 1))

if __name__ == '__main__':
    out = sys.argv[1]
    names = sys.argv[2:]
    print(json.dumps([compose(n, out) for n in names], ensure_ascii=False))
