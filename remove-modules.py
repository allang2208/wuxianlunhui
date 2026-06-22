import sys, os

# 读取 legacy.js
with open('legacy.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 找到所有要删除的模块范围
modules_to_remove = []

# 1. CONFIG
modules_to_remove.append((1, 12))  # 0-indexed lines 1-12 (对应行2-13)

# 2. MathUtils
modules_to_remove.append((13, 46))

# 3. Renderer
modules_to_remove.append((47, 69))

# 4. Camera
modules_to_remove.append((71, 87))

# 5. MapGenerator
modules_to_remove.append((89, 140))

# 6. MazeGenerator: 从行144(0-indexed 143)到 WallSystem 之前
maze_start = 143
wall_start = None
for i, line in enumerate(lines):
    if i > maze_start and 'const WallSystem' in line:
        wall_start = i
        break
if wall_start:
    modules_to_remove.append((maze_start, wall_start - 1))
    # 7. WallSystem: 从 wall_start 到 EffectManager 之前
    effect_start = None
    for i, line in enumerate(lines):
        if i > wall_start and 'const EffectManager' in line:
            effect_start = i
            break
    if effect_start:
        modules_to_remove.append((wall_start, effect_start - 1))
        # 8. EffectManager
        slash_start = None
        for i, line in enumerate(lines):
            if i > effect_start and 'const SlashEffect' in line:
                slash_start = i
                break
        if slash_start:
            modules_to_remove.append((effect_start, slash_start - 1))
            # 9. SlashEffect
            thrust_start = None
            for i, line in enumerate(lines):
                if i > slash_start and 'const ThrustEffect' in line:
                    thrust_start = i
                    break
            if thrust_start:
                modules_to_remove.append((slash_start, thrust_start - 1))
                # 10. ThrustEffect
                blood_start = None
                for i, line in enumerate(lines):
                    if i > thrust_start and 'const BloodHitEffect' in line:
                        blood_start = i
                        break
                if blood_start:
                    modules_to_remove.append((thrust_start, blood_start - 1))
                    # 11. BloodHitEffect
                    smoke_start = None
                    for i, line in enumerate(lines):
                        if i > blood_start and 'const SmokeEffect' in line:
                            smoke_start = i
                            break
                    if smoke_start:
                        modules_to_remove.append((blood_start, smoke_start - 1))
                        # 12. SmokeEffect
                        attack_start = None
                        for i, line in enumerate(lines):
                            if i > smoke_start and 'const AttackRangeEffect' in line:
                                attack_start = i
                                break
                        if attack_start:
                            modules_to_remove.append((smoke_start, attack_start - 1))
                            # 13. AttackRangeEffect
                            dash_start = None
                            for i, line in enumerate(lines):
                                if i > attack_start and 'const DashConvergeEffect' in line:
                                    dash_start = i
                                    break
                            if dash_start:
                                modules_to_remove.append((attack_start, dash_start - 1))
                                # 14. DashConvergeEffect / DashAuraEffect
                                sweep_start = None
                                for i, line in enumerate(lines):
                                    if i > dash_start and 'const SweepEffect' in line:
                                        sweep_start = i
                                        break
                                if sweep_start:
                                    modules_to_remove.append((dash_start, sweep_start - 1))
                                    # 15. SweepEffect
                                    night_start = None
                                    for i, line in enumerate(lines):
                                        if i > sweep_start and 'const NightFlameBeamEffect' in line:
                                            night_start = i
                                            break
                                    if night_start:
                                        modules_to_remove.append((sweep_start, night_start - 1))
                                        # 16. NightFlameBeamEffect
                                        particle_start = None
                                        for i, line in enumerate(lines):
                                            if i > night_start and 'const DodgeEffect' in line:
                                                particle_start = i
                                                break
                                        if particle_start:
                                            modules_to_remove.append((night_start, particle_start - 1))
                                            # 17. DodgeEffect / DeathEffect / BloodEffect / DustEffect
                                            float_start = None
                                            for i, line in enumerate(lines):
                                                if i > particle_start and 'const FloatingTextEffect' in line:
                                                    float_start = i
                                                    break
                                            if float_start:
                                                modules_to_remove.append((particle_start, float_start - 1))
                                                # 18. FloatingTextEffect
                                                muzzle_start = None
                                                for i, line in enumerate(lines):
                                                    if i > float_start and 'const MuzzleFlashEffect' in line:
                                                        muzzle_start = i
                                                        break
                                                if muzzle_start:
                                                    modules_to_remove.append((float_start, muzzle_start - 1))
                                                    # 19. MuzzleFlashEffect
                                                    shell_start = None
                                                    for i, line in enumerate(lines):
                                                        if i > muzzle_start and 'const ShellCasingEffect' in line:
                                                            shell_start = i
                                                            break
                                                    if shell_start:
                                                        modules_to_remove.append((muzzle_start, shell_start - 1))
                                                        # 20. ShellCasingEffect
                                                        # 21. WeaponAnimConfig
                                                        weapon_start = None
                                                        for i, line in enumerate(lines):
                                                            if i > shell_start and 'const WeaponAnimConfig' in line:
                                                                weapon_start = i
                                                                break
                                                        if weapon_start:
                                                            modules_to_remove.append((shell_start, weapon_start - 1))
                                                            # 22. ItemFactory
                                                            factory_start = None
                                                            for i, line in enumerate(lines):
                                          
