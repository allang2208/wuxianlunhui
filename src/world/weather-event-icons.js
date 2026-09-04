export const WEATHER_EVENT_ICON_PATHS = Object.freeze({
    sandstorm: 'assets/ui/event-icons/weather-sandstorm.png',
    drought: 'assets/ui/event-icons/weather-drought.png',
    fog_tide: 'assets/ui/event-icons/weather-fog-tide.png',
    mine_earthquake: 'assets/ui/event-icons/weather-mine-earthquake.png',
    mine_poisonGas: 'assets/ui/event-icons/weather-mine-poison-gas.png',
    mine_resurrection: 'assets/ui/event-icons/weather-mine-resurrection.png',
});

export function getWeatherEventIconPath(weatherId) {
    return WEATHER_EVENT_ICON_PATHS[String(weatherId || '')] || null;
}
