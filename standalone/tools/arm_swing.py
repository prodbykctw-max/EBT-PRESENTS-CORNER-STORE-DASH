"""The arm swing on the store characters' walk, in Blender: the same motion the drive adds in three.js
(public/drive/people.js addArmSwing, ARMS.walk). Used only with CSD_ARMS=1 in bake_characters.py: the shipped store
sheets keep the walk as it is (the owner judged them fine, Nov 6 2026); renders3 on the laptop holds a bake with it.

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

def add_arm_swing(arm, fwd, frames, swing=15, bend=14, pump=26, out=-2, shoulder=0.4):   # defaults = WALK
    """`fwd` is not used for the swing: forward is measured here the same way as in people.js (both feet, averaged)"""
    sc = bpy.context.scene; pb = arm.pose.bones; MW = arm.matrix_world; MWi = MW.inverted()
    ad = arm.animation_data
    assert ad and ad.action, "the armature has no walk action"
    assert getattr(ad, "action_slot", True) is not None, "the walk action has no slot: keys would land in a new one and freeze the legs"
    for n in ("Clavicle", "Upperarm", "Forearm"):
        for S in "LR":
            b = pb[S + "_" + n]
            assert b.parent and b.bone.use_inherit_rotation and b.bone.inherit_scale == "FULL" and not b.constraints, S + "_" + n
    # the meshes don't move the bones: switch their modifiers off while the poses are read (every frame change would
    # otherwise re-run the 1.9M-triangle scan's decimate and skin), and back on after
    muted = [m for o in bpy.data.objects if o.type == "MESH" for m in o.modifiers if m.show_viewport]
    for m in muted: m.show_viewport = False
    W = lambda n: MW @ pb[n].matrix                                   # a bone's world matrix in the current frame
    head = lambda n: W(n).to_translation()
    up = V((0, 0, 1)); fwd = V((0, 0, 0))
    for f in frames[::max(1, len(frames) // 24)]:                     # forward: the way both feet point, averaged
        sc.frame_set(f)
        for S in "LR":
            d = head(S + "_ToeBase") - head(S + "_Foot"); d.z = 0; fwd += d.normalized()
    fwd.normalize(); side = fwd.cross(up).normalized()
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
    # the legs must still walk (keys in a new slot would have frozen them)
    sc.frame_set(frames[0]); a0 = head("L_Foot").copy(); sc.frame_set(frames[len(frames) // 4]); a1 = head("L_Foot").copy()
    assert (a1 - a0).length > 1e-3, "the legs stopped walking after the arm keys were written"
    for m in muted: m.show_viewport = True
    sc.frame_set(frames[0])
    return len(keys), [round(x, 3) for x in fwd]
