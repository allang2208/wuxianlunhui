#!/usr/bin/env python3
"""Build formal sprite packages for approved snowfield-lord body actions."""

from __future__ import annotations

import argparse
import json
import math
import runpy
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


TASK_ROOT = Path(__file__).resolve().parents[1]
REPO = TASK_ROOT.parents[2]
TOOLS = TASK_ROOT.parent
COMMON = runpy.run_path(str(TOOLS / "character-run-video-rebuild.py"))
decode = COMMON["decode"]
cutout = COMMON["cutout"]
lower_body_anchor = COMMON["lower_body_anchor"]
get_model = COMMON["get_model"]

RIFE_TOOL = TOOLS / "rife-spritesheet-interpolate.py"
RIFE_EXE = (
    REPO.parent
    / "_tmp"
    / "elise_audit"
    / "rife"
    / "rife-ncnn-vulkan-20221029-windows"
    / "rife-ncnn-vulkan.exe"
)

SOURCE_VIDEO_FPS = 24
FRAME_HEIGHT = 256
FOOT_Y = 240
TARGET_BODY_HEIGHT = 224

ACTIONS = {
    "snow_advance": {
        "asset": "snow-sepulcher-carrier",
        "displayName": "雪冢驮城兽",
        "action": "advance",
        "video": TASK_ROOT / "animation" / "videos" / "01-snow-sepulcher-carrier-advance-doubao-v01.mp4",
        "reference": TASK_ROOT / "animation" / "references" / "01-snow-sepulcher-carrier-locomotion-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "snow-sepulcher-carrier" / "advance",
        "provider": "doubao-desktop-seedance-2.0-mini",
        "targetBodyHeight": 222,
        "expectedSourceFrames": 121,
        "sourceFrames": list(range(25, 113, 2)),
        "duplicateEndpoint": 113,
        "interpolationMode": "loop",
        "excludedHead": [0, 24],
        "excludedTail": [113, 120],
        "probeFrames": [25, 41, 57, 73, 89, 105, 111, 113],
        "facing": "screen-right low three-quarter",
        "topologyGate": "exactly six massive load-bearing legs remain readable as three pairs while the ruined tower, battlements, cairns, snow mass and armored body stay fused and rigid through the heavy gait",
        "phases": {
            "heavy_six_leg_march_loop": [0, 87],
        },
        "events": {},
        "runtimeVfxContract": "body locomotion loop only; navigation, world translation, velocity, collision and state transitions remain external runtime work",
        "blocked": ["advance_navigation", "world_translation_and_velocity", "collision_motion", "runtime_state_machine"],
    },
    "snow_trample": {
        "asset": "snow-sepulcher-carrier",
        "displayName": "雪冢驮城兽",
        "action": "trample_body",
        "video": TASK_ROOT / "animation" / "videos" / "01-snow-sepulcher-carrier-trample-body-doubao-v01.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "01-snow-sepulcher-carrier-trample-prepare-v01-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "snow-sepulcher-carrier" / "trample-body",
        "provider": "doubao-desktop-seedance-2.0-mini",
        "targetBodyHeight": 222,
        "expectedSourceFrames": 121,
        "sourceFrames": list(range(0, 85, 2)),
        "excludedHead": [],
        "excludedTail": [85, 120],
        "probeFrames": [0, 14, 20, 26, 28, 36, 48, 60, 72, 84],
        "facing": "screen-right low three-quarter",
        "topologyGate": "exactly six massive legs remain traceable as three pairs while only the near-side front leg performs one vertical stomp; the fused ruined tower, battlements, cairns, snow mass and armored body stay rigid",
        "phases": {
            "raised_foot_hold": [0, 12],
            "stomp_descent": [13, 26],
            "impact_load": [27, 48],
            "recover": [49, 72],
            "settled": [73, 84],
        },
        "events": {
            "trampleContactFrame": 26,
            "trampleContactConsumerFrameIfOneBased": 27,
            "sourceTrampleContactFrame": 26,
        },
        "runtimeVfxContract": "body stomp only; snapshot facing on state entry and create the 210x160 forward rectangle, 1.30x physical damage, 70 knockback and any impact VFX externally at the single f26 contact event; approach reach remains separate",
        "blocked": ["trample_directed_rectangle", "trample_damage_and_knockback", "trample_impact_vfx", "basic_melee_approach_profile", "runtime_state_machine"],
    },
    "snow_tower_drop": {
        "asset": "snow-sepulcher-carrier",
        "displayName": "雪冢驮城兽",
        "action": "tower_drop_body",
        "video": TASK_ROOT / "animation" / "videos" / "01-snow-sepulcher-carrier-tower-drop-body-h3-v08.mp4",
        "reference": TASK_ROOT / "animation" / "references" / "01-snow-sepulcher-carrier-locomotion-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "snow-sepulcher-carrier" / "tower-drop-body",
        "provider": "minimax-h3-local",
        "targetBodyHeight": 222,
        "expectedSourceFrames": 124,
        "sourceFrames": list(range(0, 123, 2)),
        "interpolationMode": "one-shot",
        "excludedHead": [],
        "excludedTail": [123, 123],
        "probeFrames": [0, 24, 40, 56, 64, 72, 80, 88, 104, 122],
        "facing": "screen-right low three-quarter",
        "topologyGate": "exactly six individually readable planted legs carry one organic rear-to-front anticipation, deep brace, living firing hold and full recovery while the screen-right axis and rigid fused tower remain stable",
        "phases": {
            "rear_load": [0, 18],
            "rise_anticipation": [19, 40],
            "deep_brace": [41, 63],
            "firing_hold": [64, 80],
            "recover": [81, 122],
        },
        "events": {
            "towerDropFrames": [64, 72, 80],
            "towerDropConsumerFramesIfOneBased": [65, 73, 81],
            "sourceFiringHoldFrames": [64, 72, 80],
            "dropIntervalsFrames": [8, 8],
            "dropIntervalsMs": [331, 331],
        },
        "runtimeVfxContract": "one organic body brace only; snapshot three predicted target points on state entry, then create external 120-radius falling-block impacts during the stable firing hold at f64/f72/f80 for 1.45x physical damage with a per-target maximum of two hits; all telegraphs, blocks, damage and cooldown remain runtime work",
        "blocked": ["tower_drop_prediction_snapshot", "falling_blocks_and_telegraphs", "tower_drop_120_radius_hit_checks", "tower_drop_damage_1_45x", "tower_drop_per_target_hit_cap_2", "tower_drop_cooldown_11s", "runtime_state_machine"],
    },
    "snow": {
        "asset": "snow-sepulcher-carrier",
        "displayName": "雪冢驮城兽",
        "action": "plow_prepare",
        "video": TASK_ROOT / "animation" / "videos" / "01-snow-sepulcher-carrier-plow-windup-h3-v02.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "01-snow-sepulcher-carrier-plow-windup-v02-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "snow-sepulcher-carrier",
        "provider": "minimax-h3-local",
        "targetBodyHeight": 222,
        "fixedSourceAnchorX": 317.0,
        "expectedSourceFrames": 124,
        "sourceFrames": list(range(8, 101, 2)),
        "excludedHead": [0, 7],
        "excludedTail": [101, 123],
        "probeFrames": [8, 24, 44, 68, 76, 96, 100],
        "facing": "screen-right low three-quarter",
        "topologyGate": "six weight-bearing legs and fused back tower remain readable",
        "phases": {
            "settle_into_brace": [0, 20],
            "brace": [21, 60],
            "fully_braced_hold": [61, 67],
            "recover": [68, 88],
            "settled": [89, 92],
        },
        "events": {
            "fullyBracedFrame": 60,
            "fullyBracedConsumerFrameIfOneBased": 61,
            "sourceFullyBracedFrame": 68,
        },
        "runtimeVfxContract": "body brace only; collider charge, snow plow trail and impact remain external and blocked",
        "blocked": ["plow_charge_and_impact", "collider_translation", "damage"],
    },
    "bell": {
        "asset": "white-silence-bell-hart",
        "displayName": "白寂鸣钟鹿",
        "action": "double_toll_body",
        "video": TASK_ROOT / "animation" / "videos" / "03-white-silence-bell-hart-double-toll-h3-v01.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "03-white-silence-bell-hart-double-toll-prepare-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "white-silence-bell-hart",
        "provider": "minimax-h3-local",
        "targetBodyHeight": 208,
        "fixedSourceAnchorX": 417.0,
        "expectedSourceFrames": 124,
        "sourceFrames": list(range(12, 85, 2)),
        "excludedHead": [0, 11],
        "excludedTail": [85, 123],
        "probeFrames": [12, 24, 36, 48, 62, 76, 84],
        "facing": "screen-right low three-quarter",
        "topologyGate": "four legs, antlers, one abdominal bell and exactly three pendants remain readable",
        "phases": {
            "backswing": [0, 12],
            "warning_toll": [13, 24],
            "return_swing": [25, 49],
            "damage_toll": [50, 56],
            "recover": [57, 72],
        },
        "events": {
            "warningRingFrame": 24,
            "warningRingConsumerFrameIfOneBased": 25,
            "sourceWarningRingFrame": 36,
            "damageRingFrame": 50,
            "damageRingConsumerFrameIfOneBased": 51,
            "sourceDamageRingFrame": 62,
            "warningToDamageMs": 1083,
            "futureThirdEchoOffsetMs": 750,
        },
        "runtimeVfxContract": "warning ring, delayed damage ring and optional third echo are external events; body sheet contains no ring VFX",
        "blocked": ["warning_ring_vfx", "damage_ring_vfx_and_damage", "third_echo", "runtime_state_machine"],
    },
    "bell_antler": {
        "asset": "white-silence-bell-hart",
        "displayName": "白寂鸣钟鹿",
        "action": "antler_body",
        "video": TASK_ROOT / "animation" / "videos" / "03-white-silence-bell-hart-antler-body-h3-v04.mp4",
        "reference": TASK_ROOT / "animation" / "references" / "03-white-silence-bell-hart-locomotion-fixed-camera-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "white-silence-bell-hart" / "antler-body",
        "provider": "minimax-h3-local",
        "targetBodyHeight": 208,
        "fixedSourceAnchorX": 429.0,
        "expectedSourceFrames": 124,
        "sourceFrames": list(range(0, 101, 2)),
        "interpolationMode": "one-shot",
        "excludedHead": [],
        "excludedTail": [101, 123],
        "probeFrames": [0, 16, 24, 32, 40, 46, 50, 54, 58, 60, 62, 64, 72, 84, 100],
        "facing": "screen-right low three-quarter",
        "topologyGate": "exactly four traceable load-bearing legs support one planted defensive antler strike; three support hooves remain registered in the fixed camera while the near front hoof lifts and returns; the beaked skull, rigid branching antlers, hollow rib frame, one abdominal bell and exactly three pendants remain stable",
        "phases": {
            "alert": [0, 16],
            "weight_shift_and_probe": [17, 32],
            "neck_coil": [33, 44],
            "antler_strike": [45, 60],
            "contact_followthrough": [61, 70],
            "recover": [71, 100],
        },
        "events": {
            "antlerContactFrame": 60,
            "antlerContactConsumerFrameIfOneBased": 61,
            "sourceAntlerContactFrame": 60,
        },
        "runtimeVfxContract": "body strike only; snapshot facing on state entry and create the external forward narrow 230 sector, 1.25x physical damage and one-second limp at the single f60 contact event; hit checks and state transitions remain runtime work",
        "blocked": ["antler_forward_230_sector", "antler_damage_1_25x", "antler_limp_debuff_1s", "antler_hit_resolution", "runtime_state_machine"],
    },
    "bell_long_tone": {
        "asset": "white-silence-bell-hart",
        "displayName": "白寂鸣钟鹿",
        "action": "long_tone_body",
        "video": TASK_ROOT / "animation" / "videos" / "03-white-silence-bell-hart-long-tone-body-h3-v01.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "03-white-silence-bell-hart-long-tone-prepare-v01-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "white-silence-bell-hart" / "long-tone-body",
        "provider": "minimax-h3-local",
        "targetBodyHeight": 208,
        "fixedSourceAnchorX": 439.0,
        "expectedSourceFrames": 124,
        "sourceFrames": list(range(0, 109, 2)),
        "interpolationMode": "one-shot",
        "excludedHead": [],
        "excludedTail": [109, 123],
        "probeFrames": [0, 16, 24, 32, 40, 48, 56, 64, 72, 84, 96, 108],
        "facing": "screen-right low three-quarter",
        "topologyGate": "exactly four planted load-bearing legs, the right-facing beaked skull, rigid branching antlers, hollow rib frame, one abdominal bell and exactly three pendants remain stable while the bell and upper body perform one backward draw, one strong forward release and one weaker damped return",
        "phases": {
            "hold_prepare": [0, 8],
            "backswing_charge": [9, 32],
            "forward_release": [33, 56],
            "resonance_hold": [57, 68],
            "damped_return": [69, 92],
            "recover": [93, 108],
        },
        "events": {
            "longToneReleaseFrame": 56,
            "longToneReleaseConsumerFrameIfOneBased": 57,
            "sourceLongToneReleaseFrame": 56,
        },
        "runtimeVfxContract": "body release only; snapshot facing on state entry and create the external forward 620x120 resonance rectangle at the single f56 event for 1.60x magic damage and 0.7-second stun; hit checks, VFX, cooldown and state transitions remain runtime work",
        "blocked": ["long_tone_forward_620x120_rectangle", "long_tone_magic_damage_1_60x", "long_tone_stun_0_7s", "long_tone_vfx", "long_tone_cooldown_12s", "runtime_state_machine"],
    },
    "bell_hoof_sequence": {
        "asset": "white-silence-bell-hart",
        "displayName": "白寂鸣钟鹿",
        "action": "hoof_sequence_body",
        "video": TASK_ROOT / "animation" / "videos" / "03-white-silence-bell-hart-hoof-sequence-body-h3-v02.mp4",
        "reference": TASK_ROOT / "animation" / "references" / "03-white-silence-bell-hart-locomotion-fixed-camera-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "white-silence-bell-hart" / "hoof-sequence-body",
        "provider": "minimax-h3-local",
        "targetBodyHeight": 208,
        "fixedSourceAnchorX": 429.0,
        "expectedSourceFrames": 124,
        "sourceFrames": [0, 4, 8, 10, 12, 16, 19, 21, 22, 30, 37, 42, 45, 48, 53, 57, 60, 71, 74, 78, 80, 84, 88, 92, 96, 100, 104, 106, 108],
        "durationMs": 2333,
        "sourceWindowSemantics": "non-uniform audited full-frame sampling from source f0..f108; neutral gaps are compressed, no frame is spatially transformed",
        "temporalRetiming": {
            "mode": "non-uniform-complete-source-frame-sampling-before-one-shot-rife",
            "sourceWindowWallClockMs": 4500,
            "formalWallClockMs": 2333,
            "reason": "preserve all four natural low hoof arcs while restoring the designed eight-formal-frame impact cadence"
        },
        "interpolationMode": "one-shot",
        "excludedHead": [],
        "excludedTail": [109, 123],
        "probeFrames": [0, 12, 16, 22, 30, 37, 45, 48, 53, 60, 71, 74, 80, 92, 108],
        "facing": "screen-right low three-quarter",
        "topologyGate": "exactly four complete load-bearing legs perform four separate low taps from screen-left to screen-right with no overlapping airborne intervals; the fixed camera, right-facing beaked skull, rigid branching antlers, hollow rib frame, one abdominal bell and exactly three pendants remain stable",
        "phases": {
            "hold_prepare": [0, 7],
            "hoof_1": [8, 16],
            "hoof_2": [17, 24],
            "hoof_3": [25, 32],
            "hoof_4": [33, 40],
            "planted_recoil": [41, 46],
            "recover": [47, 56]
        },
        "events": {
            "hoofContactFrames": [16, 24, 32, 40],
            "hoofContactConsumerFramesIfOneBased": [17, 25, 33, 41],
            "sourceHoofContactFrames": [22, 45, 60, 80],
            "contactIntervalsFrames": [8, 8, 8],
            "contactIntervalsMs": [333, 333, 333]
        },
        "runtimeVfxContract": "body taps only; create one external 105-radius impact circle at each f16/f24/f32/f40 contact event for 1.00x physical damage, with a per-target maximum of two hits across the cast; circles, damage, cooldown and state transitions remain runtime work",
        "blocked": ["hoof_sequence_four_105_radius_circles", "hoof_sequence_physical_damage_1_00x", "hoof_sequence_per_target_hit_cap_2", "hoof_sequence_impact_vfx", "hoof_sequence_cooldown_8s", "runtime_state_machine"]
    },
    "bell_rhythm_shift": {
        "asset": "white-silence-bell-hart",
        "displayName": "白寂鸣钟鹿",
        "action": "rhythm_shift_body",
        "video": TASK_ROOT / "animation" / "videos" / "03-white-silence-bell-hart-rhythm-shift-body-h3-v01.mp4",
        "reference": TASK_ROOT / "animation" / "references" / "03-white-silence-bell-hart-locomotion-fixed-camera-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "white-silence-bell-hart" / "rhythm-shift-body",
        "provider": "minimax-h3-local",
        "targetBodyHeight": 208,
        "fixedSourceAnchorX": 429.0,
        "expectedSourceFrames": 124,
        "sourceFrames": list(range(0, 109, 2)),
        "interpolationMode": "one-shot",
        "excludedHead": [],
        "excludedTail": [109, 123],
        "probeFrames": [0, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 108],
        "facing": "screen-right low three-quarter",
        "topologyGate": "exactly four planted load-bearing legs transmit one rear-to-front tuning rise into one held chest-and-neck phase-lock pose; the fixed camera, right-facing beaked skull, rigid branching antlers, hollow rib frame, one attached mostly vertical abdominal bell and exactly three pendants remain stable",
        "phases": {
            "hold_prepare": [0, 12],
            "rear_to_front_tension": [13, 32],
            "pendant_response": [33, 48],
            "phase_lock": [49, 68],
            "front_to_rear_release": [69, 88],
            "recover": [89, 108]
        },
        "events": {
            "rhythmShiftFrame": 52,
            "rhythmShiftConsumerFrameIfOneBased": 53,
            "sourceRhythmShiftFrame": 52
        },
        "runtimeVfxContract": "non-damaging body transition only; enable the below-45-percent rhythm phase once at f52, then keep the third-echo counter, 0.75-second post-second-toll delay, narrow colored ring and 0.90x magic damage external to this sheet",
        "blocked": ["rhythm_shift_below_45_percent_one_shot_trigger", "third_echo_every_two_double_tolls_counter", "third_echo_delay_0_75s", "third_echo_narrow_colored_ring_vfx", "third_echo_magic_damage_0_90x", "runtime_state_machine"]
    },
    "bell_stride": {
        "asset": "white-silence-bell-hart",
        "displayName": "白寂鸣钟鹿",
        "action": "stride",
        "video": TASK_ROOT / "animation" / "videos" / "03-white-silence-bell-hart-stride-h3-v01.mp4",
        "reference": TASK_ROOT / "animation" / "references" / "03-white-silence-bell-hart-locomotion-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "white-silence-bell-hart" / "stride",
        "provider": "minimax-h3-local",
        "targetBodyHeight": 208,
        "fixedSourceAnchorX": 433.0,
        "expectedSourceFrames": 124,
        "sourceFrames": list(range(40, 93, 2)),
        "duplicateEndpoint": 93,
        "interpolationMode": "loop",
        "excludedHead": [0, 39],
        "excludedTail": [93, 123],
        "probeFrames": [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 92, 93],
        "facing": "screen-right low three-quarter",
        "topologyGate": "exactly four complete load-bearing legs perform one continuous alternating stride cycle; the right-facing beaked skull, rigid branching antlers, hollow rib frame, one abdominal bell and exactly three pendants remain stable, with source f93 matching source f40 as the excluded same-phase endpoint",
        "phases": {
            "calm_four_leg_stride_loop": [0, 53]
        },
        "events": {},
        "runtimeVfxContract": "body locomotion loop only; navigation, world translation, velocity, collision and state transitions remain external runtime work",
        "blocked": ["stride_navigation", "world_translation_and_velocity", "collision_motion", "runtime_state_machine"]
    },
    "aurora_oldstep": {
        "asset": "aurora-fate-weaver",
        "displayName": "极光织命母",
        "action": "oldstep_body",
        "video": TASK_ROOT / "animation" / "videos" / "02-aurora-fate-weaver-oldstep-body-doubao-v01.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "02-aurora-fate-weaver-oldstep-prepare-v01-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "aurora-fate-weaver" / "oldstep-body",
        "provider": "doubao-desktop-seedance-2.0-mini",
        "expectedSourceFrames": 121,
        "sourceFrames": list(range(0, 85, 2)),
        "excludedHead": [],
        "excludedTail": [85, 120],
        "probeFrames": [0, 24, 40, 50, 62, 66, 84],
        "facing": "screen-right low three-quarter",
        "topologyGate": "six weight-bearing walking legs, two smaller weaving arms, open ring and contained aurora membrane remain stable",
        "phases": {
            "hold_prepare": [0, 12],
            "lower_arm_beat": [13, 30],
            "upper_arm_beat": [31, 56],
            "dual_arm_beat": [57, 68],
            "recover": [69, 84],
        },
        "events": {
            "oldestHistoryStrikeFrame": 24,
            "oldestHistoryStrikeConsumerFrameIfOneBased": 25,
            "middleHistoryStrikeFrame": 50,
            "middleHistoryStrikeConsumerFrameIfOneBased": 51,
            "newestHistoryStrikeFrame": 66,
            "newestHistoryStrikeConsumerFrameIfOneBased": 67,
            "sourceStrikeFrames": [24, 50, 66],
        },
        "runtimeVfxContract": "body gesture only; snapshot three historical positions on state entry and spawn all strike zones, telegraphs and damage externally",
        "blocked": ["oldstep_history_snapshot", "oldstep_strike_zones_and_damage", "runtime_state_machine"],
    },
    "aurora_tether": {
        "asset": "aurora-fate-weaver",
        "displayName": "极光织命母",
        "action": "tether_body",
        "video": TASK_ROOT / "animation" / "videos" / "02-aurora-fate-weaver-tether-body-doubao-v01.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "02-aurora-fate-weaver-tether-prepare-v02-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "aurora-fate-weaver" / "tether-body",
        "provider": "doubao-desktop-seedance-2.0-mini",
        "expectedSourceFrames": 121,
        "sourceFrames": list(range(0, 105, 2)),
        "excludedHead": [],
        "excludedTail": [105, 120],
        "probeFrames": [0, 24, 32, 50, 54, 58, 78, 86, 104],
        "facing": "screen-right low three-quarter",
        "topologyGate": "six weight-bearing walking legs, two smaller weaving arms, open ring and contained aurora membrane remain stable through the self-occluding reel gesture",
        "phases": {
            "hold_prepare": [0, 12],
            "spread_and_lock": [13, 32],
            "tension_hold": [33, 50],
            "cross_and_reel": [51, 58],
            "hold_pull": [59, 78],
            "release": [79, 96],
            "recover": [97, 104],
        },
        "events": {
            "tetherLinesFrame": 32,
            "tetherLinesConsumerFrameIfOneBased": 33,
            "sourceTetherLinesFrame": 32,
            "tetherPullFrame": 58,
            "tetherPullConsumerFrameIfOneBased": 59,
            "sourceTetherPullFrame": 58,
            "lineToPullMs": 1083,
        },
        "runtimeVfxContract": "body gesture only; choose up to three distant targets and spawn visible tether lines externally at f32, then recheck LOS and apply the 140-unit pull externally at f58",
        "blocked": ["tether_target_selection_and_los", "tether_line_vfx", "tether_pull_displacement", "runtime_state_machine"],
    },
    "aurora_cut": {
        "asset": "aurora-fate-weaver",
        "displayName": "极光织命母",
        "action": "cut_body",
        "video": TASK_ROOT / "animation" / "videos" / "02-aurora-fate-weaver-cut-body-doubao-v01.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "02-aurora-fate-weaver-tether-prepare-v02-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "aurora-fate-weaver" / "cut-body",
        "provider": "doubao-desktop-seedance-2.0-mini",
        "expectedSourceFrames": 121,
        "sourceFrames": list(range(0, 85, 2)),
        "excludedHead": [],
        "excludedTail": [85, 120],
        "probeFrames": [0, 14, 18, 20, 23, 39, 59, 67, 75, 84],
        "facing": "screen-right low three-quarter",
        "topologyGate": "six weight-bearing walking legs, two smaller weaving arms, open ring and contained aurora membrane remain stable; the arms may overlap only as two separately traceable scissor blades",
        "phases": {
            "hold_prepare": [0, 13],
            "scissor_close": [14, 20],
            "contact_hold": [21, 62],
            "reopen": [63, 76],
            "recover": [77, 84],
        },
        "events": {
            "cutContactFrame": 20,
            "cutContactConsumerFrameIfOneBased": 21,
            "sourceCutContactFrame": 20,
        },
        "runtimeVfxContract": "body gesture only; snapshot the front direction on state entry and create the directed contact sector, damage and knockback externally at the single f20 contact event",
        "blocked": ["cut_directed_sector", "cut_damage_and_knockback", "basic_melee_approach_profile", "runtime_state_machine"],
    },
    "aurora_seek": {
        "asset": "aurora-fate-weaver",
        "displayName": "极光织命母",
        "action": "seek_band",
        "video": TASK_ROOT / "animation" / "videos" / "02-aurora-fate-weaver-seek-band-doubao-v01.mp4",
        "reference": TASK_ROOT / "animation" / "references" / "02-aurora-fate-weaver-locomotion-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "aurora-fate-weaver" / "seek-band",
        "provider": "doubao-desktop-seedance-2.0-mini",
        "expectedSourceFrames": 121,
        "sourceFrames": list(range(6, 114, 2)),
        "duplicateEndpoint": 114,
        "interpolationMode": "loop",
        "excludedHead": [0, 5],
        "excludedTail": [114, 120],
        "probeFrames": [6, 24, 42, 60, 78, 96, 112, 114],
        "facing": "screen-right low three-quarter",
        "topologyGate": "six weight-bearing walking legs alternate without role swaps, both shorter weaving arms remain raised, and the open ring plus contained crossed membrane stay stable through the full gait cycle",
        "phases": {
            "alternating_tripod_gait_loop": [0, 107],
        },
        "events": {},
        "runtimeVfxContract": "body locomotion loop only; navigation, world translation, velocity, collision and state transitions remain external runtime work",
        "blocked": ["seek_band_navigation", "world_translation_and_velocity", "collision_motion", "runtime_state_machine"],
    },
    "aurora_reweave": {
        "asset": "aurora-fate-weaver",
        "displayName": "极光织命母",
        "action": "reweave_body",
        "video": TASK_ROOT / "animation" / "videos" / "02-aurora-fate-weaver-reweave-body-doubao-v02.mp4",
        "reference": TASK_ROOT / "animation" / "action-references" / "02-aurora-fate-weaver-body-cast-v02-1024x576.png",
        "outRoot": TASK_ROOT / "animation" / "formal" / "aurora-fate-weaver" / "reweave-body",
        "provider": "doubao-desktop-seedance-2.0-mini",
        "expectedSourceFrames": 121,
        "sourceFrames": list(range(0, 121, 2)),
        "excludedHead": [],
        "excludedTail": [],
        "probeFrames": [0, 24, 48, 60, 72, 84, 96, 108, 120],
        "facing": "screen-right low three-quarter",
        "topologyGate": "six weight-bearing walking legs, two smaller weaving arms, open hard ring and the contained crossed cyan-purple membrane remain stable through one quiet brace-and-calibrate gesture",
        "phases": {
            "hold_prepare": [0, 12],
            "brace_and_align": [13, 60],
            "calibrate_and_hold": [61, 84],
            "recover": [85, 120],
        },
        "events": {
            "reweaveCompleteFrame": 84,
            "reweaveCompleteConsumerFrameIfOneBased": 85,
            "sourceReweaveCompleteFrame": 84,
        },
        "runtimeVfxContract": "body gesture only; the crossed membrane stays contained and visually stable, while the one-time half-health phase transition, cadence changes, fourth oldstep history point and any external VFX remain runtime events triggered at f84",
        "blocked": ["half_health_one_shot_trigger", "triangle_cadence_change", "oldstep_fourth_history_point", "external_reweave_vfx", "runtime_state_machine"],
    },
}


