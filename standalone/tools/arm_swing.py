"""The arm swing on the store characters' walk, in Blender: the same motion the drive adds in three.js
(public/drive/people.js addArmSwing, ARMS.walk), so you swing your arms the same way in the store and in the chase.

The Tripo walk (preset:biped:walk) barely moves the arms: the upper arms stay at the sides, so in the store's front and
back rows they did not move at all. Each arm is turned about the shoulder, forward when the opposite foot is forward;
the elbow bends further on the forward swing; the shoulder (clavicle) rolls forward and back with a share of the swing
so the tee's sleeve, skinned partly to it, goes with the arm. Phase comes from the walk's own feet.

All poses are computed first from the untouched walk, then written as keys on every frame of the action (the clavicle's
own track is a constant, so writing keys while still reading the walk would change the frames not yet read).
"""
import bpy, math, mathutils

WALK = dict(swing=15, bend=14, pump=26, out=-2, shoulder=0.4)   # = ARMS.walk in public/drive/people.js
V, M = mathutils.Vector, mathutils.Matrix

def _about(m, r):
    """rotate the world matrix m about its own origin (the bone's head) by the rotation matrix r"""
    h = m.to_translation()
    return M.Translation(h) @ r @ M.Translation(-h) @ m

def add_arm_swing(arm, fwd, frames, swing=15, bend=14, pump=26, out=1, shoulder=0.4):
    sc = bpy.context.scene; pb = arm.pose.bones; MW = arm.matrix_world; MWi = MW.inverted()
    up = V((0, 0, 1)); fwd = V((fwd.x, fwd.y, 0)).normalized(); side = fwd.cross(up).normalized()
    W = lambda n: MW @ pb[n].matrix                                   # a bone's world matrix in the current frame
    head = lambda n: W(n).to_translation()
    rot = lambda deg, axis: M.Rotation(math.radians(deg), 4, axis)
    def basis(name, pose, parent_pose):
        """pose (armature space) -> the bone's matrix_basis, given its parent's pose"""
        b = pb[name].bone; p = b.parent
        return (p.matrix_local.inverted() @ b.matrix_local).inverted() @ parent_pose.inverted() @ pose
    keys = {}
    for S, O in (("L", "R"), ("R", "L")):
        ph = []
        for f in frames:
            sc.frame_set(f); ph.append((head(O + "_Foot") - head("Hip")).dot(fwd))
        mid, amp = (max(ph) + min(ph)) / 2, ((max(ph) - min(ph)) / 2) or 1
        sc.frame_set(frames[0])
        out_sign = 1 if (head(S + "_Hand") - head("Spine02")).dot(side) >= 0 else -1
        cl, ua, fa = S + "_Clavicle", S + "_Upperarm", S + "_Forearm"
        prev = {}
        for f, p_ in zip(frames, ph):
            sc.frame_set(f)
            s = (p_ - mid) / amp                                        # +1: this arm's front of the swing
            P, C, U, F = W(pb[cl].parent.name), W(cl), W(ua), W(fa)
            Rc = rot(out_sign * shoulder * swing * s, up)
            Ru = rot(-out_sign * out, fwd) @ rot(swing * s, side)
            C2 = _about(C, Rc)
            U2 = _about(C2 @ C.inverted() @ U, Ru @ Rc.inverted())     # carried by the shoulder, then turned to Ru @ U
            F2 = _about(U2 @ U.inverted() @ F, rot(bend + pump * max(0.0, s), side))
            for name, pose, ppose in ((cl, C2, P), (ua, U2, C2), (fa, F2, U2)):
                q = basis(name, MWi @ pose, MWi @ ppose).to_3x3().normalized().to_quaternion()
                if name in prev and prev[name].dot(q) < 0: q.negate()       # keep the keys on one side: no flips
                prev[name] = q; keys[(name, f)] = q
    for (name, f), q in keys.items():
        b = pb[name]; b.rotation_mode = "QUATERNION"; b.rotation_quaternion = q
        b.keyframe_insert("rotation_quaternion", frame=f)
    sc.frame_set(frames[0])
    return len(keys)
