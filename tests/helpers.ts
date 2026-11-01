import type { Pregunta } from '../src/datos/esquema.js';

export function pregunta(extra: Partial<Pregunta> = {}): Pregunta {
  return {
    id: 'MED2_TEST_01',
    categoriaId: 'med2_unt',
    anio: '2021',
    especialidad: 'Cardiología',
    tema: 'Insuficiencia cardiaca',
    dificultad: 'Intermedio',
    pregunta: '¿Cuál es el fármaco de primera línea?',
    opciones: ['A. Uno', 'B. Dos', 'C. Tres', 'D. Cuatro', 'E. Cinco'],
    respuestaCorrecta: 2,
    fundamentoDetallado: { correcta: 'Porque sí.', descarte: 'A: no. B: tampoco.' },
    ...extra,
  };
}