def alpha_bbox(frame: np.ndarray, threshold: int = 8) -> tuple[int, int, int, int]:
    ys, xs = np.where(frame[..., 3] > threshold)
    if not len(xs):
        raise RuntimeError("empty alpha frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def paste_checked(content: np.ndarray, x: int, y: int, width: int, height: int) -> np.ndarray:
    ch, cw = content.shape[:2]
    if x < 3 or y < 3 or x + cw > width - 3 or y + ch > height - 3:
        raise RuntimeError(f"content clips: {cw}x{ch} at ({x},{y}) in {width}x{height}")
    frame = np.zeros((height, width, 4), dtype=np.uint8)
    frame[y:y + ch, x:x + cw] = content
    frame[frame[..., 3] == 0, :3] = 0
    return frame


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    height, width = cells[0].shape[:2]
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * height, cols * width, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * height:(row + 1) * height, col * width:(col + 1) * width] = cell
    return sheet


def extract_cells(path: Path, width: int, height: int, count: int, cols: int) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    return [
        sheet[(index // cols) * height:(index // cols + 1) * height,
              (index % cols) * width:(index % cols + 1) * width].copy()
        for index in range(count)
    ]


def checker(frame: np.ndarray) -> Image.Image:
    yy, xx = np.indices(frame.shape[:2])
    shade = np.where(((xx // 16 + yy // 16) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    rgb = np.clip(frame[..., :3] * alpha + background * (1.0 - alpha), 0, 255)
    return Image.fromarray(rgb.astype(np.uint8), "RGB")


def distributed_durations(frame_count: int, total_ms: int) -> list[int]:
    preview_ms = round(total_ms / 10) * 10
    ticks = [round(index * preview_ms / frame_count / 10) for index in range(frame_count + 1)]
    values = [(ticks[index + 1] - ticks[index]) * 10 for index in range(frame_count)]
    if min(values) <= 0 or sum(values) != preview_ms:
        raise RuntimeError(f"invalid GIF timing: {values}")
    return values


def save_contact(cells: list[np.ndarray], labels: list[str], path: Path, cols: int) -> None:
    thumb_w, thumb_h, label_h = 288, 192, 24
    rows = math.ceil(len(cells) / cols)
    contact = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for index, (cell, label) in enumerate(zip(cells, labels)):
        preview = checker(cell).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = (index % cols) * thumb_w
        y = (index // cols) * (thumb_h + label_h)
        contact.paste(preview, (x, y))
        draw.text((x + 5, y + thumb_h + 3), label, fill="white")
    path.parent.mkdir(parents=True, exist_ok=True)
    contact.save(path)


def round32(value: int) -> int:
    return max(192, math.ceil(value / 32) * 32)


def choose_cols(frame_count: int, frame_width: int) -> int:
    max_cols = max(1, 4096 // frame_width)
    candidates = []
    for cols in range(5, max_cols + 1):
        cells = math.ceil(frame_count / cols) * cols
        empty_ratio = (cells - frame_count) / cells
        if empty_ratio <= 0.125:
            width = cols * frame_width
            height = math.ceil(frame_count / cols) * FRAME_HEIGHT
            if width > 4096 or height > 4096:
                continue
            candidates.append((cells, abs(width - height), max(width, height), cols))
    if not candidates:
        raise RuntimeError(f"no <=4096 layout for {frame_count} frames at width {frame_width}")
    return min(candidates)[-1]


def frame_stats(source_index: int, rgba: np.ndarray) -> dict:
    x0, y0, x1, y1 = alpha_bbox(rgba)
    alpha = rgba[..., 3]
    visible = alpha > 8
    semi = (alpha > 8) & (alpha < 247)
    return {
        "sourceFrame": source_index,
        "bbox": [x0, y0, x1, y1],
        "visiblePixels": int(visible.sum()),
        "semiTransparentPixels": int(semi.sum()),
        "semiTransparentRatio": round(float(semi.sum() / max(1, visible.sum())), 6),
    }


def build_probe(keys: list[str]) -> None:
    model = get_model()
    for key in keys:
        spec = ACTIONS[key]
        frames, fps = decode(spec["video"])
        probe_dir = spec["outRoot"] / "probe-birefnet"
        probe_dir.mkdir(parents=True, exist_ok=True)
        cutouts = []
        stats = []
        for source_index in spec["probeFrames"]:
            rgba = cutout(frames[source_index], model)
            rgba[rgba[..., 3] == 0, :3] = 0
            cutouts.append(rgba)
            stats.append(frame_stats(source_index, rgba))
            Image.fromarray(rgba, "RGBA").save(probe_dir / f"source-f{source_index:03d}-birefnet.png")
            print(f"[{key}-probe] BiRefNet source f{source_index}", flush=True)
        save_contact(
            cutouts,
            [f"source f{index}" for index in spec["probeFrames"]],
            probe_dir / f"{spec['asset']}-{spec['action']}-birefnet-probe-contact.png",
            cols=7,
        )
        report = {
            "sourceVideo": str(spec["video"].relative_to(TASK_ROOT)).replace("\\", "/"),
            "decodedFrameCount": len(frames),
            "sourceVideoFps": fps,
            "probeFrames": spec["probeFrames"],
            "topologyGate": spec["topologyGate"],
            "cutout": "ComfyUI-RMBG BiRefNet-general via ai-asset pipeline module",
            "frames": stats,
        }
        (probe_dir / "probe-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def build_source_cells(
    frames: list[np.ndarray], selected: list[int], model, target_body_height: int,
    fixed_source_anchor_x: float | None = None,
) -> tuple[list[np.ndarray], int, float]:
    cutouts = {}
    for source_index in selected:
        cutouts[source_index] = cutout(frames[source_index], model)
        print(f"[approved-action] BiRefNet source f{source_index}", flush=True)

    reference = cutouts[selected[0]]
    _rx0, ry0, _rx1, ry1 = alpha_bbox(reference)
    base_scale = target_body_height / (ry1 - ry0 + 1)
    prepared = []
    required_half_width = 0.0
    for source_index in selected:
        rgba = cutouts[source_index]
        x0, y0, x1, y1 = alpha_bbox(rgba)
        crop = rgba[y0:y1 + 1, x0:x1 + 1]
        size = (
            max(1, round(crop.shape[1] * base_scale)),
            max(1, round(crop.shape[0] * base_scale)),
        )
        resized = np.asarray(Image.fromarray(crop, "RGBA").resize(size, Image.Resampling.LANCZOS))
        source_anchor = (
            fixed_source_anchor_x
            if fixed_source_anchor_x is not None
            else lower_body_anchor(rgba)
        )
        local_anchor = (source_anchor - x0) * base_scale
        required_half_width = max(required_half_width, local_anchor + 4, resized.shape[1] - local_anchor + 4)
        prepared.append((resized, local_anchor))

    frame_width = round32(math.ceil(required_half_width * 2 + 8))
    cells = []
    for resized, local_anchor in prepared:
        x = round(frame_width / 2 - local_anchor)
        y = FOOT_Y - resized.shape[0]
        cells.append(paste_checked(resized, x, y, frame_width, FRAME_HEIGHT))
    return cells, frame_width, base_scale


def validate(cells: list[np.ndarray]) -> dict:
    boxes = [alpha_bbox(cell) for cell in cells]
    return {
        "emptyFrames": [index for index, cell in enumerate(cells) if not np.any(cell[..., 3] > 8)],
        "touchingFrames": [
            index
            for index, (x0, y0, x1, y1) in enumerate(boxes)
            if x0 <= 2 or y0 <= 2 or x1 >= cells[index].shape[1] - 3 or y1 >= cells[index].shape[0] - 3
        ],
        "alphaBottomMin": min(box[3] for box in boxes),
        "alphaBottomMax": max(box[3] for box in boxes),
        "nonzeroRgbInTransparentPixels": max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        ),
    }


def build_action(key: str, model) -> None:
    spec = ACTIONS[key]
    out_root = spec["outRoot"]
    source_dir = out_root / "source-sheets-pre-rife"
    final_dir = out_root / "formal-final"
    preview_dir = out_root / "previews"
    report_dir = out_root / "reports"
    rife_work = preview_dir / "rife-tool"
    for directory in (source_dir, final_dir, preview_dir, report_dir, rife_work):
        directory.mkdir(parents=True, exist_ok=True)

    frames, fps = decode(spec["video"])
    if len(frames) != spec["expectedSourceFrames"] or abs(fps - SOURCE_VIDEO_FPS) > 0.01:
        raise RuntimeError(f"unexpected source video contract: frames={len(frames)} fps={fps}")
    selected = spec["sourceFrames"]
    interpolation_mode = spec.get("interpolationMode", "one-shot")
    duplicate_endpoint = spec.get("duplicateEndpoint")
    duration_end = duplicate_endpoint if interpolation_mode == "loop" else selected[-1]
    source_window_wall_clock_ms = round((duration_end - selected[0]) * 1000 / SOURCE_VIDEO_FPS)
    duration_ms = spec.get("durationMs", source_window_wall_clock_ms)
    target_body_height = spec.get("targetBodyHeight", TARGET_BODY_HEIGHT)
    source_cells, frame_width, base_scale = build_source_cells(
        frames, selected, model, target_body_height, spec.get("fixedSourceAnchorX")
    )
    source_cols = choose_cols(len(source_cells), frame_width)
    source_sheet = source_dir / f"{spec['action'].replace('_', '-')}.png"
    Image.fromarray(compose(source_cells, source_cols), "RGBA").save(
        source_sheet, optimize=True, compress_level=9
    )
    source_contact = preview_dir / f"{spec['asset']}-{spec['action']}-source-contact.png"
    save_contact(
        source_cells,
        [f"key {index} / source f{source}" for index, source in enumerate(selected)],
        source_contact,
        cols=min(9, source_cols),
    )

    final_source_frame_map = spec.get("finalSourceFrameMap")
    exact_reuse = final_source_frame_map is not None
    final_count = (
        len(final_source_frame_map)
        if exact_reuse
        else len(source_cells) * 2 if interpolation_mode == "loop" else len(source_cells) * 2 - 1
    )
    final_cols = choose_cols(final_count, frame_width)
    final_sheet = final_dir / f"{spec['action'].replace('_', '-')}.png"
    if exact_reuse:
        cell_by_source = dict(zip(selected, source_cells))
        unknown_mapped = sorted(set(final_source_frame_map) - set(cell_by_source))
        if unknown_mapped:
            raise RuntimeError(f"unknown mapped source frames for {key}: {unknown_mapped}")
        final_cells = [cell_by_source[index].copy() for index in final_source_frame_map]
        Image.fromarray(compose(final_cells, final_cols), "RGBA").save(
            final_sheet, optimize=True, compress_level=9
        )
        exact_report = report_dir / f"{spec['action'].replace('_', '-')}-exact-reuse.json"
        exact_report.write_text(
            json.dumps(
                {
                    "version": 1,
                    "mode": "exact-complete-frame-reuse-and-reversal",
                    "interpolationPasses": 0,
                    "selectedUniqueSourceFrames": selected,
                    "outputSourceFrameMap": final_source_frame_map,
                    "outputFrameCount": final_count,
                    "durationMs": duration_ms,
                    "derivedPreview": str(spec["derivedPreview"].relative_to(TASK_ROOT)).replace("\\", "/"),
                    "derivedProvenance": str(spec["derivedProvenance"].relative_to(TASK_ROOT)).replace("\\", "/"),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        processing_report = exact_report
        key_preserved = all(
            np.array_equal(cell_by_source[source_index], final_cells[output_index])
            for output_index, source_index in enumerate(final_source_frame_map)
        )
    else:
        rife_report = report_dir / f"{spec['action'].replace('_', '-')}-rife.json"
        command = [
            sys.executable,
            str(RIFE_TOOL),
            "--sheet", str(source_sheet),
            "--out", str(final_sheet),
            "--name", f"{spec['asset']}-{spec['action']}",
            "--frame-width", str(frame_width),
            "--frame-height", str(FRAME_HEIGHT),
            "--cols", str(source_cols),
            "--frame-count", str(len(source_cells)),
            "--frame-rate", str(len(source_cells) * 1000 / duration_ms),
            "--mode", interpolation_mode,
            "--out-cols", str(final_cols),
            "--preview-dir", str(rife_work),
            "--report", str(rife_report),
            "--rife", str(RIFE_EXE),
            "--repair-magenta-middle",
            "--hold-large-repair",
        ]
        subprocess.run(command, check=True)
        rife_data = json.loads(rife_report.read_text(encoding="utf-8"))
        if int(rife_data["outputFrameCount"]) != final_count:
            raise RuntimeError(f"unexpected RIFE output count for {key}")
        final_cells = extract_cells(final_sheet, frame_width, FRAME_HEIGHT, final_count, final_cols)
        key_preserved = all(
            np.array_equal(source, final_cells[index * 2]) for index, source in enumerate(source_cells)
        )
        processing_report = rife_report

    gif_timing = distributed_durations(final_count, duration_ms)
    gif_frames = [checker(cell) for cell in final_cells]
    preview_gif = preview_dir / f"{spec['asset']}-{spec['action']}.gif"
    gif_frames[0].save(
        preview_gif,
        save_all=True,
        append_images=gif_frames[1:],
        duration=gif_timing,
        loop=0,
        disposal=2,
        optimize=False,
    )
    final_contact = preview_dir / f"{spec['asset']}-{spec['action']}-contact.png"
    save_contact(
        final_cells,
        (
            [f"f{index} / source f{source}" for index, source in enumerate(final_source_frame_map)]
            if exact_reuse
            else [f"f{index} {'key' if index % 2 == 0 else 'RIFE'}" for index in range(final_count)]
        ),
        final_contact,
        cols=min(9, final_cols),
    )

    validation = validate(final_cells)
    validation[
        "originalMappedFramesPreservedExactly" if exact_reuse else "originalKeyFramesPreservedAtEvenIndices"
    ] = key_preserved
    if (
        validation["emptyFrames"]
        or validation["touchingFrames"]
        or validation["nonzeroRgbInTransparentPixels"]
        or not key_preserved
    ):
        raise RuntimeError(f"formal sprite validation failed for {key}: {validation}")
    with Image.open(final_sheet) as atlas:
        atlas_width, atlas_height = atlas.size
    if atlas_width > 4096 or atlas_height > 4096:
        raise RuntimeError(f"atlas exceeds 4096 for {key}: {atlas_width}x{atlas_height}")
    decoded_bytes = atlas_width * atlas_height * 4
    action_slug = spec["action"].replace("_", "-")
    manifest = {
        "asset": spec["asset"],
        "displayName": spec["displayName"],
        "action": spec["action"],
        "stage": "formal-sprite-asset-ready-not-runtime-integrated",
        "assetOnly": True,
        "runtimeIntegrationActive": False,
        "budgetTier": "boss",
        "facing": spec["facing"],
        "topologyGate": spec["topologyGate"],
        "rootMotion": (
            f"preserved from fixed raw-video source anchor x={spec['fixedSourceAnchorX']}; no per-frame recentering"
            if "fixedSourceAnchorX" in spec
            else "locked by lower-body anchor; no collider translation is baked into this sheet"
        ),
        "sourceVideo": str(spec["video"].relative_to(TASK_ROOT)).replace("\\", "/"),
        "sourceVideoProvider": spec["provider"],
        "sourceProvenance": str(spec["video"].relative_to(TASK_ROOT)).replace("\\", "/") + ".json",
        "sourceReference": str(spec["reference"].relative_to(TASK_ROOT)).replace("\\", "/"),
        "selectedSourceFrames": selected,
        "sourceWindow": [selected[0], duration_end],
        "sourceWindowSemantics": spec.get(
            "sourceWindowSemantics",
            "accepted native key subrange, then exact full-cell reuse/reversal"
            if exact_reuse
            else "half-open [start, duplicateEndpoint)" if interpolation_mode == "loop" else "inclusive [start, end]",
        ),
        "duplicateEndpoint": duplicate_endpoint,
        "sourceVideoFps": SOURCE_VIDEO_FPS,
        "sourceWallClockMs": source_window_wall_clock_ms,
        "formalWallClockMs": duration_ms,
        **({"temporalRetiming": spec["temporalRetiming"]} if "temporalRetiming" in spec else {}),
        "excludedHead": spec["excludedHead"],
        "excludedTail": spec["excludedTail"],
        "sourceSheet": str(source_sheet.relative_to(TASK_ROOT)).replace("\\", "/"),
        "finalSheet": str(final_sheet.relative_to(TASK_ROOT)).replace("\\", "/"),
        "previewGif": str(preview_gif.relative_to(TASK_ROOT)).replace("\\", "/"),
        "sourceContactSheet": str(source_contact.relative_to(TASK_ROOT)).replace("\\", "/"),
        "finalContactSheet": str(final_contact.relative_to(TASK_ROOT)).replace("\\", "/"),
        "processingReport": str(processing_report.relative_to(TASK_ROOT)).replace("\\", "/"),
        **(
            {
                "derivedPreviewVideo": str(spec["derivedPreview"].relative_to(TASK_ROOT)).replace("\\", "/"),
                "derivedPreviewProvenance": str(spec["derivedProvenance"].relative_to(TASK_ROOT)).replace("\\", "/"),
            }
            if exact_reuse
            else {"rifeReport": str(processing_report.relative_to(TASK_ROOT)).replace("\\", "/")}
        ),
        "interpolation": {
            "passes": 0 if exact_reuse else 1,
            "mode": "exact-complete-frame-reuse-and-reversal" if exact_reuse else interpolation_mode,
            "wrap": interpolation_mode == "loop",
            "sourceFrameCount": len(source_cells),
            "outputFrameCount": final_count,
            "keyFrameIndexMapping": final_source_frame_map if exact_reuse else "outputIndex = sourceKeyIndex * 2",
        },
        "layout": {
            "frameWidth": frame_width,
            "frameHeight": FRAME_HEIGHT,
            "columns": final_cols,
            "rows": math.ceil(final_count / final_cols),
            "frameCount": final_count,
            "endFrame": final_count - 1,
            "footX": frame_width // 2,
            "footY": FOOT_Y,
            "targetBodyHeight": target_body_height,
            "baseScale": base_scale,
        },
        "clock": {
            "durationMs": duration_ms,
            "frameRate": final_count * 1000 / duration_ms,
            "repeat": -1 if interpolation_mode == "loop" else 0,
            "frameIndices": "0-based",
            "phases": spec["phases"],
            "events": spec["events"],
            "runtimeVfxContract": spec["runtimeVfxContract"],
        },
        "atlas": {
            "width": atlas_width,
            "height": atlas_height,
            "decodedRgbaBytes": decoded_bytes,
            "decodedRgbaMiB": round(decoded_bytes / 1024 / 1024, 4),
            "pngBytes": final_sheet.stat().st_size,
            "bossTargetMiB": 128,
            "bossHardStopMiB": 256,
            "withinSingleAssetBossTarget": decoded_bytes <= 128 * 1024 * 1024,
        },
        "gifTimingMs": gif_timing,
        "validation": validation,
        "blockedRuntimeWork": spec["blocked"],
    }
    (out_root / "spritesheet-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    budget_manifest = {
        "version": 1,
        "id": f"{spec['asset']}-partial-{action_slug}-package",
        "profile": "boss",
        "assetOnly": True,
        "runtimeIntegrationActive": False,
        "scope": f"{spec['action']} only; full boss dependency closure is not complete",
        "sheets": [
            {
                "textureKey": f"enemy_{spec['asset'].replace('-', '_')}_{spec['action']}_candidate",
                "path": str(final_sheet.relative_to(REPO)).replace("\\", "/"),
                "frameWidth": frame_width,
                "frameHeight": FRAME_HEIGHT,
                "frameCount": final_count,
                "endFrame": final_count - 1,
                "footX": frame_width // 2,
                "footY": FOOT_Y,
            }
        ],
        "dependencies": [],
    }
    (out_root / "sprite-budget-manifest.json").write_text(
        json.dumps(budget_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    window_description = (
        f"f{selected[0]}/f{selected[1]}/f{selected[2]}/f{selected[3]}/f{selected[4]}"
        if exact_reuse
        else
        f"f{selected[0]}..f{duration_end - 1}，同相位端点 f{duration_end} 排除"
        if interpolation_mode == "loop"
        else f"f{selected[0]}..f{selected[-1]}"
    )
    interpolation_description = (
        f"不使用 RIFE；按审核映射完整复用/反序复用原生键，得到 {final_count} 帧"
        if exact_reuse
        else
        f"一次回绕 RIFE 2x 后 {final_count} 帧"
        if interpolation_mode == "loop"
        else f"一次性非回绕 RIFE 2x 后 {final_count} 帧"
    )
    readme = f"""# {spec['displayName']} `{spec['action']}` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `{spec['video'].relative_to(TASK_ROOT).as_posix()}`，24 FPS / {spec['expectedSourceFrames']} 帧。
- 有效动作窗 `{window_description}`，唯一源键 {len(source_cells)} 张。
- {interpolation_description}，映射位置逐像素保留对应原生键。
- 单格 `{frame_width}x{FRAME_HEIGHT}`，{final_cols} 列 x {math.ceil(final_count / final_cols)} 行，脚点 `({frame_width // 2},{FOOT_Y})`。
- 动作墙钟 {duration_ms}ms，所有事件帧为 0-based：`{json.dumps(spec['events'], ensure_ascii=False)}`。
- 当前单表解码 RGBA 约 {decoded_bytes / 1024 / 1024:.4f} MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：{', '.join(spec['blocked'])}。
"""
    (out_root / "README.md").write_text(readme, encoding="utf-8")
    print(f"[approved-action] built {key}: {frame_width}x{FRAME_HEIGHT} x {final_count}", flush=True)


def build_formal(keys: list[str]) -> None:
    if any("finalSourceFrameMap" not in ACTIONS[key] for key in keys) and not RIFE_EXE.exists():
        raise SystemExit(f"missing RIFE executable: {RIFE_EXE}")
    model = get_model()
    for key in keys:
        build_action(key, model)


def parse_keys(value: str) -> list[str]:
    if value == "all":
        return list(ACTIONS)
    keys = [part.strip() for part in value.split(",") if part.strip()]
    unknown = [key for key in keys if key not in ACTIONS]
    if unknown:
        raise SystemExit(f"unknown action keys: {unknown}")
    return keys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actions", default="all", help="snow_advance,snow_trample,snow_tower_drop,snow,bell,bell_antler,bell_long_tone,bell_hoof_sequence,bell_rhythm_shift,bell_stride,aurora_oldstep,aurora_tether,aurora_cut,aurora_seek,aurora_reweave or all")
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    keys = parse_keys(args.actions)
    if args.probe:
        build_probe(keys)
    else:
        build_formal(keys)


if __name__ == "__main__":
    main()
