import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron-new/**',
      'build/**',
      'backup/**',
      'backupcurrent/**',
      'tools/**',
      '**/*.md'
    ]
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        __phaserScene: 'readonly',
        __phaserSceneReady: 'readonly',

        CONFIG: 'readonly',
        MathUtils: 'readonly',
        Easing: 'readonly',
        AttackFormula: 'readonly',

        GAME_CONFIG: 'readonly',
        COMBAT_CONFIG: 'readonly',
        COMBAT_FORMULAS: 'readonly',
        ANIMATION_CONFIG: 'readonly',
        SKILL_DATA: 'readonly',
        ENEMY_DATA: 'readonly',
        HUMANOID_SQUAD_CONFIG: 'readonly',





        DamagePipeline: 'readonly',

        Entity: 'readonly',
        DamageableEntity: 'readonly',
        TargetDummy: 'readonly',
        Player: 'readonly',
        Enemy: 'readonly',
        BlackWolf: 'readonly',
        RedWolfKing: 'readonly',
        SpitterZombie: 'readonly',
        FatZombie: 'readonly',
        FastZombie: 'readonly',
        ZombieDog: 'readonly',
        HumanoidMonster: 'readonly',
        Commander: 'readonly',
        MachineGunner: 'readonly',
        Rifleman: 'readonly',
        FlankRifleman: 'readonly',
        ShieldBearer: 'readonly',
        DropItem: 'readonly',
        NPC: 'readonly',

        NPCDialogue: 'readonly',
        ShopSystem: 'readonly',
        EnhanceSystem: 'readonly',
        CraftSystem: 'readonly',
        EnchantSystem: 'readonly',
        QuestSystem: 'readonly',
        QuestState: 'readonly',
        QuestTracker: 'readonly',
        LevelUpSystem: 'readonly',
        RiftSystem: 'readonly',
        RewardSystem: 'readonly',
        EnhancementItems: 'readonly',

        SkillManager: 'readonly',
        QuickBar: 'readonly',
        EquipManager: 'readonly',
        EquipTooltipManager: 'readonly',
        BackpackDialogManager: 'readonly',
        EquipDataManager: 'readonly',
        GameUIManager: 'readonly',
        CodexManager: 'readonly',
        SystemUI: 'readonly',
        UI_DATA_CONFIG: 'readonly',
        DevTool: 'readonly',
        NpcPortraitTool: 'readonly',



        pathFinder: 'readonly',
        PathManager: 'readonly',
        regionIndex: 'readonly',
        TacticalSquadAI: 'readonly',
        MovementSystem: 'readonly',
        CombatSystem: 'readonly',
        PerceptionSystem: 'readonly',

        DungeonMapSystem: 'readonly',
        ExpeditionSystem: 'readonly'
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': ['error'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-dupe-class-members': 'warn',
      'no-useless-assignment': 'warn',
      'no-dupe-keys': 'warn',
      'no-prototype-builtins': 'warn',
      'no-empty': 'warn'
    }
  }
];
