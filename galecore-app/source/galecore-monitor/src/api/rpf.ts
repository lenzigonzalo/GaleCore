/**
 * Switch de la estrategia RPF. No hay funciones propias para leerlo ni escribirlo: el contrato es
 * uniforme para todas las estrategias y lo maneja `useStrategySwitchStore` sobre `api/strategies`.
 * Lo único propio de RPF es el endpoint, y el config de la app también lo declara — el que manda
 * es el del config (`switch_endpoint`); esta constante cubre el arranque, antes de que llegue.
 */
export const RPF_SWITCH_ENDPOINT = '/App/Rpf/Switch';
