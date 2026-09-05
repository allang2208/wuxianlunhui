// Pure display values shared with the offline preview. No movement, occupancy or battle writes.
export function createArmyMotion(motion) {
    return function armyMotion(army, now, progress = 0, reduced = false) {
        const moving = !!army.march && progress < 1;
        const elapsed = now - army.mapStatusAt;
        const arriving = army.mapStatus === 'arrived' && elapsed >= 0 && elapsed < motion.arrivalPulseMs;
        const state = army.defeated ? 'defeated' : army.mapStatus === 'blocked' ? 'blocked'
            : army.warId || army.mapStatus === 'battle' ? 'battle'
            : army.mapStatus === 'entering' ? 'entering' : arriving ? 'arrived' : moving ? 'moving' : 'hold';
        const wave = (1 - Math.cos(now / motion.armySwayPeriodMs * Math.PI * 2)) / 2;
        return { state, animated: ['moving', 'battle', 'entering', 'arrived'].includes(state),
            rotation: !reduced && state === 'moving' ? Math.sin(now / motion.armySwayPeriodMs * Math.PI * 2) * motion.armySwayRadians : 0,
            pulse: reduced ? .65 : .35 + wave * .45,
            badge: state === 'battle' ? 'attack' : ['blocked', 'defeated'].includes(state) ? 'blocked'
                : state === 'entering' ? 'enter' : null };
    };
}
